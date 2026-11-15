import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTests, addSong, deleteSong, getSong, getSongBytes, listSongs, updateSong } from '../src/db';

beforeEach(async () => {
  await _resetForTests();
  await new Promise((r) => {
    const req = indexedDB.deleteDatabase('guitar-tabber');
    req.onsuccess = req.onerror = r;
  });
});

describe('song library', () => {
  it('stores file bytes separately from the list', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const song = await addSong({ fileName: 'a.gp', title: 'A', artist: 'X', trackCount: 2, size: 3 }, bytes);
    const list = await listSongs();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('A');
    expect(new Uint8Array((await getSongBytes(song.id))!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('saves per-song settings', async () => {
    const song = await addSong({ fileName: 'a.gp', title: 'A', artist: '', trackCount: 1, size: 1 }, new ArrayBuffer(1));
    await updateSong(song.id, { settings: { ...song.settings, bpm: 80, click: true, shownTracks: [2] } });
    const back = await getSong(song.id);
    expect(back?.settings.bpm).toBe(80);
    expect(back?.settings.click).toBe(true);
    expect(back?.settings.shownTracks).toEqual([2]);
  });

  it('deletes both the record and the bytes', async () => {
    const song = await addSong({ fileName: 'a.gp', title: 'A', artist: '', trackCount: 1, size: 1 }, new ArrayBuffer(1));
    await deleteSong(song.id);
    expect(await listSongs()).toHaveLength(0);
    expect(await getSongBytes(song.id)).toBeUndefined();
  });
});
