import { addSong, deleteSong, listSongs, type SongMeta } from './db';
import { h, toast } from './dom';
import { inspectScore, looksSupported } from './importer';
import { inspectPdf, isPdf } from './pdf';

export async function importFiles(files: FileList | File[]): Promise<SongMeta[]> {
  const existing = await listSongs();
  const added: SongMeta[] = [];
  for (const file of Array.from(files)) {
    if (existing.some((s) => s.fileName === file.name && s.size === file.size)) {
      toast(`${file.name} is already in your library`);
      continue;
    }
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (isPdf(bytes)) {
        const info = await inspectPdf(bytes, file.name);
        added.push(await addSong({ kind: 'pdf', fileName: file.name, size: file.size, trackCount: 0, ...info }, buffer));
      } else {
        const info = inspectScore(bytes, file.name);
        added.push(await addSong({ fileName: file.name, size: file.size, ...info }, buffer));
      }
    } catch (err) {
      console.error(err);
      const hint = looksSupported(file.name) || /\.pdf$/i.test(file.name)
        ? 'the file looks damaged or uses an unsupported version'
        : "it isn't a Guitar Pro file or a PDF";
      toast(`Couldn't open ${file.name}: ${hint}`, 5000);
    }
  }
  return added;
}

function describe(song: SongMeta): string {
  if (song.kind === 'pdf') return `PDF, ${song.pageCount ?? '?'} page${song.pageCount === 1 ? '' : 's'}`;
  return `${song.trackCount} track${song.trackCount === 1 ? '' : 's'}`;
}

export function renderLibrary(root: HTMLElement, open: (id: string) => void): () => void {
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true });
  const list = h('ul', { class: 'song-list' });
  const empty = h(
    'div',
    { class: 'empty' },
    h('p', {}, 'No tabs yet.'),
    h('p', { class: 'muted' }, "Tap Add tabs and pick Guitar Pro files (.gp, .gpx, .gp5 and older) or PDFs from the Files app. They're saved on this iPad and open without internet."),
  );

  async function refresh(): Promise<void> {
    const songs = await listSongs();
    list.replaceChildren(...songs.map(row));
    empty.hidden = songs.length > 0;
  }

  function row(song: SongMeta): HTMLElement {
    const del = h(
      'button',
      {
        class: 'icon-btn danger',
        'aria-label': `Delete ${song.title}`,
        onclick: async (e: Event) => {
          e.stopPropagation();
          if (!confirm(`Delete "${song.title}" from this device?`)) return;
          await deleteSong(song.id);
          await refresh();
        },
      },
      'Delete',
    );
    return h(
      'li',
      {},
      h(
        'button',
        { class: 'song', onclick: () => open(song.id) },
        h('span', { class: 'song-title' }, song.title),
        h(
          'span',
          { class: 'song-sub' },
          [song.artist, describe(song), song.fileName].filter(Boolean).join(' · '),
        ),
      ),
      del,
    );
  }

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files?.length) return;
    const added = await importFiles(fileInput.files);
    fileInput.value = '';
    await refresh();
    if (added.length === 1) open(added[0].id);
    else if (added.length > 1) toast(`Added ${added.length} tabs`);
  });

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.files.length) {
      await importFiles(e.dataTransfer.files);
      await refresh();
    }
  };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  window.addEventListener('drop', onDrop);
  window.addEventListener('dragover', onDragOver);

  root.replaceChildren(
    h(
      'div',
      { class: 'library' },
      h(
        'header',
        { class: 'bar' },
        h('h1', {}, 'Guitar Tabber'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, 'Add tabs'),
      ),
      h('main', { class: 'library-body' }, empty, list, fileInput),
    ),
  );
  void refresh();

  return () => {
    window.removeEventListener('drop', onDrop);
    window.removeEventListener('dragover', onDragOver);
  };
}
