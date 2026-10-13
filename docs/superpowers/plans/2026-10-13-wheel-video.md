# 16-slot wheels and video emotes

**Goal:** Both wheels have 16 slots, custom media has a shared limit of 100, and a video disappears only after playback ends.

**Architecture:** Reuse the current wheel editor, emote import IPC, atomic library writes and overlay stage. Keep images and animations on their existing timers; imported MP4/WebM uses a video element and its `ended` event. Room members continue receiving small stills.

**Stack:** Electron, TypeScript, React, browser media decoding, Vitest. No new dependencies.

- [x] Add regression tests for 16 directions, both defaults, legacy 8-slot migration, duplicate ping placement and 100 imports.
- [x] Increase both wheels to 16, migrate old entries into even slots to preserve their directions, and allow repeated signals.
- [x] Adjust editor geometry, icons and accessible direction labels to keep all 16 targets usable.
- [x] Test video import, persistence, malformed/oversized input, URL resolution, local video versus remote still, completion and cleanup.
- [x] Accept MP4/WebM, extract a small WebP poster, independently validate video decoding/dimensions in main, save bytes atomically and serve only hashed paths.
- [x] Play local videos muted through completion, release media on replacement/removal, and fall back to the poster on loading/playback errors. Images retain the 3-second lifetime.
- [x] Extend room still announcements to 17 refs while preserving the existing nine-ref field; test first-presence requests, LAN/relay transfer and seven members' cache retention.
- [x] Update both languages, import controls, generator defaults, READMEs and current design documentation.
- [x] Add gray, blue, gold, prismatic and void loot orbs with distinct transparent PNG art, localized names, default slots and room tests; keep their colours before hover.
- [x] Run targeted tests, all Vitest tests, TypeScript checking and production build; exercise video import and completion in Electron.

## Decisions and limits

- Preserve known entries in existing 8-slot layouts at the same compass directions; fill new emote slots with unused bundled refs.
- Imported video has no duration limit. The file size and dimensions remain bounded; unsupported codecs are rejected by browser decoding.
- Videos and images share the 100-item custom library.
- Video audio is muted, consistent with the current silent custom media. Room transfer remains a WebP still; original videos remain local.
- No video editor, transcoder, new dependency or installer release is part of this change.

## Verification

- `npm test`: 49 files, 839 passing tests, one existing skipped test.
- `npm run typecheck`, `npm run build` and `npm run build:site`: passed.
- Real Electron: five-second MP4/H.264 and WebM/VP9 import through the actual decoder and native validation, remain visible past 3.7 seconds, and disappear on `ended`.
- Native validation rejects fake MP4 payloads and 1922-pixel video, with no validation windows left behind.
- All five orb PNGs load in the production overlay, are 256 px with transparent corners, and retain their colours before hover. Screenshot: `docs/media/wheel-16-orbs.png`.
