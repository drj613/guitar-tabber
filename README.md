# Guitar Tabber

A Guitar Pro file player that runs on an iPad with no internet connection. It is a web app hosted on GitHub Pages: open it once in Safari, add it to the Home Screen, and it works offline from then on.

**App:** https://drj613.github.io/guitar-tabber/

## What it does

- Opens `.gp`, `.gpx`, `.gp3`, `.gp4`, `.gp5`, `.gp6`, `.gp7`, `.gp8`, MusicXML and Capella files from the Files app.
- Keeps your tabs on the device (IndexedDB), so they open offline.
- Plays the whole arrangement with built-in instrument sounds.
- Tempo in BPM: slider, −/+ buttons (hold to repeat), tap the number to go back to the file's tempo.
- Click track and count-in toggles.
- Track picker: show one part or several, with mute, solo and volume per track. Hidden tracks still play, so you can read your part while the band plays along.
- Loop: tap a bar (or let playback reach it), press **From** and **To** to set the range, then **Loop**. With a mouse or Pencil you can also drag across bars to select them.
- View options: tab only, notes and tab, or notes only; page or single-line layout; zoom.
- Remembers each song's settings (tracks, mixer, tempo, click, loop, view).
- Keeps the screen awake while playing.

## Install on iPad

1. Open https://drj613.github.io/guitar-tabber/ in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open it from the Home Screen icon once while online. A "Ready to use offline" message appears when everything is cached.

Updates: when a new version is deployed, a "New version is ready" bar appears. Tap **Update**.

If there's no sound, check the volume. On older iPadOS versions the silent switch or Control Center mute also mutes web apps.

## Development

```sh
npm install
npm run dev              # local dev server
npm run fetch-fixtures   # downloads alphaTab's test files (not committed)
npm test                 # unit tests
npm run build
npx playwright install chromium
npm run test:offline     # builds must exist; loads, goes offline, reloads, plays
```

Pushing to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml`.

Built on [alphaTab](https://alphatab.net) (MPL-2.0), which renders and plays the files. Instrument sounds are the Sonivox soundfont bundled with alphaTab; the music font is Bravura (SIL OFL).
