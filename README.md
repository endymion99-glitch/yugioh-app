# YGO Collection Manager

A desktop app for tracking your Yu-Gi-Oh! card collection and building decks during a pack-opening tournament on [YGOprodeck](https://ygoprodeck.com). Each player runs their own copy. Everything stays on your computer; the only network calls go to the free YGOprodeck card database and image CDN.

## Features

- **Profile login.** Create a username and password on first launch. The password is stored as a bcrypt hash in the local database.
- **Collection binder.** A grid of the cards you own with copy counts, a name filter, type filters and sorting. Click a card for full details or to change how many copies you have.
- **Imports.** Every import opens a review screen first, so you can fix anything before it's added:
  - **Screenshot (OCR):** upload, drag in or paste (Ctrl+V) a screenshot of your opened packs. The app finds each card in the grid, reads its name and any copy-count overlay, and matches the name against YGOprodeck.
  - **.txt file:** one card name per line. Repeated lines count as extra copies, and `3x Card Name` also works.
  - **.ydk file:** every passcode in `#main`, `#extra` and `!side` is imported. Alternate artworks map to the same card.
  - **Manual search:** live YGOprodeck search. It's also built into the review screen so you can add anything the import missed.
- **Deck builder.** Click cards in your collection to add them. Fusion, Synchro, XYZ and Link monsters go to the Extra Deck automatically, and right-clicking a card puts it in the Side Deck. The deck is checked as you build it:
  - Main Deck 40–60, Extra Deck ≤ 15, Side Deck ≤ 15
  - at most 3 copies of a card across Main, Extra and Side
  - you can't add more copies than you own
  - there is no banlist

  A deck can only be saved when it passes every check. You can create, rename, delete and switch decks, and **export any deck as a `.ydk`** to import it on YGOprodeck.
- **Offline viewing.** Card data is cached in SQLite and card images are cached on disk (`ygo-img://` protocol). Once cached, your collection and decks display without internet.

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev      # start the app with hot reload
npm test         # unit tests (vitest)
npm run build    # production bundle in out/
```

The project has three parts:

```
src/
  main/            Electron main process
    db/            SQLite schema (versioned migrations), repositories
    ygoApi.js      YGOprodeck client: cache-first lookups, rate limiting, fuzzy name matching
    ocr.js         Tesseract.js worker pools (runs in worker threads)
    importService.js  screenshot / .txt / .ydk → review result
    imageCache.js  ygo-img:// protocol with on-disk image cache
    ipc.js         IPC handlers (auth, collection, imports, decks)
  preload/         contextBridge API (window.api)
  renderer/        React + Tailwind UI
  shared/          pure logic used by both sides and by the tests
                   (deck rules, .ydk/.txt parsing, card-grid detection, OCR parsing)
```

### Data

The database is `ygo-collection.sqlite` in Electron's `userData` folder (on Windows, `%APPDATA%\YGO Collection Manager`). Cached images go in `image-cache/` in the same folder. The schema lives in `src/main/db/schema.js`. To change it, append a new migration to `MIGRATIONS`. Never edit a migration that has already shipped.

### How screenshot OCR works

1. The renderer finds card rectangles by separating the cards from the plain background (`src/shared/cardGrid.js`).
2. For each card, it crops the name caption that YGOprodeck prints under the card. If there's no caption, it uses the name box at the top of the card instead. The crop is prepared as a dark-on-white version plus its inverse, so it doesn't matter whether the name is printed dark or light. When a caption is cut off ("Steel Ogre Grot..."), the card's own name box is also read and used to pick between cards whose names start the same way.
3. It looks for large glyphs in the card's bottom-right corner with an adaptive threshold and connected components (`src/shared/glyphs.js`). Each candidate is rendered as a clean mask image for the quantity overlay.
4. The main process runs Tesseract on those small images and matches the names to real cards with fuzzy search. It retries shorter prefixes and single words when OCR garbled a name.

If no card grid is found, the whole screenshot goes through Tesseract's sparse-text mode as a fallback.

### Pointing at a mock API

`YGO_API_BASE` and `YGO_IMAGE_BASE` replace the YGOprodeck API and image CDN URLs. This is useful for offline development or automated UI tests.

## Building the Windows installer

```bash
npm run dist:win   # NSIS installer + portable .exe in dist/
```

Run this on Windows. Building the Windows target from Linux or macOS needs Wine. The GitHub Actions workflow (`.github/workflows/build.yml`) builds both installers on a Windows runner and uploads them as the `windows-installers` artifact.

The builds are self-contained:

- better-sqlite3 ships Node-API prebuilt binaries, so there's no native compile step.
- Tesseract's English model is bundled, so OCR needs no downloads.
- Dependencies are unpacked from `app.asar` because Tesseract's worker threads can't load code from inside the archive.
