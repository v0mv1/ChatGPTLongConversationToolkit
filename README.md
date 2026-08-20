# ChatGPT Long Conversation Toolkit

A lightweight, local-first Chrome and Edge extension for searching, navigating, organizing, and revisiting long ChatGPT conversations.

Version 1.5.0-beta.1 is a beta pre-release that adds experimental Performance Virtualization as a third long-conversation management mode. The popup continues to offer Visual Hide and Temporary Trim, while advanced tools such as Conversation Navigator, search, and bookmarks stay behind a compact optional Navigator link.

It only works with conversation content currently available on the page. It does not delete ChatGPT account data or upload conversation content.

## Current Focus

Long Conversation Experience:

- Use the optional Navigator for search and local bookmarks
- Search loaded User and Assistant messages with message-level results from Navigator
- Bookmark important messages locally and return to them quickly from Navigator
- Jump to visible or visually hidden messages
- Keep recent conversation exchanges visible
- Hide older exchanges visually when a conversation becomes hard to scan
- Optionally discard older page nodes until refresh
- Optionally keep loaded turn DOM in place while freezing rendering work far from the viewport
- Stay local, lightweight, and privacy-first

The extension no longer treats performance cleanup as the core product promise. ChatGPT may lazy-load or virtualize conversation content, so Navigator and future Outline features are scoped to currently loaded content unless explicitly stated otherwise.

## Features

- Configurable recent-exchange limit, defaulting to 10 exchanges
- Visual Hide: lowest risk, expandable in place
- Temporary Trim: strongest page reduction, restored by refreshing ChatGPT
- Performance Virtualization (experimental): keeps loaded turn DOM, freezes distant rendering, and thaws before turns approach the viewport
- Optional Conversation Navigator with message-level search and local bookmarks
- Optional auto-maintain mode for long sessions
- Conversation exchange count badge
- English and Simplified Chinese UI

Advanced conversation tools are not shown in the main popup by default. Use the compact **Conversation Navigator** footer link when you want search, bookmarks, and jump navigation.

The Navigator shows matching User and Assistant messages with context previews, rather than only stepping through text matches. It only covers conversation content currently available in the ChatGPT page. With auto-maintain enabled, a hidden result is temporarily revealed without changing the hidden count or disabling the limit; it is hidden again when navigation moves away or closes. Content removed by Temporary Trim is not searchable until the page is refreshed.

Each loaded User or Assistant message can be bookmarked after Navigator is opened. Bookmark actions appear only on message hover, and bookmarked messages use a subtle star indicator. Bookmarks store only the conversation/message identifiers, a short preview, role, and timestamp in `chrome.storage.local`. They are not uploaded.

The Navigator keeps Search and Bookmarks as separate tabs. The Bookmarks tab always shows the current conversation's bookmark count.

## Privacy

- No backend
- No tracking
- No analytics
- No conversation upload

All behavior runs locally in the browser page. The extension does not store conversation snapshots or send conversation content anywhere. Search terms are not stored. Bookmarks remain in `chrome.storage.local`.

## Installation

### Chrome

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select this project folder

### Edge

