import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { requestPersistence } from './db';
import { toast } from './dom';
import { renderLibrary } from './library';
import { renderPlayer } from './player';

const app = document.getElementById('app')!;
let cleanup: (() => void) | null = null;
let routeToken = 0;

async function route(): Promise<void> {
  const token = ++routeToken;
  cleanup?.();
  cleanup = null;
  const match = location.hash.match(/^#\/song\/(.+)$/);
  if (match) {
    const dispose = await renderPlayer(app, decodeURIComponent(match[1]), () => (location.hash = '#/'), () => token !== routeToken);
    // The user navigated away while the song was loading.
    if (token !== routeToken) dispose();
    else cleanup = dispose;
  } else {
    cleanup = renderLibrary(app, (id) => (location.hash = `#/song/${encodeURIComponent(id)}`));
  }
}

window.addEventListener('hashchange', () => void route());
void route();
void requestPersistence();

const updateSW = registerSW({
  onNeedRefresh() {
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = '<span>A new version is ready.</span>';
    const btn = document.createElement('button');
    btn.className = 'btn primary small';
    btn.textContent = 'Update';
    btn.onclick = () => void updateSW(true);
    bar.append(btn);
    document.body.append(bar);
  },
  onOfflineReady() {
    toast('Ready to use offline');
  },
});
