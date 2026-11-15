// End-to-end offline check: build output served under /guitar-tabber/,
// load once online, import a tab, go offline, reload, open it and play.
// Usage: npm run build && npm run fetch-fixtures && npm run test:offline
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const PORT = 4179;
const URL = `http://localhost:${PORT}/guitar-tabber/`;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const fail = (msg) => { console.error('FAIL:', msg); cleanup(1); };
let browser;
process.on('unhandledRejection', (e) => fail(e?.message ?? String(e)));
async function cleanup(code) { await browser?.close(); server.kill(); process.exit(code); }

await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('localhost') && resolve()));

browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
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

await page.locator('input[type=file]').setInputFiles('test/fixtures/full-song.gpx');
await page.waitForURL(/#\/song\//);
await page.waitForSelector('.score-surface svg, .score-surface .at-surface', { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
const songUrl = page.url();
console.log('online render ok');

await context.setOffline(true);
await page.goto(URL);
await page.waitForSelector('.song', { timeout: 15000 });
console.log('offline library ok:', await page.locator('.song-title').first().textContent());
await page.goto(songUrl);
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
const glyphs = await page.locator('.score-surface .at-surface *').count();
if (glyphs < 50) fail(`offline score looks empty (${glyphs} elements)`);
console.log('offline render ok, elements:', glyphs);

// Tracks drawer lists all parts; show only the second guitar part.
await page.getByRole('button', { name: 'Tracks' }).click();
const trackRows = await page.locator('.tracks li').count();
console.log('tracks listed:', trackRows);
await page.locator('.track-name', { hasText: 'Emppu(Disto)' }).click();
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
await page.getByRole('button', { name: 'Tracks' }).click();

// Tempo + click, then play offline.
await page.getByRole('button', { name: 'Click' }).click();
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

// Settings persisted?
await page.getByRole('button', { name: 'Pause' }).click();
await page.waitForTimeout(800);
await page.reload();
await page.waitForFunction(() => document.querySelector('.score-overlay')?.hidden === true, null, { timeout: 30000 });
const kept = { bpm: await page.locator('.bpm-value').textContent(), click: await page.getByRole('button', { name: 'Click' }).getAttribute('aria-pressed') };
console.log('after reload:', kept);
if (kept.bpm !== bpm || kept.click !== 'true') fail('settings were not saved');
if (errors.length) fail('page errors: ' + errors.join(' | '));
console.log('PASS');
cleanup(0);
