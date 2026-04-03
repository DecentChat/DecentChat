import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const SERVER_ORIGIN = process.env.PRETEXT_EVAL_ORIGIN ?? 'http://127.0.0.1:4173';

const WIDTHS = [320, 460];
const FONT = '400 15px "Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const LINE_HEIGHT = 22.5;
const DEFAULT_MESSAGE_HEIGHT = 76;
const MIN_ESTIMATED_HEIGHT = 40;
const MAX_ESTIMATED_HEIGHT = 280;
const MESSAGE_CHROME_HEIGHT = 34;
const GROUPED_MESSAGE_CHROME_HEIGHT = 8;
const MIN_MESSAGE_CONTENT_HEIGHT = 22;
const MESSAGE_VERTICAL_GAP_PX = 1;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeWhitespace(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeLiteral(raw, quote) {
  if (quote === '`') {
    if (raw.includes('${')) return null;
    return raw;
  }
  return raw
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\`/g, '`')
    .replace(/\\\\/g, '\\');
}

function extractMessageLiterals(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const relative = path.relative(REPO_ROOT, filePath);
  const samples = [];
  const patterns = [
    /sendMessage\([^,]+,\s*(["'`])([\s\S]*?)\1\s*[),]/g,
    /content:\s*(["'`])([\s\S]*?)\1/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const decoded = decodeLiteral(match[2], match[1]);
      if (!decoded) continue;
      const normalized = normalizeWhitespace(decoded);
      if (normalized.length < 8) continue;
      samples.push({ source: relative, text: normalized });
    }
  }

  return samples;
}

function extractMarkdownBlocks(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const relative = path.relative(REPO_ROOT, filePath);
  return text
    .split(/\n\s*\n/)
    .map((block) => normalizeWhitespace(block))
    .filter((block) => block.length >= 120 && block.length <= 420)
    .map((block) => ({ source: relative, text: block }));
}

function dedupeByText(samples) {
  const seen = new Set();
  const result = [];
  for (const sample of samples) {
    if (seen.has(sample.text)) continue;
    seen.add(sample.text);
    result.push(sample);
  }
  return result;
}

function pickEvenly(samples, count) {
  if (samples.length <= count) return samples;
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor((i * (samples.length - 1)) / Math.max(1, count - 1));
    result.push(samples[index]);
  }
  return result;
}

function selectSamples() {
  const messageFiles = [
    'decent-client-web/tests/e2e/dm.spec.ts',
    'decent-client-web/tests/e2e/integration.spec.ts',
    'decent-client-web/tests/e2e/streaming.spec.ts',
    'decent-client-web/tests/integration/company-sim-workflow.spec.ts',
  ].map((relative) => path.join(REPO_ROOT, relative));

  const docFiles = [
    'README.md',
    'docs/user/how-decentchat-works.md',
  ].map((relative) => path.join(REPO_ROOT, relative));

  const messageSamples = dedupeByText(messageFiles.flatMap(extractMessageLiterals))
    .filter((sample) => sample.text.length <= 220)
    .sort((a, b) => a.text.length - b.text.length);

  const docSamples = dedupeByText(docFiles.flatMap(extractMarkdownBlocks))
    .sort((a, b) => a.text.length - b.text.length);

  const selected = dedupeByText([
    ...pickEvenly(messageSamples, 8),
    ...pickEvenly(docSamples, 4),
  ]).slice(0, 12);

  if (selected.length === 0) {
    throw new Error('No benchmark samples extracted from repo sources.');
  }

  return selected;
}

function buildCases(samples) {
  const cases = [];
  samples.forEach((sample, sampleIndex) => {
    for (const width of WIDTHS) {
      for (const grouped of [false, true]) {
        cases.push({
          caseId: `sample-${sampleIndex + 1}-${width}-${grouped ? 'grouped' : 'full'}`,
          source: sample.source,
          text: sample.text,
          textLength: sample.text.length,
          width,
          grouped,
        });
      }
    }
  });
  return cases;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarize(rows) {
  const enriched = rows.map((row) => ({
    ...row,
    baselineError: Math.abs(row.baselineTotal - row.actualTotal),
    interventionError: Math.abs(row.interventionTotal - row.actualTotal),
    improvement: Math.abs(row.baselineTotal - row.actualTotal) - Math.abs(row.interventionTotal - row.actualTotal),
  }));

  const overall = {
    cases: enriched.length,
    baselineMae: mean(enriched.map((row) => row.baselineError)),
    interventionMae: mean(enriched.map((row) => row.interventionError)),
    baselineMedianError: median(enriched.map((row) => row.baselineError)),
    interventionMedianError: median(enriched.map((row) => row.interventionError)),
  };

  const longRows = enriched.filter((row) => row.textLength >= 120);
  const longText = longRows.length > 0 ? {
    cases: longRows.length,
    baselineMae: mean(longRows.map((row) => row.baselineError)),
    interventionMae: mean(longRows.map((row) => row.interventionError)),
  } : null;

  const groupedRows = enriched.filter((row) => row.grouped);
  const grouped = {
    cases: groupedRows.length,
    baselineMae: mean(groupedRows.map((row) => row.baselineError)),
    interventionMae: mean(groupedRows.map((row) => row.interventionError)),
  };

  const bestImprovements = [...enriched]
    .sort((a, b) => b.improvement - a.improvement)
    .slice(0, 8)
    .map((row) => ({
      caseId: row.caseId,
      source: row.source,
      width: row.width,
      grouped: row.grouped,
      textLength: row.textLength,
      actualTotal: row.actualTotal,
      baselineTotal: row.baselineTotal,
      interventionTotal: row.interventionTotal,
      baselineError: row.baselineError,
      interventionError: row.interventionError,
      improvement: row.improvement,
      preview: row.text.length > 110 ? `${row.text.slice(0, 110)}…` : row.text,
    }));

  return { overall, longText, grouped, bestImprovements, rows: enriched };
}

async function run() {
  const samples = selectSamples();
  const cases = buildCases(samples);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${SERVER_ORIGIN}/`, { waitUntil: 'domcontentloaded' });

    const rows = await page.evaluate(async ({ cases, font, lineHeight }) => {
      const { prepare, layout } = await import('/node_modules/.bun/@chenglou+pretext@0.0.4/node_modules/@chenglou/pretext/dist/layout.js');
      const { marked } = await import('/node_modules/.bun/marked@17.0.3/node_modules/marked/lib/marked.esm.js');

      marked.setOptions({ gfm: true, breaks: true });

      const MIN_ESTIMATED_HEIGHT = 40;
      const MAX_ESTIMATED_HEIGHT = 280;
      const MESSAGE_CHROME_HEIGHT = 34;
      const GROUPED_MESSAGE_CHROME_HEIGHT = 8;
      const MIN_MESSAGE_CONTENT_HEIGHT = 22;
      const MESSAGE_VERTICAL_GAP_PX = 1;
      const DEFAULT_MESSAGE_HEIGHT = 76;

      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

      document.head.innerHTML = '';
      document.body.innerHTML = '<div id="lab"></div>';
      const style = document.createElement('style');
      style.textContent = `
        body { margin: 0; font: ${font}; }
        #lab { padding: 24px; }
        .message { display: flex; gap: 10px; padding: 6px 8px; max-width: 100%; box-sizing: border-box; }
        .message.grouped { padding-top: 1px; padding-bottom: 1px; }
        .message.grouped .message-avatar { visibility: hidden; height: 0; }
        .message.grouped .message-header { display: none; }
        .message-avatar { width: 36px; height: 36px; flex-shrink: 0; background: #7c3aed; border-radius: 8px; }
        .message-body { min-width: 0; }
        .message-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 1px; }
        .message-sender { font-weight: 700; font-size: 14px; }
        .message-time { font-size: 11px; }
        .message-content { font-size: 15px; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.5; max-width: 100%; }
        .message-content.markdown-body { white-space: normal; overflow-wrap: anywhere; }
        .message-content.markdown-body p { margin: 0 0 4px 0; }
        .message-content.markdown-body p:last-child { margin-bottom: 0; }
        .message-content.markdown-body code { padding: 1px 5px; font-size: 13px; font-family: 'Fira Code', 'Consolas', monospace; }
        .message-content.markdown-body pre { padding: 10px 14px; margin: 6px 0; font-size: 13px; max-width: 100%; overflow-x: auto; white-space: pre-wrap; }
        .message-content.markdown-body pre code { padding: 0; }
        .message-content.markdown-body ul, .message-content.markdown-body ol { padding-left: 20px; margin: 4px 0; }
        .message-content.markdown-body li { margin: 2px 0; }
        .message-content.markdown-body blockquote { padding-left: 10px; margin: 4px 0; border-left: 3px solid #7c3aed; }
        .message-content.markdown-body h1, .message-content.markdown-body h2, .message-content.markdown-body h3 { font-size: 1em; font-weight: 700; margin: 4px 0 2px; }
        .message-content.markdown-body hr { border: none; border-top: 1px solid #ddd; margin: 6px 0; }
        .message-content.markdown-body table { border-collapse: collapse; width: auto; margin: 6px 0; font-size: 0.9em; display: block; overflow-x: auto; max-width: 100%; }
        .message-content.markdown-body th, .message-content.markdown-body td { padding: 4px 10px; border: 1px solid #ddd; text-align: left; white-space: nowrap; }
      `;
      document.head.appendChild(style);

      const lab = document.getElementById('lab');
      const preparedCache = new Map();

      const measureActual = (rowCase) => {
        const row = document.createElement('div');
        row.className = `message${rowCase.grouped ? ' grouped' : ''}`;
        row.innerHTML = `
          <div class="message-avatar"></div>
          <div class="message-body" style="width:${rowCase.width}px">
            <div class="message-header">
              <span class="message-sender">Alex</span>
              <span class="message-time">12:34</span>
            </div>
            <div class="message-content markdown-body">${marked.parse(rowCase.text)}</div>
          </div>
        `;
        lab.appendChild(row);
        const height = row.getBoundingClientRect().height;
        row.remove();
        return height;
      };

      const measureIntervention = (rowCase) => {
        const widthBucket = Math.max(180, Math.round(rowCase.width / 8) * 8);
        const preparedKey = `${font}\n${rowCase.text}`;
        let prepared = preparedCache.get(preparedKey);
        if (!prepared) {
          prepared = prepare(rowCase.text, font, { whiteSpace: 'pre-wrap' });
          preparedCache.set(preparedKey, prepared);
        }
        const content = layout(prepared, widthBucket, lineHeight);
        const contentHeight = Number.isFinite(content.height)
          ? Math.max(MIN_MESSAGE_CONTENT_HEIGHT, content.height)
          : MIN_MESSAGE_CONTENT_HEIGHT;
        const chromeHeight = rowCase.grouped ? GROUPED_MESSAGE_CHROME_HEIGHT : MESSAGE_CHROME_HEIGHT;
        return clamp(
          chromeHeight + contentHeight + MESSAGE_VERTICAL_GAP_PX,
          MIN_ESTIMATED_HEIGHT,
          MAX_ESTIMATED_HEIGHT,
        );
      };

      return cases.map((rowCase) => ({
        ...rowCase,
        actualTotal: measureActual(rowCase),
        baselineTotal: DEFAULT_MESSAGE_HEIGHT,
        interventionTotal: measureIntervention(rowCase),
      }));
    }, { cases, font: FONT, lineHeight: LINE_HEIGHT });

    return {
      serverOrigin: SERVER_ORIGIN,
      sampleCount: samples.length,
      samples,
      summary: summarize(rows),
    };
  } finally {
    await browser.close();
  }
}

const result = await run();
console.log(JSON.stringify(result, null, 2));
