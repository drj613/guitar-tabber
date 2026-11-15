import { updateSong, type SongMeta } from './db';
import { h } from './dom';
import { Metronome } from './metronome';
import { openPdf, type OpenedPdf, type PdfDocument } from './pdf';
import { normalizePdfSettings, type PdfSettings } from './songSettings';
import { createTempoControl } from './tempoControl';
import { createWakeLock } from './wakeLock';

/** iOS refuses canvases above about 16.7 million pixels. Stay well under. */
const MAX_CANVAS_PIXELS = 12_000_000;
const MIN_BPM = 20;
const MAX_BPM = 300;

interface PageSlot {
  index: number;
  /** Page size in PDF points at scale 1. */
  width: number;
  height: number;
  box: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  /** CSS width the canvas was drawn at; redraw when the layout width changes. */
  drawnWidth: number;
  task: { cancel(): void } | null;
}

export function renderPdfView(root: HTMLElement, song: SongMeta, bytes: Uint8Array, back: () => void): () => void {
  const view = new PdfView(root, song, bytes, back);
  return () => view.dispose();
}

class PdfView {
  private s: PdfSettings;
  private doc: PdfDocument | null = null;
  private opened: OpenedPdf | null = null;
  private slots: PageSlot[] = [];
  private disposed = false;
  private metronome: Metronome;
  private wake = createWakeLock();
  private saveTimer: number | undefined;
  private scrollTimer: number | undefined;
  private nearObserver: IntersectionObserver | null = null;
  private farObserver: IntersectionObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastWidth = 0;

  private el = {
    scroller: h('div', { class: 'score-scroll pdf-scroll' }),
    pages: h('div', { class: 'pdf-pages' }),
    overlay: h('div', { class: 'score-overlay' }, 'Opening…'),
    pageInfo: h('span', { class: 'page-info' }, ''),
    start: h('button', { class: 'btn transport play', 'aria-label': 'Start click' }, '▶'),
    beats: h('div', { class: 'beat-dots', 'aria-hidden': 'true' }),
    perBar: h('span', { class: 'stepper-value' }, ''),
    zoomVal: h('span', { class: 'zoom-val' }, ''),
  };

  constructor(
    private root: HTMLElement,
    private song: SongMeta,
    private bytes: Uint8Array,
    private back: () => void,
  ) {
    this.s = normalizePdfSettings(song.pdf);
    this.metronome = new Metronome(this.s.bpm, this.s.beatsPerBar);
    this.metronome.onTick = (tick) => this.flashBeat(tick.beat);
    this.build();
    void this.load();
  }

  private build(): void {
    const e = this.el;
    e.scroller.append(e.pages);
    const tempo = createTempoControl({
      min: MIN_BPM,
      max: MAX_BPM,
      value: this.s.bpm,
      tap: true,
      onChange: (bpm) => {
        this.s.bpm = bpm;
        this.metronome.bpm = bpm;
        this.save();
      },
    });

    const header = h(
      'header',
      { class: 'bar' },
      h('button', { class: 'btn', onclick: () => this.back() }, '‹ Library'),
      h(
        'div',
        { class: 'titles' },
        h('div', { class: 'title' }, this.song.title),
        h('div', { class: 'subtitle' }, [this.song.artist, 'PDF'].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'spacer' }),
      e.pageInfo,
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Zoom' },
        h('button', { class: 'btn small', 'aria-label': 'Zoom out', onclick: () => this.zoom(-0.1) }, '−'),
        e.zoomVal,
        h('button', { class: 'btn small', 'aria-label': 'Zoom in', onclick: () => this.zoom(0.1) }, '+'),
      ),
    );

