// Song library stored in IndexedDB.
// "meta" holds the small records the library list needs; "files" holds the
// raw file bytes, so listing songs never loads every file into memory.

import { defaultPdfSettings, defaultSettings, normalizePdfSettings, normalizeSettings, type PdfSettings, type SongSettings } from './songSettings';

export type SongKind = 'score' | 'pdf';

export interface SongMeta {
  id: string;
  /** Records saved before PDF support have no kind; they are scores. */
  kind: SongKind;
  fileName: string;
  title: string;
  artist: string;
  trackCount: number;
  /** PDFs only. */
  pageCount?: number;
  size: number;
  addedAt: number;
  lastOpenedAt: number | null;
  /** Guitar Pro player settings (unused for PDFs). */
  settings: SongSettings;
  /** PDF viewer and metronome settings. */
  pdf: PdfSettings;
}

type NewSong = Omit<SongMeta, 'id' | 'addedAt' | 'lastOpenedAt' | 'settings' | 'pdf' | 'kind'> & {
  kind?: SongKind;
  defaultTrack?: number;
};

/** Fills in fields that older records lack. */
export function normalizeMeta(raw: Partial<SongMeta> & { id: string }): SongMeta {
  return {
    fileName: '',
    title: '',
    artist: '',
    trackCount: 0,
    size: 0,
    addedAt: 0,
    lastOpenedAt: null,
    ...raw,
    kind: raw.kind ?? 'score',
    settings: normalizeSettings(raw.settings),
    pdf: normalizePdfSettings(raw.pdf),
  };
}

const DB_NAME = 'guitar-tabber';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function addSong(info: NewSong, bytes: ArrayBuffer): Promise<SongMeta> {
  const db = await openDb();
  const { defaultTrack, ...rest } = info;
  const settings = defaultSettings();
  if (defaultTrack !== undefined) settings.shownTracks = [defaultTrack];
  const meta: SongMeta = {
    ...rest,
    kind: rest.kind ?? 'score',
    pdf: defaultPdfSettings(),
    id: newId(),
    addedAt: Date.now(),
    lastOpenedAt: null,
    settings,
  };
  const tx = db.transaction(['meta', 'files'], 'readwrite');
  tx.objectStore('meta').put(meta);
  tx.objectStore('files').put(bytes, meta.id);
  await done(tx);
  return meta;
}

export async function listSongs(): Promise<SongMeta[]> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const raw = await result(tx.objectStore('meta').getAll() as IDBRequest<SongMeta[]>);
  const all = raw.map(normalizeMeta);
  return all.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export async function getSong(id: string): Promise<SongMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const raw = await result(tx.objectStore('meta').get(id) as IDBRequest<SongMeta | undefined>);
  return raw && normalizeMeta(raw);
}

export async function getSongBytes(id: string): Promise<ArrayBuffer | undefined> {
  const db = await openDb();
  const tx = db.transaction('files', 'readonly');
  return result(tx.objectStore('files').get(id) as IDBRequest<ArrayBuffer | undefined>);
}

export async function updateSong(id: string, patch: Partial<Omit<SongMeta, 'id'>>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('meta', 'readwrite');
  const store = tx.objectStore('meta');
  const current = await result(store.get(id) as IDBRequest<SongMeta | undefined>);
  if (current) store.put({ ...current, ...patch, id });
  await done(tx);
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['meta', 'files'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('files').delete(id);
  await done(tx);
}

/** Asks the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Test hook: drop the cached connection so a fresh fake DB can be used. */
export async function _resetForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
