# Guitar Tabber

A Guitar Pro and PDF tab player that works with no internet connection. It's a web app on GitHub Pages that runs in any modern browser on a phone, tablet or computer. Install it once and it works offline from then on.

App: https://drj613.github.io/guitar-tabber/

## What it does

- Opens `.gp`, `.gpx`, `.gp3`, `.gp4`, `.gp5`, `.gp6`, `.gp7`, `.gp8`, MusicXML, Capella and PDF files.
- Stores your tabs in the browser (IndexedDB) on your device, so they open offline.
- Plays the full arrangement with alphaTab's built-in instrument sounds.
- Sets tempo in BPM. Use the slider or the − and + buttons (hold to repeat). Select the number to go back to the file's tempo.
- Toggles a click track and a one-bar count-in.
- Shows one part or several. Each track has mute, solo and volume. Hidden tracks keep playing, so you can read your part while the rest of the band plays.
- Loops a range of bars. Open the panel next to **Loop**, select a bar on the score and press **Use bar N** for the start or end, or nudge either end with − and +. **Loop bar N only** loops a single bar. With a mouse or stylus you can also drag across bars. Repeated sections loop on their first pass.
- Switches between tab only, notes and tab, or notes only, in page or single-line layout, with zoom.
- Remembers each song's tracks, mixer, tempo, click, loop and view.
- Keeps the screen awake while playing, where the browser allows it.

PDFs get a simpler view: the pages, zoom, and a click track with a BPM slider, tap tempo and beats per bar (the first beat is accented). The PDF doesn't play or follow along; the click just keeps time while you read. The app remembers each PDF's tempo, zoom and the page you were on.

## Install

Open https://drj613.github.io/guitar-tabber/, then install it so it gets its own icon and runs offline:

- **iPhone or iPad (Safari):** Share, then Add to Home Screen.
- **Android (Chrome):** the menu, then Install app or Add to Home screen.
- **Computer (Chrome or Edge):** the install icon at the right of the address bar. In other browsers, bookmark the page; it still works offline after the first visit.

Open the installed app once while you're online. A "Ready to use offline" message shows up once everything is cached. Then import your tabs from inside the installed app: on some systems, iOS in particular, an installed web app keeps storage separate from the browser, so tabs added in a browser tab won't show up there.

After an update goes live, the app shows "A new version is ready." Select Update.

No sound? Check the volume. On older iOS versions, the silent switch also mutes web apps.

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
