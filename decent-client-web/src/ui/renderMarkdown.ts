/**
 * renderMarkdown — safe chat markdown renderer
 *
 * Uses marked (fast, GFM-compliant) + DOMPurify (XSS sanitization).
 * Configured for chat: no raw HTML, links open in new tab.
 */
import { marked, type Renderer } from 'marked';
import DOMPurify from 'dompurify';

// Custom renderer: open links in new tab, add rel=noopener
const renderer: Partial<Renderer> = {
  link({ href, title, tokens }) {
    const text = (this as any).parser?.parseInline(tokens) ?? '';
    const titleAttr = title ? ` title="${title}"` : '';
    return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
  },
};

marked.use({
  renderer: renderer as Renderer,
  gfm: true,       // GitHub Flavored Markdown (```code```, **bold**, etc.)
  breaks: true,    // Single newlines become <br> (chat-friendly)
});

/**
 * Render markdown string to sanitized HTML.
 * Falls back to escaped plain text on any error.
 */
export function renderMarkdown(content: string): string {
  if (!content) return '';
  try {
    // Highlight @mentions before markdown parsing
    const withMentions = content.replace(/(^|\s)@([A-Za-z0-9_.\-]+)/g,
      '$1<span class="mention">@$2</span>');
    const raw = marked.parse(withMentions) as string;
    return DOMPurify.sanitize(raw, {
      ALLOWED_TAGS: [
        'p', 'br', 'strong', 'em', 'del', 'code', 'pre',
        'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3',
        'a', 'hr', 'span',
      ],
      ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'class'],
      ALLOW_DATA_ATTR: false,
    });
  } catch {
    return escapeHtml(content);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
