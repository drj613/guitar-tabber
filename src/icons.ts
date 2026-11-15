import { h } from './dom';

/** Inline SVG icons (lucide shapes). Decorative: hidden from assistive tech, no text content. */
const PATHS = {
  play: '<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" stroke="none"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 20): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML =
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}

/** The pilot light on an on/off switch; lit by CSS when the button is aria-pressed. */
export function led(): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = 'led';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export function backButton(onclick: () => void): HTMLButtonElement {
  return h('button', { class: 'btn back', 'aria-label': 'Library', onclick }, icon('back'), h('span', { class: 'back-label' }, 'Library'));
}

export function closeButton(onclick: () => void): HTMLButtonElement {
  return h('button', { class: 'btn small quiet close', 'aria-label': 'Close', onclick }, icon('close'));
}
