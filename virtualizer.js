// Performance virtualization for currently mounted ChatGPT conversation turns.
// ChatGPT keeps ownership of the DOM; this module only applies reversible rendering hints.

(() => {
  const VIRTUAL_RENDER_STATES = Object.freeze({
    ACTIVE: 'active',
    WARM: 'warm',
    FROZEN: 'frozen'
  });

  const VIRTUALIZATION_DEFAULTS = Object.freeze({
    warmMarginPx: 3000,
    pinnedRecentTurns: 4,
    minTurnHeight: 8,
    resizeWidthTolerancePx: 48,
    navigationNeighborTurns: 1,
    navigationPinMs: 2600,
    resizeDebounceMs: 180
  });

  const VIRTUAL_STYLE_ID = 'chc-virtualizer-styles';
  const TURN_SELECTOR = 'section[data-testid^="conversation-turn-"][data-turn-id], article';

  class HeightCache {
    constructor(widthTolerancePx) {
      this.entries = new Map();
      this.widthTolerancePx = widthTolerancePx;
    }

    get(key, viewportWidth) {
      const entry = this.entries.get(key);
      if (!entry || entry.height <= 0) return null;
      if (
        viewportWidth > 0 &&
        entry.viewportWidth > 0 &&
        Math.abs(entry.viewportWidth - viewportWidth) > this.widthTolerancePx
      ) {
        return null;
      }
      return entry;
    }

    set(key, height, viewportWidth, intrinsicBlockSize = height) {
      if (!Number.isFinite(height) || height <= 0) return null;
      const entry = {
        height,
        intrinsicBlockSize: Math.max(0, intrinsicBlockSize),
        viewportWidth,
        timestamp: Date.now()
      };
      this.entries.set(key, entry);
      return entry;
    }

    delete(key) {
      this.entries.delete(key);
    }

    clear() {
      this.entries.clear();
    }
  }

  class TurnRegistry {
    constructor() {
      this.byKey = new Map();
      this.byElement = new WeakMap();
      this.byLayoutElement = new WeakMap();
    }

    register(state) {
      const previous = this.byKey.get(state.key);
      this.byKey.set(state.key, state);
      this.byElement.set(state.element, state);
      this.byLayoutElement.set(state.layoutElement, state);
      return previous && previous.element !== state.element ? previous : null;
    }

    getByKey(key) {
      return this.byKey.get(key) || null;
    }

    getByElement(element) {
      return this.byElement.get(element) || this.byLayoutElement.get(element) || null;
    }

    findForDescendant(element) {
      if (!element) return null;
      const direct = this.getByElement(element);
      if (direct) return direct;
      const turn = element.closest?.(TURN_SELECTOR);
      return turn ? this.byElement.get(turn) || null : null;
    }

    remove(state) {
      if (this.byKey.get(state.key) === state) {
        this.byKey.delete(state.key);
      }
      this.byElement.delete(state.element);
      this.byLayoutElement.delete(state.layoutElement);
    }

    values() {
      return Array.from(this.byKey.values());
    }

    clear() {
      this.byKey.clear();
      this.byElement = new WeakMap();
      this.byLayoutElement = new WeakMap();
    }
  }

  function isDocumentScrollRoot(element) {
    return !element ||
      element === document.scrollingElement ||
      element === document.documentElement ||
      element === document.body;
  }

  function getConversationScrollRoot(thread) {
    if (!thread) return document.scrollingElement || document.documentElement;

    let current = thread.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      const style = getComputedStyle(current);
      const overflowY = style.overflowY;
      const permitsScroll = /^(auto|scroll|overlay)$/.test(overflowY);
      if (permitsScroll && current.scrollHeight > current.clientHeight + 1) {
        return current;
      }
      current = current.parentElement;
    }

    return document.scrollingElement || document.documentElement;
  }

  function getCapabilityFailure() {
    if (typeof IntersectionObserver !== 'function') return 'intersection-observer-unsupported';
    if (typeof ResizeObserver !== 'function') return 'resize-observer-unsupported';
    if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') {
      return 'css-supports-unsupported';
    }
    if (!CSS.supports('content-visibility', 'hidden')) {
      return 'content-visibility-unsupported';
    }
    if (!CSS.supports('contain-intrinsic-block-size', '1px')) {
      return 'contain-intrinsic-block-size-unsupported';
    }
    return '';
  }

  function ensureVirtualizerStyles() {
    if (document.getElementById(VIRTUAL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = VIRTUAL_STYLE_ID;
    style.textContent = `
      [data-chc-virtual-state="frozen"] {
        content-visibility: hidden !important;
        contain-intrinsic-block-size: var(--chc-intrinsic-height) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function nextAnimationFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  class PerformanceVirtualizer {
    constructor(adapter, options = {}) {
      this.adapter = adapter;
      this.options = { ...VIRTUALIZATION_DEFAULTS, ...options };
      this.registry = new TurnRegistry();
      this.heightCache = new HeightCache(this.options.resizeWidthTolerancePx);
      this.enabled = false;
      this.destroyed = false;
      this.debugEnabled = false;
      this.unsupportedReason = getCapabilityFailure();
      this.conversationId = '';
      this.thread = null;
      this.scrollRoot = null;
      this.warmObserver = null;
      this.activeObserver = null;
      this.resizeObserver = null;
      this.refreshFrame = null;
      this.resizeTimer = null;
      this.freezeCount = 0;
      this.thawCount = 0;
      this.resizeCount = 0;
      this.reconcileCount = 0;
      this.longTaskObserver = null;
      this.longTaskStats = { count: 0, totalDuration: 0, maxDuration: 0 };
      this.onWindowResize = this.onWindowResize.bind(this);
      this.onResourceLoad = this.onResourceLoad.bind(this);
    }

    init({ debug = false } = {}) {
      if (this.destroyed) return false;
      this.setDebugEnabled(debug);
      this.unsupportedReason = getCapabilityFailure();
      if (this.unsupportedReason) return false;
      ensureVirtualizerStyles();
      return true;
    }

    enable() {
      if (this.destroyed || !this.init({ debug: this.debugEnabled })) return false;
      if (this.enabled) {
        this.refresh();
        return true;
      }
      const thread = this.adapter.findThread();
      if (!thread) {
        this.unsupportedReason = 'thread-not-found';
        return false;
      }

      if (this.unsupportedReason === 'thread-not-found') this.unsupportedReason = '';
      this.enabled = true;
      this.thread = thread;
      this.scrollRoot = getConversationScrollRoot(thread);
      this.createObservers();
      window.addEventListener('resize', this.onWindowResize, { passive: true });
      document.addEventListener?.('load', this.onResourceLoad, true);
      this.startLongTaskObserver();
      this.refresh();
      return true;
    }

    disable() {
      this.enabled = false;
      if (this.refreshFrame !== null) {
        cancelAnimationFrame(this.refreshFrame);
        this.refreshFrame = null;
      }
      if (this.resizeTimer !== null) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
      }
      window.removeEventListener('resize', this.onWindowResize);
      document.removeEventListener?.('load', this.onResourceLoad, true);
      this.disconnectObservers();
      this.stopLongTaskObserver();
      this.registry.values().forEach((state) => this.unregisterTurn(state));
      this.registry.clear();
      document.getElementById(VIRTUAL_STYLE_ID)?.remove();
      this.thread = null;
      this.scrollRoot = null;
      this.conversationId = '';
    }

    destroy() {
      this.disable();
      this.heightCache.clear();
      this.destroyed = true;
    }

    createObservers() {
      this.disconnectObservers();
      const root = isDocumentScrollRoot(this.scrollRoot) ? null : this.scrollRoot;
      this.warmObserver = new IntersectionObserver(
        (entries) => this.handleWarmEntries(entries),
        { root, rootMargin: `${this.options.warmMarginPx}px 0px`, threshold: 0 }
      );
      this.activeObserver = new IntersectionObserver(
        (entries) => this.handleActiveEntries(entries),
        { root, rootMargin: '0px', threshold: 0 }
      );
      this.resizeObserver = new ResizeObserver((entries) => this.handleResizeEntries(entries));
    }

    disconnectObservers() {
      this.warmObserver?.disconnect();
      this.activeObserver?.disconnect();
      this.resizeObserver?.disconnect();
      this.warmObserver = null;
      this.activeObserver = null;
      this.resizeObserver = null;
    }

    scheduleRefresh() {
      if (!this.enabled || this.refreshFrame !== null) return;
      this.refreshFrame = requestAnimationFrame(() => {
        this.refreshFrame = null;
        this.refresh();
      });
    }

    refresh() {
      if (!this.enabled) return this.getStats();
      const thread = this.adapter.findThread();
      if (!thread) {
        this.registry.values().forEach((state) => this.unregisterTurn(state));
        this.thread = null;
        return this.getStats();
      }

      const nextScrollRoot = getConversationScrollRoot(thread);
      const rootChanged = thread !== this.thread || nextScrollRoot !== this.scrollRoot;
      this.thread = thread;
      this.scrollRoot = nextScrollRoot;
      if (rootChanged) this.createObservers();

      const conversationId = this.adapter.getConversationId();
      if (this.conversationId && conversationId !== this.conversationId) {
        this.registry.values().forEach((state) => this.unregisterTurn(state));
        this.heightCache.clear();
      }
      this.conversationId = conversationId;

      const turns = this.adapter.findTurnElements();
      const presentElements = new Set(turns);
      this.registry.values().forEach((state) => {
        if (!presentElements.has(state.element) || !state.element.isConnected) {
          this.unregisterTurn(state);
        }
      });

      const newStates = [];
      turns.forEach((turn, index) => {
        const id = this.adapter.getTurnId(turn, index);
        const key = `${conversationId}::${id}`;
        let state = this.registry.getByElement(turn);
        if (!state || state.key !== key) {
          state = this.registerTurn(turn, index, { id, key, conversationId });
          newStates.push(state);
        }
        state.index = index;
        state.role = this.adapter.getTurnRole(turn);
        state.isPinned = index >= Math.max(0, turns.length - this.options.pinnedRecentTurns);
        state.isStreaming = this.adapter.isStreamingTurn?.(turn, index, turns) || false;
        if (state.isPinned || state.isStreaming || state.manualPinnedUntil > Date.now()) {
          this.thawTurn(state, state.activeIntersecting
            ? VIRTUAL_RENDER_STATES.ACTIVE
            : VIRTUAL_RENDER_STATES.WARM);
        }
      });

      // Read all newly mounted turn geometry before any freeze writes.
      const viewportWidth = this.getViewportWidth();
      const measurements = newStates.map((state) => {
        const rect = state.layoutElement.getBoundingClientRect();
        return {
          state,
          height: rect.height,
          intrinsicBlockSize: this.getIntrinsicContentBlockSize(state.layoutElement, rect.height)
        };
      });
      measurements.forEach(({ state, height, intrinsicBlockSize }) => {
        this.measureTurn(state, height, viewportWidth, intrinsicBlockSize);
      });

      if (rootChanged) {
        this.registry.values().forEach((state) => this.observeState(state));
      }
      this.reconcileCount += 1;
      this.adapter.onStatsChange?.(this.getStats());
      return this.getStats();
    }

    registerTurn(element, index, metadata = {}) {
      const id = metadata.id || this.adapter.getTurnId(element, index);
      const conversationId = metadata.conversationId || this.adapter.getConversationId();
      const key = metadata.key || `${conversationId}::${id}`;
      const layoutElement = this.adapter.getTurnLayoutElement?.(element) || element;
      const state = {
        element,
        layoutElement,
        id,
        key,
        index,
        role: this.adapter.getTurnRole(element),
        conversationId,
        measuredHeight: 0,
        lastMeasuredAt: 0,
        viewportWidth: 0,
        renderState: VIRTUAL_RENDER_STATES.WARM,
        activeIntersecting: false,
        warmIntersecting: true,
        isStreaming: false,
        isPinned: false,
        manualPinnedUntil: 0
      };

      const previous = this.registry.register(state);
      if (previous) this.unregisterTurn(previous);
      layoutElement.dataset.chcVirtualTurnId = id;
      this.observeState(state);
      return state;
    }

    unregisterTurn(stateOrElement) {
      const state = stateOrElement?.element
        ? stateOrElement
        : this.registry.getByElement(stateOrElement);
      if (!state) return;
      this.warmObserver?.unobserve(state.layoutElement);
      this.activeObserver?.unobserve(state.layoutElement);
      this.resizeObserver?.unobserve(state.layoutElement);
      this.thawTurn(state);
      delete state.layoutElement.dataset.chcVirtualTurnId;
      this.registry.remove(state);
    }

    observeState(state) {
      this.warmObserver?.observe(state.layoutElement);
      this.activeObserver?.observe(state.layoutElement);
      if (state.renderState !== VIRTUAL_RENDER_STATES.FROZEN) {
        this.resizeObserver?.observe(state.layoutElement);
      }
    }

    measureTurn(
      stateOrElement,
      measuredHeight,
      viewportWidth = this.getViewportWidth(),
      measuredIntrinsicBlockSize
    ) {
      const state = stateOrElement?.element
        ? stateOrElement
        : this.registry.getByElement(stateOrElement);
      if (!state || state.renderState === VIRTUAL_RENDER_STATES.FROZEN) return false;
      const height = Number.isFinite(measuredHeight)
        ? measuredHeight
        : state.layoutElement.getBoundingClientRect().height;
      if (height < this.options.minTurnHeight) return false;
      const intrinsicBlockSize = Number.isFinite(measuredIntrinsicBlockSize)
        ? measuredIntrinsicBlockSize
        : this.getIntrinsicContentBlockSize(state.layoutElement, height);
      const entry = this.heightCache.set(state.key, height, viewportWidth, intrinsicBlockSize);
      state.measuredHeight = entry.height;
      state.lastMeasuredAt = entry.timestamp;
      state.viewportWidth = entry.viewportWidth;
      return true;
    }

    getIntrinsicContentBlockSize(element, borderBoxHeight) {
      const style = getComputedStyle(element);
      const blockExtras = [
        style.paddingTop,
        style.paddingBottom,
        style.borderTopWidth,
        style.borderBottomWidth
      ].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
      return Math.max(0, borderBoxHeight - blockExtras);
    }

    freezeTurn(stateOrElement) {
      const state = stateOrElement?.element
        ? stateOrElement
        : this.registry.getByElement(stateOrElement);
      if (!this.enabled || !state || state.renderState === VIRTUAL_RENDER_STATES.FROZEN) return false;
      if (
        state.isPinned ||
        state.isStreaming ||
        state.manualPinnedUntil > Date.now() ||
        state.element.dataset.chcHidden === 'true'
      ) {
        return false;
      }
      const cached = this.heightCache.get(state.key, this.getViewportWidth());
      if (!cached || cached.height < this.options.minTurnHeight) return false;

      state.measuredHeight = cached.height;
      state.lastMeasuredAt = cached.timestamp;
      state.viewportWidth = cached.viewportWidth;
      this.resizeObserver?.unobserve(state.layoutElement);
      state.layoutElement.style.setProperty(
        '--chc-intrinsic-height',
        `${Math.ceil(cached.intrinsicBlockSize)}px`
      );
      state.layoutElement.dataset.chcVirtualState = VIRTUAL_RENDER_STATES.FROZEN;
      state.renderState = VIRTUAL_RENDER_STATES.FROZEN;
      this.freezeCount += 1;
      this.adapter.onRenderStateChange?.(state);
      return true;
    }

    thawTurn(stateOrElement, nextState = VIRTUAL_RENDER_STATES.WARM) {
      const state = stateOrElement?.element
        ? stateOrElement
        : this.registry.getByElement(stateOrElement);
      if (!state) return false;
      const wasFrozen = state.renderState === VIRTUAL_RENDER_STATES.FROZEN ||
        state.layoutElement.dataset.chcVirtualState === VIRTUAL_RENDER_STATES.FROZEN;
      delete state.layoutElement.dataset.chcVirtualState;
      state.layoutElement.style.removeProperty('--chc-intrinsic-height');
      state.renderState = nextState;
      if (this.enabled) this.resizeObserver?.observe(state.layoutElement);
      if (wasFrozen) {
        this.thawCount += 1;
        this.adapter.onRenderStateChange?.(state);
      }
      return wasFrozen;
    }

    handleWarmEntries(entries) {
      entries.forEach((entry) => {
        const state = this.registry.getByElement(entry.target);
        if (!state) return;
        state.warmIntersecting = entry.isIntersecting || entry.intersectionRatio > 0;
        if (state.warmIntersecting) {
          this.thawTurn(state, state.activeIntersecting
            ? VIRTUAL_RENDER_STATES.ACTIVE
            : VIRTUAL_RENDER_STATES.WARM);
        } else {
          this.freezeTurn(state);
        }
      });
      this.adapter.onStatsChange?.(this.getStats());
    }

    handleActiveEntries(entries) {
      entries.forEach((entry) => {
        const state = this.registry.getByElement(entry.target);
        if (!state) return;
        state.activeIntersecting = entry.isIntersecting || entry.intersectionRatio > 0;
        if (state.renderState !== VIRTUAL_RENDER_STATES.FROZEN) {
          state.renderState = state.activeIntersecting
            ? VIRTUAL_RENDER_STATES.ACTIVE
            : VIRTUAL_RENDER_STATES.WARM;
        }
      });
      this.adapter.onStatsChange?.(this.getStats());
    }

    handleResizeEntries(entries) {
      const viewportWidth = this.getViewportWidth();
      entries.forEach((entry) => {
        const state = this.registry.getByElement(entry.target);
        if (!state || state.renderState === VIRTUAL_RENDER_STATES.FROZEN) return;
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize;
        const height = borderBox?.blockSize || entry.contentRect.height;
        if (this.measureTurn(state, height, viewportWidth, entry.contentRect.height)) {
          this.resizeCount += 1;
          if (!state.warmIntersecting) this.freezeTurn(state);
        }
      });
    }

    handleMutations(mutations) {
      if (!this.enabled) return;
      for (const mutation of mutations) {
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        const state = this.registry.findForDescendant(target);
        if (state?.renderState === VIRTUAL_RENDER_STATES.FROZEN) {
          this.pinState(state, this.options.navigationPinMs);
          this.thawTurn(state);
        }
      }
      this.scheduleRefresh();
    }

    pinState(state, durationMs = this.options.navigationPinMs) {
      if (!state) return;
      state.manualPinnedUntil = Math.max(state.manualPinnedUntil, Date.now() + durationMs);
      this.thawTurn(state, state.activeIntersecting
        ? VIRTUAL_RENDER_STATES.ACTIVE
        : VIRTUAL_RENDER_STATES.WARM);
      setTimeout(() => {
        if (!this.enabled || state.manualPinnedUntil > Date.now()) return;
        state.manualPinnedUntil = 0;
        if (!state.warmIntersecting) this.freezeTurn(state);
      }, durationMs + 20);
    }

    async prepareForNavigation(turnElement) {
      if (!this.enabled) return;
      let state = this.registry.getByElement(turnElement);
      if (!state) {
        this.refresh();
        state = this.registry.getByElement(turnElement);
      }
      if (!state) return;

      const states = this.registry.values().sort((a, b) => a.index - b.index);
      const stateIndex = states.indexOf(state);
      const start = Math.max(0, stateIndex - this.options.navigationNeighborTurns);
      const end = Math.min(states.length, stateIndex + this.options.navigationNeighborTurns + 1);
      const targets = states.slice(start, end);
      targets.forEach((target) => this.pinState(target));
      await nextAnimationFrame();
      await nextAnimationFrame();
      const viewportWidth = this.getViewportWidth();
      targets.forEach((target) => this.measureTurn(target, undefined, viewportWidth));
    }

    isTurnRenderedForEnhancement(turnElement) {
      if (!this.enabled) return true;
      const state = this.registry.getByElement(turnElement);
      return !state || state.renderState !== VIRTUAL_RENDER_STATES.FROZEN;
    }

    onWindowResize() {
      if (!this.enabled) return;
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.registry.values().forEach((state) => this.thawTurn(state));
      this.heightCache.clear();
      this.registry.values().forEach((state) => {
        state.measuredHeight = 0;
        state.lastMeasuredAt = 0;
      });
      this.resizeTimer = setTimeout(() => {
        this.resizeTimer = null;
        this.refresh();
      }, this.options.resizeDebounceMs);
    }

    onResourceLoad(event) {
      if (!this.enabled) return;
      const target = event.target;
      if (!target?.matches?.('img, picture, video')) return;
      const state = this.registry.findForDescendant(target);
      if (state?.renderState === VIRTUAL_RENDER_STATES.FROZEN) {
        this.pinState(state, this.options.navigationPinMs);
      }
    }

    getViewportWidth() {
      return isDocumentScrollRoot(this.scrollRoot)
        ? window.innerWidth
        : this.scrollRoot?.clientWidth || window.innerWidth;
    }

    setDebugEnabled(enabled) {
      this.debugEnabled = Boolean(enabled);
      if (this.enabled) {
        if (this.debugEnabled) this.startLongTaskObserver();
        else this.stopLongTaskObserver();
      }
    }

    startLongTaskObserver() {
      if (!this.debugEnabled || this.longTaskObserver || typeof PerformanceObserver !== 'function') return;
      if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            this.longTaskStats.count += 1;
            this.longTaskStats.totalDuration += entry.duration;
            this.longTaskStats.maxDuration = Math.max(this.longTaskStats.maxDuration, entry.duration);
          });
        });
        this.longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch (error) {
        this.longTaskObserver = null;
      }
    }

    stopLongTaskObserver() {
      this.longTaskObserver?.disconnect();
      this.longTaskObserver = null;
    }

    getStats() {
      const states = this.registry.values();
      return {
        enabled: this.enabled,
        registeredTurns: states.length,
        activeTurns: states.filter((state) => state.renderState === VIRTUAL_RENDER_STATES.ACTIVE).length,
        warmTurns: states.filter((state) => state.renderState === VIRTUAL_RENDER_STATES.WARM).length,
        frozenTurns: states.filter((state) => state.renderState === VIRTUAL_RENDER_STATES.FROZEN).length,
        measuredTurns: states.filter((state) => state.measuredHeight > 0).length,
        unsupportedReason: this.unsupportedReason,
        freezeCount: this.freezeCount,
        thawCount: this.thawCount,
        resizeCount: this.resizeCount,
        reconcileCount: this.reconcileCount
      };
    }

    getDiagnostic() {
      if (!this.debugEnabled) {
        return { enabled: false, reason: 'debug-mode-disabled' };
      }
      const thread = this.adapter.findThread();
      const turns = this.adapter.findTurnElements();
      const scrollRoot = thread ? getConversationScrollRoot(thread) : null;
      const loadedTurns = turns.map((turn, index) => {
        const state = this.registry.getByElement(turn);
        const rect = turn.getBoundingClientRect();
        return {
          index,
          id: this.adapter.getTurnId(turn, index),
          role: this.adapter.getTurnRole(turn),
          boundingRect: {
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          },
          measuredHeight: state?.measuredHeight || 0,
          renderState: state?.renderState || 'unregistered'
        };
      });
      return {
        conversationId: this.adapter.getConversationId(),
        loadedTurnCount: turns.length,
        userTurnCount: loadedTurns.filter((turn) => turn.role === 'user').length,
        assistantTurnCount: loadedTurns.filter((turn) => turn.role === 'assistant').length,
        threadElement: thread,
        scrollRoot,
        totalDomNodeCount: document.getElementsByTagName('*').length,
        conversationDomNodeCount: thread?.getElementsByTagName('*').length || 0,
        viewportHeight: isDocumentScrollRoot(scrollRoot)
          ? window.innerHeight
          : scrollRoot?.clientHeight || 0,
        scrollHeight: scrollRoot?.scrollHeight || document.documentElement.scrollHeight,
        loadedTurns,
        longTasks: {
          supported: typeof PerformanceObserver === 'function' &&
            PerformanceObserver.supportedEntryTypes?.includes('longtask'),
          count: this.longTaskStats.count,
          totalDuration: this.longTaskStats.totalDuration,
          maxDuration: this.longTaskStats.maxDuration
        },
        virtualization: this.getStats()
      };
    }
  }

  globalThis.__CHC_VIRTUALIZATION__ = Object.freeze({
    create(adapter, options) {
      return new PerformanceVirtualizer(adapter, options);
    },
    getConversationScrollRoot,
    defaults: VIRTUALIZATION_DEFAULTS,
    renderStates: VIRTUAL_RENDER_STATES
  });
})();