1. Open `edge://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select this project folder

## Usage

1. Open a ChatGPT conversation on `chatgpt.com` or `chat.openai.com`
2. Click the extension icon

To search and revisit important content:

1. Click **Conversation Navigator** in the popup footer
2. Enter a keyword to see message-level results
3. Click a User or Assistant result to jump directly to that message
4. Use **Bookmark** on a message to save it locally
5. Open the Bookmarks tab to revisit or remove saved messages

To manage the visible conversation:

1. Set how many recent exchanges to keep visible
2. Choose a mode:
   - Visual Hide: lowest risk, expandable in place
   - Temporary Trim: strongest page reduction, restored by refreshing ChatGPT
   - Performance Virtualization: preserves continuous scrolling and loaded turn DOM while skipping most distant rendering work
3. Click **Organize conversation now**

Visual Hide shows an expandable placeholder for older messages. Temporary Trim leaves a non-expandable placeholder.

Performance Virtualization is distance-based, so the recent-exchange and auto-maintain settings do not apply to it. It operates only on turns ChatGPT currently mounts in the page. It never fetches or exposes server-side history that ChatGPT has not loaded, and it automatically fails open when required browser capabilities are unavailable.

## View Control Modes

### Visual Hide

- Uses reversible visual hiding for older loaded turns.
- Keeps hidden turn DOM available to the extension.
- Is simple and compatible, but changes the visible document length.

### Temporary Trim

- Removes selected loaded DOM until ChatGPT is refreshed.
- Can reduce DOM volume more aggressively.
- Has higher compatibility risk and cannot search removed turns before refresh.

### Performance Virtualization

- Keeps loaded ChatGPT conversation turn DOM and React ownership intact.
- Does not detach, replace, clone, or remove ChatGPT-managed turns.
- Dynamically classifies loaded turns as ACTIVE, WARM, or FROZEN.
- Freezes distant rendering with browser containment capabilities.
- Preserves approximate layout height through measured intrinsic size.
- Automatically thaws turns before they approach the viewport.
- Integrates with Navigator and Bookmark jumps by thawing their targets first.
- Protects recent turns and the active streaming response from intentional freezing.
- Isolates SPA conversation lifecycles and stale asynchronous callbacks.

Performance Virtualization manages only turns currently mounted by ChatGPT. Users can continue scrolling through loaded history, with nearby frozen turns restored before they enter the viewport. This is rendering containment, not server-side lazy loading, React virtualization, or DOM-removal virtualization.

It does not:

- Prevent ChatGPT from downloading conversation data.
- Prevent initial React or component creation.
- Detach or remove turn DOM as a performance strategy.
- Intercept ChatGPT backend APIs.
- Access server-side history that ChatGPT has not mounted.
- Guarantee faster cold-open or runtime performance.

The internal `content-visibility: hidden` and `auto` freeze strategies remain available for controlled testing. The production freeze strategy is still being evaluated and may change before stable v1.5.0.

## Beta Known Limitations

- Real-world performance improvement has not yet been established across a large set of authenticated ChatGPT long conversations.
- Cold-open performance is not yet optimized separately.
- `content-visibility: hidden` versus `auto` is still under real-world evaluation.
- Native Ctrl+F, keyboard accessibility, and accessibility-tree behavior require broader validation.
- ChatGPT DOM or layout changes may require selector updates.
- Only currently mounted ChatGPT turns can be virtualized.

This mode is experimental and requires broader validation. No guaranteed performance improvement is claimed yet.

## Performance Diagnostics

Diagnostics are disabled by default. For development, set `debugMode: true` in `chrome.storage.local`, reload ChatGPT, then run `__CHC_DEBUG__.diagnose()` from the extension content-script console context. The report includes loaded turn counts and roles, thread and detected scroll root, DOM node counts, viewport and scroll dimensions, per-turn geometry and cached height, virtualization lifecycle counters, and Long Task totals when the browser supports that entry type. The internal `virtualizationFreezeStrategy` storage key accepts `hidden` or `auto` for benchmark A/B runs; it is intentionally not exposed in the popup and takes effect after a page reload.

The repository includes two no-dependency checks:

```text
node tests/virtualizer.test.js
python -m http.server 8765
# Open both strategy variants in Chromium:
# http://127.0.0.1:8765/tests/browser-harness.html?strategy=hidden&nativeFind=1
# http://127.0.0.1:8765/tests/browser-harness.html?strategy=auto&nativeFind=1
```

The browser harness validates freeze/thaw ownership, find/focus/selection proxies, mutation and resource-triggered thaw classification, responsive height invalidation, navigation pre-thaw, latest-turn pinning, and complete disable cleanup. It is not a substitute for benchmarking a real loaded ChatGPT conversation.

Search terms are not stored. Bookmark identifiers, short previews, roles, and timestamps are stored locally and are never uploaded.

## Links

- [Open Source](https://github.com/manxisuo/ChatGPTLongConversationToolkit)
- Feedback: [English](https://tally.so/r/2EDLp9) · [简体中文](https://tally.so/r/ZjZYAv)

## Upstream and Fork

This fork builds on the original [ChatGPT Long Conversation Toolkit](https://github.com/manxisuo/ChatGPTLongConversationToolkit) and preserves the original project attribution. This fork adds the experimental Performance Virtualization implementation and its synthetic validation, lifecycle hardening, benchmark protocol, and beta release documentation.

## Roadmap Principle

New features must answer yes to:

Does this improve long conversation experience?

Features outside that scope should not enter the main extension.
