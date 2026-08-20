# v1.5.0-beta.1 — Performance Virtualization

Pre-release / Beta

## What's New

- Added experimental Performance Virtualization mode.
- Added ACTIVE / WARM / FROZEN render lifecycle management for currently mounted ChatGPT turns.
- Added measured intrinsic-height preservation for continuous loaded-history scrolling.
- Added Navigator and Bookmark target pre-thaw behavior.
- Added protection for recent turns and the active streaming response.
- Added SPA conversation lifecycle and stale asynchronous callback isolation.
- Added `content-visibility: hidden` and `auto` freeze-strategy support for controlled testing.

Performance Virtualization keeps loaded ChatGPT-managed turn DOM intact. It does not detach, replace, clone, or remove those turns. Distant turns use browser containment to reduce off-screen rendering work and are restored before they approach the viewport.

## Reliability

- Shared IntersectionObserver and ResizeObserver lifecycle management.
- Extension-owned mutation feedback filtering for `data-chc-*`, `--chc-*`, Navigator, and Bookmark writes.
- Lifecycle generation guards across route changes, disable, and destroy.
- Protection from stale IO, RO, Mutation, timer, and requestAnimationFrame callbacks.
- Width-change height-cache invalidation and post-reflow anchor preservation.
- Debug-only historical lifecycle counters.
- Synthetic Chromium regression coverage for both freeze strategies.
- Observer burst, mixed-observer, pin/unpin, route/destroy, and stale-callback lifecycle tests.

## Current Status

This is a beta / experimental release.

The virtualization mechanism has passed synthetic Chromium and lifecycle testing, but broad real-world ChatGPT performance benchmarking is still ongoing.

No guaranteed performance improvement is claimed yet.

## Known Limitations

- Real-world performance improvement has not yet been established across a large set of authenticated ChatGPT long conversations.
- Cold-open performance is not yet optimized or benchmarked separately.
- `content-visibility: hidden` versus `auto` is still under real-world evaluation; the production strategy is not final.
- Native Ctrl+F, keyboard accessibility, and accessibility-tree behavior require broader Chrome and Edge validation.
- ChatGPT DOM or layout changes may require selector updates.
- Only turns currently mounted by ChatGPT can be virtualized.

Performance Virtualization does not prevent ChatGPT from downloading conversation data, prevent initial React/component creation, intercept backend APIs, or access server-side history that ChatGPT has not mounted.
