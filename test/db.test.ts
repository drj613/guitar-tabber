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

  it('opens records saved before PDF support as Guitar Pro songs', async () => {
    // Shape of a record written by the first release: no kind, no pdf settings.
    await addSong({ fileName: 'x.gp', title: 'X', artist: '', trackCount: 1, size: 1 }, new ArrayBuffer(1));
    const [song] = await listSongs();
    const old: Record<string, unknown> = { ...song };
    delete old.kind;
    delete old.pdf;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('guitar-tabber');
      req.onsuccess = () => {
        const tx = req.result.transaction('meta', 'readwrite');
        tx.objectStore('meta').put(old);
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    const back = await getSong(song.id);
    expect(back?.kind).toBe('score');
    expect(back?.pdf.bpm).toBe(100);
    expect(back?.settings.stave).toBe('scoretab');
  });

  it('stores PDFs with their own settings', async () => {
    const song = await addSong({ kind: 'pdf', fileName: 'a.pdf', title: 'A', artist: '', trackCount: 0, pageCount: 3, size: 1 }, new ArrayBuffer(1));
    await updateSong(song.id, { pdf: { ...song.pdf, bpm: 72, beatsPerBar: 3 } });
    const back = await getSong(song.id);
    expect(back?.kind).toBe('pdf');
    expect(back?.pageCount).toBe(3);
    expect(back?.pdf).toMatchObject({ bpm: 72, beatsPerBar: 3 });
  });

  it('deletes both the record and the bytes', async () => {
    const song = await addSong({ fileName: 'a.gp', title: 'A', artist: '', trackCount: 1, size: 1 }, new ArrayBuffer(1));
    await deleteSong(song.id);
    expect(await listSongs()).toHaveLength(0);
    expect(await getSongBytes(song.id)).toBeUndefined();
  });
});