    const footer = h(
      'footer',
      { class: 'transport-bar' },
      h('div', { class: 'group' }, e.start, h('div', { class: 'pos' }, h('span', { class: 'time' }, 'Click'), e.beats)),
      h('div', { class: 'group tempo' }, tempo.el),
      h(
        'div',
        { class: 'group', role: 'group', 'aria-label': 'Beats per bar' },
        h('span', { class: 'group-label' }, 'Beats per bar'),
        h(
          'div',
          { class: 'stepper' },
          h('button', { class: 'btn small', 'aria-label': 'Fewer beats per bar', onclick: () => this.setPerBar(this.s.beatsPerBar - 1) }, '−'),
          e.perBar,
          h('button', { class: 'btn small', 'aria-label': 'More beats per bar', onclick: () => this.setPerBar(this.s.beatsPerBar + 1) }, '+'),
        ),
      ),
    );

    this.root.replaceChildren(h('div', { class: 'player' }, header, h('div', { class: 'score-wrap' }, e.scroller, e.overlay), footer));

    e.start.addEventListener('click', () => this.toggleClick());
    e.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    document.addEventListener('keydown', this.onKey);
    window.addEventListener('pagehide', this.flush);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.paintPerBar();
    this.paintZoom();
  }

  // ---------- document ----------

  private async load(): Promise<void> {
    try {
      const opened = await openPdf(this.bytes);
      if (this.disposed) {
        opened.close();
        return;
      }
      this.opened = opened;
      const doc = (this.doc = opened.doc);
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        if (this.disposed) return;
        const vp = page.getViewport({ scale: 1 });
        const box = h('div', { class: 'pdf-page', 'data-page': i });
        box.style.aspectRatio = `${vp.width} / ${vp.height}`;
        this.slots.push({ index: i, width: vp.width, height: vp.height, box, canvas: null, drawnWidth: 0, task: null });
        this.el.pages.append(box);
      }
      this.el.overlay.hidden = true;
      this.layout();
      this.observe();
      this.el.scroller.scrollTop = this.s.scroll * this.el.scroller.scrollHeight;
      this.updatePageInfo();
    } catch (err) {
      console.error(err);
      this.el.overlay.hidden = false;
      this.el.overlay.textContent = "Couldn't open this PDF.";
    }
  }

  private observe(): void {
    const root = this.el.scroller;
    // Draw pages within a screen of the viewport; free canvases more than three screens away.
    this.nearObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) void this.draw(this.slotFor(entry.target));
      },
      { root, rootMargin: '100% 0px' },
    );
    this.farObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (!entry.isIntersecting) this.release(this.slotFor(entry.target));
      },
      { root, rootMargin: '300% 0px' },
    );
    for (const slot of this.slots) {
      this.nearObserver.observe(slot.box);
      this.farObserver.observe(slot.box);
    }
    this.resizeObserver = new ResizeObserver(() => {
      if (Math.abs(this.el.scroller.clientWidth - this.lastWidth) > 1) this.relayout();
    });
    this.resizeObserver.observe(this.el.scroller);
  }

  private slotFor(el: Element): PageSlot {
    return this.slots[Number((el as HTMLElement).dataset.page) - 1];
  }

  private pageWidth(): number {
    const avail = this.el.scroller.clientWidth - 32;
    return Math.max(200, Math.round(avail * this.s.zoom));
  }

  private layout(): void {
    this.lastWidth = this.el.scroller.clientWidth;
    const w = this.pageWidth();
    for (const slot of this.slots) slot.box.style.width = `${w}px`;
  }

  /** After a zoom or rotation: resize every page, keep the reading position, redraw what is visible. */
  private relayout(): void {
    const scroller = this.el.scroller;
    const frac = scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0;
    this.layout();
    scroller.scrollTop = frac * scroller.scrollHeight;
    const top = scroller.scrollTop - scroller.clientHeight;
    const bottom = scroller.scrollTop + scroller.clientHeight * 2;
    for (const slot of this.slots) {
      const y = slot.box.offsetTop;
      if (y + slot.box.offsetHeight >= top && y <= bottom) void this.draw(slot);
      else this.release(slot);
    }
  }

  private async draw(slot: PageSlot): Promise<void> {
    if (!this.doc || this.disposed) return;
    const cssWidth = this.pageWidth();
    if (slot.canvas && slot.drawnWidth === cssWidth) return;
    slot.task?.cancel();
    const page = await this.doc.getPage(slot.index);
    const scale = cssWidth / slot.width;
    const cssHeight = slot.height * scale;
    let ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (cssWidth * cssHeight * ratio * ratio > MAX_CANVAS_PIXELS) ratio = Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
    const viewport = page.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute('aria-label', `Page ${slot.index}`);
    canvas.setAttribute('role', 'img');
    const task = page.render({ canvas, viewport });
    slot.task = task;
    try {
      await task.promise;
    } catch {
      canvas.width = canvas.height = 0;
      return; // cancelled by a newer draw or a release
    }
    if (this.disposed || slot.task !== task) {
      canvas.width = canvas.height = 0;
      return;
    }
    slot.task = null;
    if (slot.canvas) slot.canvas.width = slot.canvas.height = 0;
    slot.box.replaceChildren(canvas);
    slot.canvas = canvas;
    slot.drawnWidth = cssWidth;
  }

  private release(slot: PageSlot): void {
    slot.task?.cancel();
    slot.task = null;
    if (slot.canvas) {
      // Zeroing the size frees the bitmap right away on iOS.
      slot.canvas.width = slot.canvas.height = 0;
      slot.canvas.remove();
      slot.canvas = null;
      slot.drawnWidth = 0;
    }
  }

  private zoom(delta: number): void {
    this.s.zoom = Math.round(Math.min(2.5, Math.max(0.5, this.s.zoom + delta)) * 10) / 10;
    this.paintZoom();
    this.relayout();
    this.save();
  }

  private paintZoom(): void {
    this.el.zoomVal.textContent = `${Math.round(this.s.zoom * 100)}%`;
  }

  private onScroll = (): void => {
    clearTimeout(this.scrollTimer);
    this.scrollTimer = window.setTimeout(() => {
      const sc = this.el.scroller;
      this.s.scroll = sc.scrollHeight ? sc.scrollTop / sc.scrollHeight : 0;
      this.updatePageInfo();
      this.save();
    }, 150);
  };

  private updatePageInfo(): void {
    if (!this.slots.length) return;
    const mid = this.el.scroller.scrollTop + this.el.scroller.clientHeight / 3;
    const current = this.slots.find((s) => s.box.offsetTop + s.box.offsetHeight > mid) ?? this.slots[this.slots.length - 1];
    this.el.pageInfo.textContent = `Page ${current.index} of ${this.slots.length}`;
  }

  // ---------- click ----------

  private toggleClick(): void {
    this.metronome.toggle();
    const on = this.metronome.running;
    this.el.start.textContent = on ? '❚❚' : '▶';
    this.el.start.setAttribute('aria-label', on ? 'Stop click' : 'Start click');
    this.el.start.setAttribute('aria-pressed', String(on));
    this.wake.set(on);
    if (!on) this.flashBeat(-1);
  }

  private setPerBar(n: number): void {
    this.s.beatsPerBar = Math.min(12, Math.max(1, n));
    this.metronome.beatsPerBar = this.s.beatsPerBar;
    this.paintPerBar();
    this.save();
  }

  private paintPerBar(): void {
    this.el.perBar.textContent = String(this.s.beatsPerBar);
    const dots = Array.from({ length: this.s.beatsPerBar }, (_, i) => h('span', { class: i === 0 && this.s.beatsPerBar > 1 ? 'dot accent' : 'dot' }));
    this.el.beats.replaceChildren(...dots);
  }

  private flashBeat(beat: number): void {
    const dots = this.el.beats.children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('on', i === beat);
  }

  // ---------- lifecycle ----------

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLButtonElement) return;
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.toggleClick();
    }
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(this.flush, 300);
  }

  private flush = (): void => {
    clearTimeout(this.saveTimer);
    void updateSong(this.song.id, { pdf: { ...this.s } });
  };

  dispose(): void {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    clearTimeout(this.scrollTimer);
    this.metronome.dispose();
    this.wake.dispose();
    this.nearObserver?.disconnect();
    this.farObserver?.disconnect();
    this.resizeObserver?.disconnect();
    for (const slot of this.slots) this.release(slot);
    this.opened?.close();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.flush);
  }
}
