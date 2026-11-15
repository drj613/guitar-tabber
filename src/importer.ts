import * as alphaTab from '@coderline/alphatab';

export interface ParsedInfo {
  title: string;
  artist: string;
  trackCount: number;
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
  };
}
