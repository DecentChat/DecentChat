import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Generate version.json on build
const VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;
let commitHash = 'dev';
try { commitHash = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch {};

export default defineConfig({
  // Resolve workspace packages from source (monorepo development mode)
  resolve: {
    alias: {
      'decent-protocol': path.resolve(__dirname, '../decent-protocol/src/index.ts'),
      'decent-transport-webrtc': path.resolve(__dirname, '../decent-transport-webrtc/src/index.ts'),
    },
  },
  define: {
    '__APP_VERSION__': JSON.stringify(VERSION),
    '__BUILD_TIME__': JSON.stringify(new Date().toISOString()),
    '__COMMIT_HASH__': JSON.stringify(commitHash),
  },
  plugins: [
    // Generate version.json in dist
    {
      name: 'version-json',
      closeBundle() {
        const versionInfo = {
          version: VERSION,
          buildTime: new Date().toISOString(),
          commitHash,
          protocolVersion: '0.1.0',
          schemaVersion: 4,
        };
        const distDir = path.resolve(__dirname, 'dist');
        if (fs.existsSync(distDir)) {
          fs.writeFileSync(path.resolve(distDir, 'version.json'), JSON.stringify(versionInfo, null, 2));
        }
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'DecentChat',
        short_name: 'DecentChat',
        description: 'End-to-end encrypted, serverless P2P chat',
        theme_color: '#6c5ce7',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
});
