// Writes test PDFs into test/fixtures (not committed):
//   sample-tab.pdf  3 pages of made-up tab, page 3 is a raster image like a scan
//   base14.pdf      1 page that uses Helvetica without embedding it
// Needs: npx playwright install chromium
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

await mkdir('test/fixtures', { recursive: true });

const staff = (n) => {
  const strings = ['e', 'B', 'G', 'D', 'A', 'E'];
  return strings
    .map((s, i) => `${s}|${Array.from({ length: 16 }, (_, k) => ((k * 3 + i * 5 + n) % 7 === 0 ? String((k + i + n) % 12).padEnd(3, '-') : '---')).join('')}|`)
    .join('\n');
};
const tabPage = (p) =>
  `<section><h1>Practice riff, page ${p}</h1>${[1, 2, 3, 4].map((n) => `<pre>${staff(n + p * 4)}</pre>`).join('')}</section>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<!doctype html><html><head><style>
  @page { size: A4; margin: 18mm; }
  body { font-family: sans-serif; }
  section { break-after: page; }
  pre { font: 14px/1.25 monospace; margin: 0 0 18px; }
  img { width: 100%; }
</style></head><body>
  ${tabPage(1)}${tabPage(2)}
  <section><h1>Scanned page</h1><img id="scan"></section>
  <script>
    const c = document.createElement('canvas'); c.width = 1200; c.height = 900;
    const g = c.getContext('2d'); g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 1200, 900);
    g.strokeStyle = '#222'; g.lineWidth = 2;
    for (let s = 0; s < 4; s++) for (let i = 0; i < 6; i++) { const y = 80 + s * 200 + i * 22; g.beginPath(); g.moveTo(40, y); g.lineTo(1160, y); g.stroke(); }
    g.font = '20px monospace'; g.fillStyle = '#111';
    for (let k = 0; k < 60; k++) g.fillText(String(k % 10), 60 + (k * 97) % 1080, 87 + ((k * 7) % 24) * 33);
    document.getElementById('scan').src = c.toDataURL('image/jpeg', 0.8);
  </script>
</body></html>`);
await page.waitForFunction(() => document.getElementById('scan').complete && document.getElementById('scan').naturalWidth > 0);
await writeFile('test/fixtures/sample-tab.pdf', await page.pdf({ format: 'A4' }));
await browser.close();

// A minimal hand-written PDF whose text uses the non-embedded base-14 Helvetica font.
const content = [
  'BT /F1 18 Tf 72 760 Td (Base-14 font test) Tj ET',
  ...['e', 'B', 'G', 'D', 'A', 'E'].map((s, i) => `BT /F1 14 Tf 72 ${700 - i * 18} Td (${s}|---3---5---7---5---3---0---|) Tj ET`),
].join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(pdf.length);
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await writeFile('test/fixtures/base14.pdf', pdf, 'latin1');
console.log('wrote test/fixtures/sample-tab.pdf and test/fixtures/base14.pdf');
