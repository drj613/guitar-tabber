export type StaveMode = 'tab' | 'scoretab' | 'score';
export type LayoutChoice = 'page' | 'horizontal';

export interface TrackMix {
  mute: boolean;
  solo: boolean;
  /** 0..2, 1 is the file's own level */
  volume: number;
}

export interface SongSettings {
  /** Indexes of the tracks drawn on screen. Empty means "pick a default". */
  shownTracks: number[];
  /** Per-track mixer state, keyed by track index. */
  mix: Record<number, TrackMix>;
  /** Target tempo in BPM, or null to play at the file's tempo. */
  bpm: number | null;
  click: boolean;
  countIn: boolean;
  loop: boolean;
  /** Loop range as master bar indexes (inclusive), or null for the whole song. */
  loopBars: { start: number; end: number } | null;
  stave: StaveMode;
  layout: LayoutChoice;
  zoom: number;
}

export function defaultSettings(): SongSettings {
  return {
    shownTracks: [],
    mix: {},
    bpm: null,
    click: false,
    countIn: false,
    loop: false,
    loopBars: null,
    stave: 'scoretab',
    layout: 'page',
    zoom: 1,
  };
}

/** Fills in fields added in later versions so old records keep working. */
export function normalizeSettings(s: Partial<SongSettings> | undefined): SongSettings {
  return { ...defaultSettings(), ...(s ?? {}) };
}

export function mixFor(s: SongSettings, trackIndex: number): TrackMix {
  return s.mix[trackIndex] ?? { mute: false, solo: false, volume: 1 };
}

export interface PdfSettings {
  /** Metronome tempo. */
  bpm: number;
  /** Beats per bar; the first beat is accented. 1 means no accent. */
  beatsPerBar: number;
  /** Page width as a fraction of the screen width. */
  zoom: number;
  /** Where the reader left off, as a fraction of the document height. */
  scroll: number;
}

export function defaultPdfSettings(): PdfSettings {
  return { bpm: 100, beatsPerBar: 4, zoom: 1, scroll: 0 };
}

export function normalizePdfSettings(s: Partial<PdfSettings> | undefined): PdfSettings {
  return { ...defaultPdfSettings(), ...(s ?? {}) };
}
