import * as alphaTab from '@coderline/alphatab';

export interface ParsedInfo {
  title: string;
  artist: string;
  trackCount: number;
  /** Track to show the first time the song is opened. */
  defaultTrack: number;
}

const SUPPORTED = /\.(gp|gpx|gp3|gp4|gp5|gp6|gp7|gp8|musicxml|mxl|xml|capx)$/i;

export function looksSupported(fileName: string): boolean {
  return SUPPORTED.test(fileName);
}

/**
 * Parses a file just far enough to validate it and read its title.
 * Throws if alphaTab cannot read it.
 */
export function inspectScore(bytes: Uint8Array, fileName: string): ParsedInfo {
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes);
  const fallback = fileName.replace(/\.[^.]+$/, '');
  return {
    title: score.title?.trim() || fallback,
    artist: score.artist?.trim() || '',
    trackCount: score.tracks.length,
    defaultTrack: defaultTrack(score),
  };
}

/**
 * Picks the track to show first: the first guitar sound (General MIDI
 * programs 24-31), else a track with visible tab, else the first non-drum track.
 * GP3-5 files mark every track as having tab, so the instrument is the better signal.
 */
export function defaultTrack(score: alphaTab.model.Score): number {
  const pitched = score.tracks.filter((t) => !t.staves[0]?.isPercussion);
  const guitar = pitched.find((t) => t.playbackInfo.program >= 24 && t.playbackInfo.program <= 31);
  const tab = pitched.find((t) => t.staves.some((s) => s.showTablature && s.tuning.length >= 6));
  return (guitar ?? tab ?? pitched[0] ?? score.tracks[0])?.index ?? 0;
}
