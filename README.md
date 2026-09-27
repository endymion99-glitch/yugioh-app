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
- **Deck builder.** Click cards in your collection to add them. Fusion, Synchro, XYZ and Link monsters go to the Extra Deck automatically, and right-clicking a card puts it in the Side Deck. Your collection can be narrowed to one monster type (Effect, Ritual, Fusion, Tuner, Pendulum…) and sorted by ATK or DEF, highest first. The deck is checked as you build it:
  - Main Deck 40–60, Extra Deck ≤ 15, Side Deck ≤ 15
  - at most 3 copies of a card across Main, Extra and Side
  - you can't add more copies than you own
  - there is no banlist

  A deck can only be saved when it passes every check. You can create, rename, delete and switch decks, and **export any deck as a `.ydk`** to import it on YGOprodeck.
- **Artwork recognition.** Screenshot imports match each card by its artwork as well as its name, and flag any disagreement for you to check.
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

### How screenshot import works

Each card is identified two ways, by its **artwork** and by its **name**, and the results are compared.

1. The renderer finds card rectangles by separating the cards from the plain background (`src/shared/cardGrid.js`).
2. **Artwork.** Each card's art box is turned into a fingerprint: a perceptual hash plus a tiny colour thumbnail (`src/shared/artHash.js`). The fingerprint is looked up in an index of every card image on YGOprodeck.
3. **Name.** The app reads the caption YGOprodeck prints under each card with Tesseract. If there's no caption, it reads the card's name box instead. The name is matched with fuzzy search. For captions cut off with "...", the card's name box helps choose between names that start the same way.
4. **Quantity.** The copy-count overlay is found with an adaptive threshold and connected components (`src/shared/glyphs.js`), then read by OCR.
5. **Deciding.**
   - When the artwork match is confident, the artwork decides. If the name clearly points to a different card, the review screen flags it and offers "Use <that card>".
   - Otherwise the name decides. If the artwork clearly isn't that card, that's flagged too.
   - Flagged cards appear first, next to the card as cropped from your screenshot.

If no card grid is found, the whole screenshot goes through Tesseract's sparse-text mode instead, using names only.

### The artwork index

`npm run art-index` downloads every card image from YGOprodeck (at up to 15 requests per second) and writes `resources/art-index.bin` (about 64 bytes per artwork). electron-builder bundles the file. The build is incremental: it keeps images already in an existing index, so refreshing only fetches new cards. The GitHub workflow builds the index, caches it between runs and bundles it into the Windows app. Without the file, the app falls back to matching names only, and the Import page says so.

### Pointing at a mock API

`YGO_API_BASE` and `YGO_IMAGE_BASE` replace the YGOprodeck API and image CDN URLs. This is useful for offline development or automated UI tests.

## Building the Windows installer

```bash
npm run dist:win   # NSIS installer + portable .exe in dist/
```

Run this on Windows. Building the Windows target from Linux or macOS needs Wine. The GitHub Actions workflow (`.github/workflows/build.yml`) builds both installers on a Windows runner and uploads them as the `windows-installers` artifact.

### Publishing a release

Bump `version` in `package.json` first so the file names match, then either:

- push a version tag (`git tag v0.1.0 && git push origin v0.1.0`), or
- on GitHub, open **Actions → Build → Run workflow**, tick **Publish a GitHub Release**, and run it. The tag is created from `package.json`'s version.

Either way the installers are built and published as a GitHub Release.

Players can always get the newest version from `https://github.com/endymion99-glitch/yugioh-app/releases/latest`.

The builds are self-contained:

- better-sqlite3 ships Node-API prebuilt binaries, so there's no native compile step.
- Tesseract's English model is bundled, so OCR needs no downloads.
- Dependencies are unpacked from `app.asar` because Tesseract's worker threads can't load code from inside the archive.
