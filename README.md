# Guitar Tabber

A Guitar Pro and PDF tab player for the iPad that works with no internet connection. It's a web app on GitHub Pages. Open it once, add it to the Home Screen, and after that it runs offline.

App: https://drj613.github.io/guitar-tabber/

## What it does

- Opens `.gp`, `.gpx`, `.gp3`, `.gp4`, `.gp5`, `.gp6`, `.gp7`, `.gp8`, MusicXML, Capella and PDF files from the Files app.
- Stores your tabs on the iPad in IndexedDB, so they open offline.
- Plays the full arrangement with alphaTab's built-in instrument sounds.
- Sets tempo in BPM. Use the slider or the − and + buttons (hold to repeat). Tap the number to go back to the file's tempo.
- Toggles a click track and a one-bar count-in.
- Shows one part or several. Each track has mute, solo and volume. Hidden tracks keep playing, so you can read your part while the rest of the band plays.
- Loops a range of bars. Open the panel next to **Loop**, then tap a bar on the score and press **Use bar N** for the start or end, or nudge either end with − and +. **Loop bar N only** loops a single bar. With a mouse or Pencil you can also drag across bars. Repeated sections loop on their first pass.
- Switches between tab only, notes and tab, or notes only, in page or single-line layout, with zoom.
- Remembers each song's tracks, mixer, tempo, click, loop and view.

PDFs get a simpler view: the pages, zoom, and a click track with a BPM slider, tap tempo and beats per bar (the first beat is accented). The PDF doesn't play or follow along; the click just keeps time while you read. The app remembers each PDF's tempo, zoom and the page you were on.
- Keeps the screen awake while playing.

## Install on the iPad

1. Open https://drj613.github.io/guitar-tabber/ in Safari.
2. Tap Share, then Add to Home Screen.
3. Open it from the new icon while you're still online. A "Ready to use offline" message shows up once everything is cached.
4. Import your tabs from inside the Home Screen app. It keeps its own storage, separate from Safari, so tabs added in a Safari tab won't show up there.

After an update goes live, the app shows "A new version is ready." Tap Update.

No sound? Check the volume. Older iPadOS versions also mute web apps when the silent switch or Control Center mute is on.

## Development

```sh
npm install
npm run dev              # local dev server
npm run fetch-fixtures   # downloads alphaTab's test files (not committed)
npm run make-pdf-fixtures  # writes test PDFs (needs Playwright's Chromium)
npm test                 # unit tests
npm run build
npx playwright install chromium
npm run test:offline     # needs a build; PDFs offline, then loads, goes offline, plays, loops
APP_URL=https://drj613.github.io/guitar-tabber/ npm run test:offline   # same, against the live site
```

A push to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

[alphaTab](https://alphatab.net) (MPL-2.0) renders and plays the Guitar Pro files, and [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0) draws the PDFs. The sounds come from the Sonivox soundfont bundled with alphaTab. The music font is Bravura (SIL OFL).
