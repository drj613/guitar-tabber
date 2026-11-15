// Downloads test files from alphaTab's own test data. They are not committed.
import { mkdir, writeFile, access } from 'node:fs/promises';
const base = 'https://raw.githubusercontent.com/CoderLine/alphaTab/main/packages/alphatab/test-data/';
const files = ['conversion/full-song.gp', 'conversion/full-song.gpx', 'conversion/full-song.gp5'];
await mkdir('test/fixtures', { recursive: true });
for (const f of files) {
  const out = `test/fixtures/${f.split('/').pop()}`;
  try { await access(out); continue; } catch {}
  const res = await fetch(base + f);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  await writeFile(out, new Uint8Array(await res.arrayBuffer()));
  console.log('fetched', out);
}
