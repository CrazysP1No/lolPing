# Room video playback fix

**Goal:** Room members receive the original video, start from the beginning once it arrives, and keep it visible until playback ends.

**Cause:** Only the 12 KB WebP poster is transferred; remote art is explicitly resolved as a still.

**Implementation:** Keep the existing poster protocol and small control packets. Add authenticated, bounded video packets for original files, with content-hash descriptors, requests, chunk retries, traffic budgets, native decode validation and a bounded disk cache. Old clients retain the poster fallback. No new dependency or external upload service.

- [x] Add regression coverage for remote playback, delayed/repeat delivery, corrupt content and interrupted/replaced requests.
- [x] Add encrypted video packet format (up to 32768 bytes) without weakening the 1200-byte control limit.
- [x] Add validated video cache (8 files / 160 MB) and own-video reader; preserve original emote entries and locked-file accounting.
- [x] Transfer 6 KB LAN / 24 KB relay chunks with retries, route changes, content verification and two bounded incoming files.
- [x] Carry video descriptors and show a receiving poster; preserve mute/leave/newest-emote replacement and send cancellation even while paused.
- [x] Update UI copy and current docs to describe complete room video playback.
- [x] Verify LAN/relay integration, actual Electron playback on a receiver without local media, full tests, typecheck and build.

**Limits:** Existing 20 MB / 1920 px video import limit stays. First playback waits for transfer; subsequent sends use cached files. Public relays retain the existing publishing budget and may take longer for large files. Normal pings and still images retain their current packet format.

## Verification

- Full suite: 52 files, 866 passing tests, one Windows-specific skipped test on macOS.
- TypeScript, app production build and site build passed.
- Real Electron receiver with no local media received a 128365-byte six-second MP4 via actual loopback LAN UDP and an actual WebSocket connection to a local Nostr relay. It remained visible at 3.707 seconds and disappeared on ended; a repeated send used the cache immediately.
- Tests cover missing/corrupt chunks, route changes, validation finishing after cancellation, locked-cache-file accounting, muted playback and paused cancellation reaching the sender.
- Read-only review approved after the paused cancellation gate was fixed. Public relay delivery and Windows hardware playback were not exercised in this session.
