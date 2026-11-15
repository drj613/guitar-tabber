// End-to-end offline check: build output served under /guitar-tabber/.
// Loads once online, then imports and opens PDFs with the network already cut
// (so the pdf.js code must come from the precache), then imports a Guitar Pro
// file, goes offline, reloads, plays, loops and taps.
// Usage: npm run build && npm run fetch-fixtures && npm run make-pdf-fixtures && npm run test:offline
import { spawn } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';

const PORT = 4179;
const URL = process.env.APP_URL ?? `http://localhost:${PORT}/guitar-tabber/`;
const server = process.env.APP_URL ? null : spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const fail = (msg) => { console.error('FAIL:', msg); cleanup(1); };
let browser;
process.on('unhandledRejection', (e) => fail(e?.message ?? String(e)));
async function cleanup(code) { await browser?.close(); server?.kill(); process.exit(code); }

if (server) await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('localhost') && resolve()));

const engines = { chromium, webkit };
const engine = engines[process.env.BROWSER ?? 'chromium'];
browser = await engine.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
// iPad Air-ish landscape viewport with touch input.
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(URL);
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 30000 });
await page.evaluate(() => navigator.serviceWorker.ready);
// Wait until precaching has finished (the SW is active).
await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 60000 });
await page.reload(); // now controlled by the SW
console.log('service worker active and controlling:', await page.evaluate(() => !!navigator.serviceWorker.controller));

// ---------- PDFs, fully offline ----------
await context.setOffline(true);
const inkOnPage = () =>
  page.evaluate(() => {
    const c = document.querySelector('.pdf-page canvas');
    if (!c) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 128) dark++;
    return dark;
  });
