import { h, holdToRepeat } from './dom';
import { TapTempo } from './metronome';

export interface TempoControlOptions {
  min: number;
  max: number;
  /** Current BPM. */
  value: number;
  /** The file's own tempo. When set, tapping the number resets to it. */
  base?: number | null;
  /** Show a Tap button for tap tempo. */
  tap?: boolean;
  onChange: (bpm: number) => void;
}

export interface TempoControl {
  el: HTMLElement;
  set(bpm: number): void;
  setRange(min: number, max: number, base?: number | null): void;
}

export function createTempoControl(opts: TempoControlOptions): TempoControl {
  let { min, max, value } = opts;
  let base = opts.base ?? null;

  const slider = h('input', { type: 'range', class: 'bpm-slider', 'aria-label': 'Tempo', step: 1 });
  const down = h('button', { class: 'btn small', 'aria-label': 'Slower' }, '−');
  const up = h('button', { class: 'btn small', 'aria-label': 'Faster' }, '+');
  const num = h('button', { class: 'bpm-value' }, '');
  const note = h('span', { class: 'bpm-note' }, '');
  const tapper = new TapTempo();
  const tapBtn = opts.tap ? h('button', { class: 'btn small', title: 'Tap along to set the tempo' }, 'Tap') : null;

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  const emit = (v: number) => {
    value = clamp(v);
    paint();
    opts.onChange(value);
  };

  function paint(): void {
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    num.textContent = String(value);
    const changed = base !== null && value !== base;
    num.classList.toggle('changed', changed);
    num.disabled = base === null;
    num.setAttribute('aria-label', base === null ? `${value} BPM` : changed ? `${value} BPM. Reset to ${base}` : `${value} BPM, the file's tempo`);
    note.textContent = base === null ? 'BPM' : changed ? `BPM · ${Math.round((value / base) * 100)}%` : 'BPM';
  }

  slider.addEventListener('input', () => emit(Number(slider.value)));
  down.addEventListener('click', () => emit(value - 1));
  up.addEventListener('click', () => emit(value + 1));
  holdToRepeat(down, () => emit(value - 1));
  holdToRepeat(up, () => emit(value + 1));
  num.addEventListener('click', () => base !== null && emit(base));
  tapBtn?.addEventListener('click', () => {
    const bpm = tapper.tap();
    if (bpm !== null) emit(bpm);
  });

  const el = h(
    'div',
    { class: 'tempo-control', role: 'group', 'aria-label': 'Tempo' },
    down,
    slider,
    up,
    h('div', { class: 'bpm-readout' }, num, note),
    tapBtn,
  );
  paint();

  return {
    el,
    set(bpm) {
      value = clamp(bpm);
      paint();
    },
    setRange(newMin, newMax, newBase) {
      min = newMin;
      max = newMax;
      if (newBase !== undefined) base = newBase;
      value = clamp(value);
      paint();
    },
  };
}
