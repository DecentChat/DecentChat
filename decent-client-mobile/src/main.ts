import { mount } from 'svelte';
import App from './App.svelte';
import { setupNativePlugins } from './native/plugins';
import { setupIOSFixes } from './native/ios-fixes';
import './styles/mobile.css';

function ensureViewportMeta() {
  const viewportContent = 'width=device-width, initial-scale=1, viewport-fit=cover';
  const existingTag = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');

  if (existingTag) {
    existingTag.setAttribute('content', viewportContent);
    return;
  }

  const viewportMeta = document.createElement('meta');
  viewportMeta.name = 'viewport';
  viewportMeta.content = viewportContent;
  document.head.appendChild(viewportMeta);
}

ensureViewportMeta();
setupIOSFixes();

// Register service worker for PWA auto-update
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Check for updates every 30 seconds
    setInterval(() => reg.update(), 30_000);

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'activated') {
          // New version active — reload to pick it up
          window.location.reload();
        }
      });
    });
  }).catch(() => {});
}

void setupNativePlugins();

document.body.classList.add('mobile-app-root');

const app = mount(App, {
  target: document.body
});

export default app;
