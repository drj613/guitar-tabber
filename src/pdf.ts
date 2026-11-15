// pdf.js is large, so it loads only when a PDF is imported or opened.
// The legacy build supports older Safari versions than the modern build.

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
export type PdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

let lib: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return lib;
}

/** True when the bytes start like a PDF (allowing some junk before the header). */
export function isPdf(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

export interface OpenedPdf {
  doc: PdfDocument;
  /** Frees the document and its worker. */
  close(): void;
}

export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  const m = await pdfjs();
  const task = m.getDocument({
    // pdf.js takes ownership of the buffer it is given, so hand it a copy.
    data: bytes.slice(),
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
  });
  try {
    return { doc: await task.promise, close: () => void task.destroy() };
  } catch (err) {
    void task.destroy();
    throw err;
  }
}

export async function inspectPdf(bytes: Uint8Array, fileName: string): Promise<{ title: string; artist: string; pageCount: number }> {
  const { doc, close } = await openPdf(bytes);
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
    const fallback = fileName.replace(/\.[^.]+$/, '');
    // Many PDFs carry a useless title like "Microsoft Word - doc1"; prefer the file name then.
    const title = info.Title?.trim();
    const useful = title && !/^(untitled|microsoft word|document\d*)/i.test(title);
    return { title: useful ? title : fallback, artist: info.Author?.trim() ?? '', pageCount: doc.numPages };
  } finally {
    close();
  }
}
