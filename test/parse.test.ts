import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectScore } from '../src/importer';

const dir = 'test/fixtures';
const files = ['full-song.gp', 'full-song.gpx', 'full-song.gp5'];
const have = files.every((f) => existsSync(`${dir}/${f}`));

describe.skipIf(!have)('Guitar Pro import (run npm run fetch-fixtures first)', () => {
  for (const f of files) {
    it(`reads ${f}`, () => {
      const info = inspectScore(new Uint8Array(readFileSync(`${dir}/${f}`)), f);
      expect(info.title).toBe('The crow, the owl and the dove');
      expect(info.trackCount).toBe(11);
    });
  }
  it('rejects a file that is not a score', () => {
    expect(() => inspectScore(new TextEncoder().encode('hello'), 'notes.txt')).toThrow();
  });
});
