# Performance Virtualization Benchmark

Performance Virtualization must be measured on the same loaded ChatGPT conversation and browser viewport in each mode. Do not infer complete server-side conversation size from the loaded DOM.

## Required comparison

Run each case after a fresh page load:

1. Extension disabled
2. Visual Hide
3. Temporary Trim
4. Performance Virtualization

Record:

- Conversation ID and viewport size
- Loaded, User, and Assistant turn counts
- Total and conversation DOM node counts
- Detected thread element and scroll root
- Viewport and scroll height
- Long Task count, total duration, and maximum duration during the same scroll sequence
- ACTIVE, WARM, and FROZEN turn counts
- Cold-open time until the page is interactable
- Any blank region, flicker, scroll jump, missing/duplicate message, React error, or console exception

## Debug collection

Diagnostics are off by default. Set `debugMode: true` in `chrome.storage.local`, reload the ChatGPT conversation, and run:

```js
__CHC_DEBUG__.diagnose()
```

Use the extension content-script console context. `PerformanceObserver` and the `longtask` entry type are feature-detected; unsupported metrics are reported as unavailable.

## Standard interaction sequence

1. Open the conversation and wait for currently mounted content to settle.
2. Capture the initial diagnostic.
3. Scroll to the bottom.
4. Scroll rapidly upward and then rapidly downward over the same distance.
5. Jump to a distant Search result.
6. Jump to a distant Bookmark.
7. Send a message and wait for streaming to finish.
8. Resize the window.
9. Switch tabs and return.
10. Navigate to another conversation through the ChatGPT SPA and return.
11. Capture the final diagnostic and console errors.

Do not claim a performance improvement unless at least one relevant Layout, Paint, or Long Task measure improves without correctness or scroll-stability regressions.

## Current evidence

The synthetic Chromium harness in `tests/browser-harness.html` verifies the rendering mechanism, not ChatGPT performance. With 40 synthetic turns it registered and measured all turns, froze 31 distant turns, preserved all conversation DOM nodes, kept the latest turn rendered, pre-thawed a navigation target, and fully cleared extension state on disable. Scroll height changed from 13926 px to 13946 px (20 px, approximately 0.14%).

Real ChatGPT before/after results remain pending because no authenticated long-conversation browser session was available during implementation.
