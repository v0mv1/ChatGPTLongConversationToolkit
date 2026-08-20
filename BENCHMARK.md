# Performance Virtualization Benchmark

Status: benchmark protocol and synthetic harness are complete; authenticated real ChatGPT runtime and cold-open benchmark runs have not yet been completed.

Performance Virtualization must be measured on the same loaded ChatGPT conversation, Chrome/Edge build, extension build, viewport, zoom, and machine. ChatGPT may mount only part of a conversation, so loaded DOM counts must not be reported as the server-side conversation size.

## Required groups

Run every scenario in this order after a fresh page load:

| Group | Configuration |
| --- | --- |
| A | Extension disabled |
| B | Visual Hide |
| C | Temporary Trim |
| D | Performance Virtualization with `content-visibility: auto` |
| E | Performance Virtualization with `content-visibility: hidden` |

Do not assume D or E wins. B and C are separate behavioral baselines, not equivalent rendering implementations.

The virtualization strategy is an internal benchmark switch, not a popup setting. In the extension content-script console context:

```js
chrome.storage.local.set({
  debugMode: true,
  virtualizationFreezeStrategy: 'auto' // or 'hidden'
})
```

Reload the ChatGPT tab after changing the strategy. The current runtime strategy is available in `__CHC_DEBUG__.diagnose().virtualization.freezeStrategy`.

## Required scenarios

Run and mark pass/fail for each group:

1. Cold open from a fresh tab.
2. Idle after currently mounted content settles.
3. Slow scroll from bottom to top and back down.
4. Fast scroll from bottom to top and back down.
5. Navigator jump to a distant Search result and Bookmark.
6. Native Chrome/Edge Ctrl+F for text in a distant turn.
7. Send a message and wait for the streaming response to finish.
8. Resize through 1600 -> 1200 -> 900 -> 1600 CSS pixels.
9. Switch to another conversation through ChatGPT SPA navigation and return.

For Ctrl+F, also record whether the match can be reached by Tab navigation, selected with the mouse/keyboard, and exposed by the browser accessibility tree. These are correctness checks, not performance metrics.

## Required evaluation dimensions

Record these separately for every group and scenario:

| Dimension | Evidence |
| --- | --- |
| Correctness | Missing/duplicate turns, stale streamed output, resource updates, console/React errors |
| UX | Ctrl+F, Tab order, selection, accessibility, Navigator and Bookmark behavior |
| Layout | DevTools trace Layout duration/count and unexpected reflows |
| Paint | DevTools trace Paint/Composite duration/count and blank/flickering regions |
| Long Tasks | Count, total duration, maximum duration for the same timed interaction |
| Memory | Browser task-manager/DevTools memory under the same settled conditions |
| DOM node count | Total nodes and conversation-subtree nodes |
| Scroll stability | Scroll height, anchor displacement, unexpected scroll jumps |

Also capture conversation ID, viewport and scroll-root geometry, loaded/user/assistant turn counts, ACTIVE/WARM/FROZEN/measured counts, and `maxTurnsProcessedPerReconcile`.

## Trace protocol

1. Close unrelated tabs and keep device power/thermal conditions stable.
2. Use the same long conversation and wait condition for all five groups.
3. Record a Chromium DevTools Performance trace for cold open and each timed interaction sequence.
4. Add markers or timestamps for the start/end of each scenario.
5. Repeat each group at least three times; report individual runs plus median, not only the best run.
6. Capture `__CHC_DEBUG__.diagnose()` before and after the interaction sequence.
7. Record visual defects and console errors even if trace numbers improve.

The Long Task API measures long main-thread JavaScript tasks only. It is useful debug evidence, but it is not a complete Layout/Paint benchmark. Rendering conclusions must come from Chromium DevTools Performance traces.

## Debug counters

Diagnostics are off by default. With `debugMode: true`, capture:

```text
registeredTurns
activeTurns
warmTurns
frozenTurns
measuredTurns
freezeCount
thawCount
mutationTriggeredThawCount
resourceTriggeredThawCount
observerTriggeredRefreshCount
extensionMutationIgnoredCount
reconcileCount
maxTurnsProcessedPerReconcile
```

For an idle settled page, deltas for mutation/resource thaw, observer-triggered refresh, thaw, and reconcile should be zero or explainable. If they are not, preserve the mutation samples and classify their origin before changing debounce values.

## Acceptance rules

- No group wins on a single metric.
- A rendering reduction is invalid if correctness, browser navigation, accessibility, or scroll stability regresses.
- Compare D and E directly; do not infer `hidden` is superior from stronger skipping semantics alone.
- Record natural text-reflow displacement separately from virtualization-added displacement during resize.
- Any repeated background thaw activity is a blocker until its mutation/resource cause is identified.

## Synthetic harness scope

`tests/browser-harness.html` is a deterministic Chromium mechanism test. It covers both freeze strategies, find/focus/selection probes, Navigator/Bookmark pre-thaw, extension/content/resource mutations, idle counters, and responsive width changes. It does not replace authenticated ChatGPT traces or browser accessibility inspection.