for (const [file, pages] of [['base14.pdf', 1], ['sample-tab.pdf', 3]]) {
  await page.goto(URL);
  await page.locator('input[type=file]').setInputFiles(`test/fixtures/${file}`);
  await page.waitForURL(/#\/song\//);
  await page.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  const ink = await inkOnPage();
  const info = await page.locator('.page-info').textContent();
  console.log(`offline PDF ${file}: ${info}, dark pixels sampled: ${ink}`);
  if (ink < 50) fail(`${file} rendered blank`);
  if (info !== `Page 1 of ${pages}`) fail(`${file} page count wrong: ${info}`);
}
// The scanned (raster) page draws too.
await page.locator('.pdf-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
await page.waitForFunction(() => document.querySelector('.pdf-page[data-page="3"] canvas'), null, { timeout: 15000 });
console.log('page 3 (raster) drawn:', await page.locator('.page-info').textContent());
// Zoom changes the page width.
const w0 = (await page.locator('.pdf-page').first().boundingBox()).width;
await page.getByRole('button', { name: 'Zoom out' }).click();
const w1 = (await page.locator('.pdf-page').first().boundingBox()).width;
console.log('zoom out width:', Math.round(w0), '->', Math.round(w1));
if (!(w1 < w0)) fail('zoom did not shrink the page');
// Click track: count beats at 120 BPM, change to 60 while running, count again.
await page.evaluate(() => {
  window.__beats = 0;
  new MutationObserver((ms) => { for (const m of ms) if (m.target.classList.contains('on') && !m.oldValue?.includes('on')) window.__beats++; })
    .observe(document.querySelector('.beat-dots'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
});
await page.locator('.bpm-slider').fill('120');
await page.getByRole('button', { name: 'Start click' }).click();
await page.waitForTimeout(3000);
const fast = await page.evaluate(() => window.__beats);
await page.locator('.bpm-slider').fill('60');
await page.evaluate(() => (window.__beats = 0));
await page.waitForTimeout(3000);
const slow = await page.evaluate(() => window.__beats);
console.log('beats in 3 s at 120:', fast, 'at 60:', slow);
if (fast < 5 || fast > 7 || slow < 2 || slow > 4) fail('click tempo is off');
await page.getByRole('button', { name: 'Stop click' }).click();
await page.waitForTimeout(500);
await page.goto(URL);
await page.waitForSelector('.song');
const pdfRow = await page.locator('.song', { hasText: 'sample-tab' }).locator('.song-sub').textContent();
console.log('library row:', pdfRow);
if (!pdfRow.includes('PDF, 3 pages')) fail('library row does not describe the PDF');
await page.locator('.song', { hasText: 'sample-tab' }).click();
await page.waitForSelector('.pdf-page canvas');
const kept = await page.locator('.bpm-value').textContent();
console.log('PDF tempo kept after reopening:', kept);
if (kept !== '60') fail('PDF tempo was not saved');
await context.setOffline(false);
await page.goto(URL);

await page.locator('input[type=file]').setInputFiles('test/fixtures/full-song.gpx');
await page.waitForURL(/#\/song\//);
await page.waitForSelector('.score-surface svg, .score-surface .at-surface', { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
const songUrl = page.url();
const shownOnOpen = await page.locator('.tracks li.shown .track-name span:first-child').allTextContents();
console.log('online render ok; track shown on first open:', shownOnOpen);
if (shownOnOpen.join() !== 'Emmpu(Acoustic)') fail('first open did not show the default guitar track');

await context.setOffline(true);
await page.goto(URL);
await page.waitForSelector('.song', { timeout: 15000 });
console.log('offline library ok:', await page.locator('.song-title').first().textContent());
await page.goto(songUrl);
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
const glyphs = await page.evaluate(() => document.querySelector('.at-surface')?.getBoundingClientRect().height ?? 0);
if (glyphs < 1000) fail(`offline score looks empty (surface ${glyphs}px tall)`);
console.log('offline render ok, surface height:', Math.round(glyphs));

// Tracks drawer lists all parts; show only the second guitar part.
await page.getByRole('button', { name: 'Tracks' }).click();
const trackRows = await page.locator('.tracks li').count();
console.log('tracks listed:', trackRows);
await page.locator('.track-name', { hasText: 'Emppu(Disto)' }).click();
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
await page.getByRole('button', { name: 'Tracks' }).click();

// Tempo + click, then play offline.
await page.getByRole('button', { name: 'Click', exact: true }).click();
await page.getByRole('button', { name: 'Slower' }).click();
const bpm = await page.locator('.bpm-value').textContent();
console.log('bpm after one step slower:', bpm);
await page.waitForFunction(() => document.querySelector('.play')?.title === '', null, { timeout: 30000 });
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForTimeout(3000);
const time = await page.locator('.time').textContent();
console.log('time after 3 s of play:', time);
if (!/^0:0[1-9]|^0:[1-9]/.test(time)) fail(`playback did not advance offline (${time})`);
await page.screenshot({ path: process.env.SHOT ?? 'test-results/offline-player.png' });

// Loop the bar playback is in, from the loop panel.
const loopBtn = () => page.getByRole('button', { name: 'Loop', exact: true });
const rangeBtn = () => page.getByRole('button', { name: 'Edit loop range' });
await page.getByRole('button', { name: 'Pause' }).click();
await rangeBtn().click();
await page.getByRole('button', { name: /^Loop bar \d+ only$/ }).click();
const loopLabel = await rangeBtn().textContent();
console.log('loop label:', loopLabel, 'loop on:', await loopBtn().getAttribute('aria-pressed'));
// Steppers move the end by one bar, and back.
await page.getByRole('button', { name: 'End bar later' }).click();
const stepped = await rangeBtn().textContent();
await page.getByRole('button', { name: 'End bar earlier' }).click();
console.log('end stepper:', loopLabel, '->', stepped, '->', await rangeBtn().textContent());
if (!/^Bars \d+–\d+$/.test(stepped) || (await rangeBtn().textContent()) !== loopLabel) fail('loop steppers misbehave');
await rangeBtn().click(); // close the panel
if (!/^Bar \d+$/.test(loopLabel)) fail('loop range not set');
// Settings persisted?
await page.waitForTimeout(800);
await page.reload();
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
const keptGp = {
  bpm: await page.locator('.bpm-value').textContent(),
  click: await page.getByRole('button', { name: 'Click', exact: true }).getAttribute('aria-pressed'),
  loop: await rangeBtn().textContent(),
};
console.log('after reload:', keptGp);
if (keptGp.bpm !== bpm || keptGp.click !== 'true' || keptGp.loop !== loopLabel) fail('settings were not saved');
// With the loop on, playback should stay inside that bar.
await page.waitForFunction(() => document.querySelector('.play')?.title === '', null, { timeout: 30000 });
await page.getByRole('button', { name: 'Play' }).click();
await page.waitForTimeout(8000);
const loopTime = await page.locator('.time').textContent();
const barNow = await page.locator('.bar-pos').textContent();
console.log('after 8 s with loop on:', loopTime, barNow);
if (barNow !== loopLabel) fail('playback left the loop');
// Touch: tapping a bar seeks without starting a loop; tap, Start, tap, End sets a range.
await page.getByRole('button', { name: 'Pause' }).click();
await rangeBtn().click();
await page.getByRole('button', { name: 'Clear loop range' }).click();
if ((await loopBtn().getAttribute('aria-pressed')) !== 'false') fail('clearing the range did not turn Loop off');
// (The panel stays open for the rest of the test.)
await page.locator('.score-scroll').evaluate((el) => el.scrollTo(0, 0));
const box = await page.locator('.at-surface').boundingBox();
// Returns the bar the loop panel would use, read from its "Use bar N" button.
const tapAt = async (fx, y) => {
  await page.touchscreen.tap(box.x + box.width * fx, box.y + y);
  await page.waitForTimeout(400);
  return (await page.getByRole('button', { name: 'Start at current bar' }).textContent()).replace('Use bar', 'Bar');
};
const firstTap = await tapAt(0.25, 460);
const afterTap = { bar: firstTap, loop: await loopBtn().getAttribute('aria-pressed'), label: await rangeBtn().textContent() };
console.log('after tap:', afterTap);
const playhead = await page.locator('.bar-pos').textContent();
if (playhead !== afterTap.bar) fail(`tap did not move the playhead (${playhead})`);
if (afterTap.bar === 'Bar 2' || afterTap.loop !== 'false' || afterTap.label !== 'Set range') fail('a tap should seek without starting a loop');
await page.getByRole('button', { name: 'Start at current bar' }).click();
// The panel stays open on the right; tap further down the left side.
const secondTap = await tapAt(0.2, 650);
await page.getByRole('button', { name: 'End at current bar' }).click();
const rangeLabel = await rangeBtn().textContent();
console.log('tap From, tap To:', firstTap, '->', secondTap, '=>', rangeLabel);
if (rangeLabel !== `Bars ${firstTap.slice(4)}–${secondTap.slice(4)}`) fail('tap-based loop range failed');
await page.screenshot({ path: 'test-results/loop-panel.png' });
if (errors.length) fail('page errors: ' + errors.join(' | '));
console.log('PASS');
cleanup(0);
