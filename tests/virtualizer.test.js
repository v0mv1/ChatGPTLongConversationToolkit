const assert = require('node:assert/strict');
const path = require('node:path');

class FakeStyle {
  constructor() {
    this.values = new Map();
  }

  setProperty(name, value) {
    this.values.set(name, value);
  }

  removeProperty(name) {
    this.values.delete(name);
  }

  getPropertyValue(name) {
    return this.values.get(name) || '';
  }
}

class FakeElement {
  constructor(tagName = 'div', height = 0) {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.style = new FakeStyle();
    this.parentElement = null;
    this.children = [];
    this.isConnected = true;
    this.height = height;
    this.id = '';
    this.clientHeight = 800;
    this.clientWidth = 1200;
    this.scrollHeight = 800;
    this.attributes = new Map();
    this.className = '';
    this.nodeType = 1;
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    if (child.id) document.elementsById.set(child.id, child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    }
    if (this.id) document.elementsById.delete(this.id);
    this.parentElement = null;
    this.isConnected = false;
  }

  getBoundingClientRect() {
    return { top: 0, bottom: this.height, width: 800, height: this.height };
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  querySelectorAll() {
    return [];
  }

  matches(selector) {
    if (selector.includes(`#${this.id}`) && this.id) return true;
    if (selector.includes('[data-chc-placeholder="true"]') && this.dataset.chcPlaceholder === 'true') {
      return true;
    }
    if (selector.includes('.chc-bookmark-slot') && this.className.includes('chc-bookmark-slot')) {
      return true;
    }
    if (selector.includes('.chc-bookmark-button') && this.className.includes('chc-bookmark-button')) {
      return true;
    }
    if (selector.includes('.chc-panel') && this.className.includes('chc-panel')) return true;
    if (selector.includes('.chc-panel-toggle') && this.className.includes('chc-panel-toggle')) return true;
    if (selector.includes('section[data-testid') && this.tagName === 'SECTION' && this.dataset.turnId) {
      return true;
    }
    if (selector.includes('article') && this.tagName === 'ARTICLE') return true;
    if (selector.includes('img') && this.tagName === 'IMG') return true;
    if (selector.includes('video') && this.tagName === 'VIDEO') return true;
    if (selector.includes('source') && this.tagName === 'SOURCE') return true;
    return false;
  }

  closest(selector) {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest?.(selector) || null;
  }
}

class FakeIntersectionObserver {
  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.observed = new Set();
    this.disconnected = false;
  }

  observe(element) {
    this.observed.add(element);
  }

  unobserve(element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  emit(element, isIntersecting) {
    this.callback([{ target: element, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }]);
  }

  emitEntries(entries) {
    this.callback(entries.map(({ target, isIntersecting }) => ({
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0
    })));
  }
}

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
    this.disconnected = false;
  }

  observe(element) {
    this.observed.add(element);
  }

  unobserve(element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.disconnected = true;
    this.observed.clear();
  }

  emitEntries(entries) {
    this.callback(entries.map(({ target, height = target.height }) => ({
      target,
      borderBoxSize: [{ blockSize: height }],
      contentRect: { height }
    })));
  }
}

global.Node = { ELEMENT_NODE: 1 };
global.CSS = { supports: () => true };
global.IntersectionObserver = FakeIntersectionObserver;
global.ResizeObserver = FakeResizeObserver;
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.getComputedStyle = (element) => ({ overflowY: element.overflowY || 'visible' });

const html = new FakeElement('html');
const body = new FakeElement('body');
const head = new FakeElement('head');
html.appendChild(head);
html.appendChild(body);

global.document = {
  elementsById: new Map(),
  documentElement: html,
  body,
  head,
  scrollingElement: html,
  createElement: (tagName) => new FakeElement(tagName),
  getElementById(id) {
    return this.elementsById.get(id) || null;
  },
  getElementsByTagName() {
    return [];
  }
};

global.window = {
  innerHeight: 800,
  innerWidth: 1200,
  addEventListener() {},
  removeEventListener() {}
};

require(path.join(__dirname, '..', 'virtualizer.js'));

function makeTurn(id, role, height = 240) {
  const turn = new FakeElement('section', height);
  turn.dataset.turnId = id;
  turn.role = role;
  return turn;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createFixture({ debug = true, count = 8, conversationId = 'fixture-a' } = {}) {
  const scrollRoot = new FakeElement('main');
  scrollRoot.overflowY = 'auto';
  scrollRoot.clientHeight = 800;
  scrollRoot.scrollHeight = 10000;
  body.appendChild(scrollRoot);

  const thread = new FakeElement('div');
  thread.id = `thread-${conversationId}`;
  scrollRoot.appendChild(thread);
  const controller = {
    conversationId,
    thread,
    turns: Array.from({ length: count }, (_, index) =>
      makeTurn(`${conversationId}-turn-${index}`, index % 2 === 0 ? 'user' : 'assistant', 220 + index)
    )
  };
  controller.turns.forEach((turn) => thread.appendChild(turn));

  const virtualizer = global.__CHC_VIRTUALIZATION__.create({
    findThread: () => controller.thread,
    findTurnElements: () => controller.turns,
    getTurnId: (turn) => turn.dataset.turnId,
    getTurnRole: (turn) => turn.role,
    getConversationId: () => controller.conversationId,
    getTurnLayoutElement: (turn) => turn,
    isStreamingTurn: () => false
  }, {
    pinnedRecentTurns: 2,
    navigationNeighborTurns: 1,
    navigationPinMs: 10,
    resizeDebounceMs: 5
  });
  virtualizer.init({ debug });
  assert.equal(virtualizer.enable(), true);
  return { controller, scrollRoot, thread, virtualizer };
}

function makeContentMutation(target) {
  const node = new FakeElement('span');
  node.parentElement = target;
  return {
    type: 'childList',
    target,
    addedNodes: [node],
    removedNodes: []
  };
}

async function runAdditionalLifecycleTests() {
  {
    const { controller, virtualizer } = createFixture({ debug: false });
    const first = controller.turns[0];
    assert.equal(virtualizer.getStats().registeredTurns, controller.turns.length);
    assert.equal(virtualizer.getStats().reconcileCount, 0);
    assert.equal(virtualizer.getStats().maxTurnsProcessedPerReconcile, 0);

    virtualizer.warmObserver.emit(first, false);
    virtualizer.warmObserver.emit(first, true);
    virtualizer.handleMutations([{
      type: 'attributes',
      target: first,
      attributeName: 'data-chc-virtual-state',
      addedNodes: [],
      removedNodes: []
    }, makeContentMutation(first)]);
    virtualizer.resizeObserver.emitEntries([{ target: first }]);
    await sleep(15);
    virtualizer.warmObserver.emit(first, false);
    await sleep(35);
    virtualizer.warmObserver.emit(first, false);
    const image = new FakeElement('img');
    image.parentElement = first;
    virtualizer.onResourceLoad({ target: image });

    const stats = virtualizer.getStats();
    assert.equal(first.dataset.chcVirtualState, undefined, 'resource pin still updates live state');
    assert.deepEqual({
      freezeCount: stats.freezeCount,
      thawCount: stats.thawCount,
      mutationTriggeredThawCount: stats.mutationTriggeredThawCount,
      resourceTriggeredThawCount: stats.resourceTriggeredThawCount,
      observerTriggeredRefreshCount: stats.observerTriggeredRefreshCount,
      extensionMutationIgnoredCount: stats.extensionMutationIgnoredCount,
      resizeCount: stats.resizeCount,
      reconcileCount: stats.reconcileCount,
      maxTurnsProcessedPerReconcile: stats.maxTurnsProcessedPerReconcile
    }, {
      freezeCount: 0,
      thawCount: 0,
      mutationTriggeredThawCount: 0,
      resourceTriggeredThawCount: 0,
      observerTriggeredRefreshCount: 0,
      extensionMutationIgnoredCount: 0,
      resizeCount: 0,
      reconcileCount: 0,
      maxTurnsProcessedPerReconcile: 0
    }, 'historical diagnostics must not accumulate outside debug mode');
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const targets = controller.turns.slice(0, 3);
    const baseline = virtualizer.getStats();
    virtualizer.warmObserver.emitEntries([
      { target: targets[0], isIntersecting: false },
      { target: targets[1], isIntersecting: false }
    ]);
    virtualizer.warmObserver.emitEntries([
      { target: targets[1], isIntersecting: false },
      { target: targets[2], isIntersecting: false }
    ]);
    assert.equal(virtualizer.getStats().freezeCount, baseline.freezeCount + 3);
    assert.equal(virtualizer.getStats().reconcileCount, baseline.reconcileCount);
    targets.forEach((target) => assert.equal(target.dataset.chcVirtualState, 'frozen'));
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const targets = controller.turns.slice(0, 3);
    const baseline = virtualizer.getStats();
    virtualizer.resizeObserver.emitEntries(targets.slice(0, 2).map((target, index) => ({
      target,
      height: 300 + index
    })));
    virtualizer.resizeObserver.emitEntries([{ target: targets[2], height: 302 }]);
    assert.equal(virtualizer.getStats().resizeCount, baseline.resizeCount + 3);
    assert.equal(virtualizer.getStats().reconcileCount, baseline.reconcileCount);

    const sameFrameBaseline = virtualizer.getStats();
    virtualizer.resizeObserver.emitEntries([{ target: targets[0], height: 340 }]);
    virtualizer.warmObserver.emitEntries([{ target: targets[0], isIntersecting: false }]);
    assert.equal(virtualizer.getStats().resizeCount, sameFrameBaseline.resizeCount + 1);
    assert.equal(virtualizer.getStats().reconcileCount, sameFrameBaseline.reconcileCount);
    assert.equal(targets[0].dataset.chcVirtualState, 'frozen');
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const first = controller.turns[0];
    virtualizer.warmObserver.emit(first, false);
    const baseline = virtualizer.getStats();
    virtualizer.handleMutations([makeContentMutation(first)]);
    virtualizer.activeObserver.emitEntries([{ target: first, isIntersecting: true }]);
    assert.equal(virtualizer.getStats().reconcileCount, baseline.reconcileCount);
    await sleep(15);
    assert.equal(virtualizer.getStats().reconcileCount, baseline.reconcileCount + 1);
    assert.equal(virtualizer.getStats().mutationTriggeredThawCount,
      baseline.mutationTriggeredThawCount + 1);
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const first = controller.turns[0];
    virtualizer.warmObserver.emit(first, false);
    const baseline = virtualizer.getStats();
    virtualizer.handleMutations([makeContentMutation(first)]);
    virtualizer.resizeObserver.emitEntries([{ target: first, height: 360 }]);
    assert.equal(virtualizer.getStats().reconcileCount, baseline.reconcileCount);
    await sleep(15);
    assert.equal(virtualizer.getStats().reconcileCount, baseline.reconcileCount + 1);
    assert.equal(virtualizer.getStats().resizeCount, baseline.resizeCount + 1);
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const first = controller.turns[0];
    virtualizer.warmObserver.emit(first, false);
    const state = virtualizer.registry.getByElement(first);
    assert.equal(virtualizer.pinState(state, 10), true);
    assert.equal(first.dataset.chcVirtualState, undefined);
    await sleep(35);
    assert.equal(state.manualPinnedUntil, 0);
    assert.equal(first.dataset.chcVirtualState, 'frozen');
    assert.equal(virtualizer.pinTimers.has(state), false);
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const first = controller.turns[0];
    virtualizer.warmObserver.emit(first, false);
    const state = virtualizer.registry.getByElement(first);
    const staleWarmObserver = virtualizer.warmObserver;
    const staleActiveObserver = virtualizer.activeObserver;
    const staleResizeObserver = virtualizer.resizeObserver;
    virtualizer.pinState(state, 10);
    virtualizer.destroy();
    const afterDestroy = virtualizer.getStats();
    staleWarmObserver.emit(first, false);
    staleActiveObserver.emit(first, true);
    staleResizeObserver.emitEntries([{ target: first, height: 500 }]);
    await sleep(35);
    assert.equal(first.dataset.chcVirtualState, undefined);
    assert.equal(first.dataset.chcVirtualTurnId, undefined);
    assert.equal(virtualizer.getStats().registeredTurns, 0);
    assert.deepEqual(virtualizer.getStats(), afterDestroy,
      'pin timeout and stale observer delivery after destroy must be inert');
  }

  {
    const { controller, thread, virtualizer } = createFixture({ conversationId: 'route-a' });
    const oldFirst = controller.turns[0];
    const oldState = virtualizer.registry.getByElement(oldFirst);
    const staleWarmObserver = virtualizer.warmObserver;
    const staleActiveObserver = virtualizer.activeObserver;
    const staleResizeObserver = virtualizer.resizeObserver;
    virtualizer.warmObserver.emit(oldFirst, false);
    virtualizer.pinState(oldState, 10);

    controller.conversationId = 'route-b';
    controller.turns = Array.from({ length: 8 }, (_, index) =>
      makeTurn(`route-b-turn-${index}`, index % 2 === 0 ? 'user' : 'assistant', 260 + index)
    );
    controller.turns.forEach((turn) => thread.appendChild(turn));
    const beforeRoute = virtualizer.getStats();
    virtualizer.refresh();
    const afterRoute = virtualizer.getStats();
    assert.equal(afterRoute.reconcileCount, beforeRoute.reconcileCount + 1);
    assert.equal(afterRoute.registeredTurns, controller.turns.length);
    assert.equal(oldFirst.dataset.chcVirtualState, undefined);
    assert.equal(oldFirst.dataset.chcVirtualTurnId, undefined);

    staleWarmObserver.emit(oldFirst, false);
    staleActiveObserver.emit(oldFirst, true);
    staleResizeObserver.emitEntries([{ target: oldFirst, height: 510 }]);
    virtualizer.handleMutations([makeContentMutation(oldFirst)]);
    await sleep(35);
    assert.deepEqual(virtualizer.getStats(), afterRoute,
      'old conversation timeout/observer delivery must not affect the new registry');
    assert.equal(oldFirst.dataset.chcVirtualState, undefined);
    virtualizer.destroy();
  }

  {
    const { controller, virtualizer } = createFixture();
    const first = controller.turns[0];
    const staleWarmObserver = virtualizer.warmObserver;
    const staleActiveObserver = virtualizer.activeObserver;
    const staleResizeObserver = virtualizer.resizeObserver;
    virtualizer.disable();
    const afterDisable = virtualizer.getStats();
    staleWarmObserver.emit(first, false);
    staleActiveObserver.emit(first, true);
    staleResizeObserver.emitEntries([{ target: first, height: 520 }]);
    assert.deepEqual(virtualizer.getStats(), afterDisable,
      'observer callback delivery after disable must be inert');
    assert.equal(first.dataset.chcVirtualState, undefined);
  }

  {
    const { controller, virtualizer } = createFixture();
    const first = controller.turns[0];
    const state = virtualizer.registry.getByElement(first);
    virtualizer.warmObserver.emit(first, false);
    virtualizer.pinState(state, 50);
    virtualizer.scheduleRefresh('observer');
    virtualizer.onWindowResize();
    const navigation = virtualizer.prepareForNavigation(first);
    virtualizer.destroy();
    const afterDestroy = virtualizer.getStats();
    await navigation;
    await sleep(30);
    assert.deepEqual(virtualizer.getStats(), afterDestroy,
      'pending refresh/resize/navigation callbacks must be generation-guarded');
    assert.equal(first.dataset.chcVirtualState, undefined);
    assert.equal(first.style.getPropertyValue('--chc-intrinsic-height'), '');
  }
}

async function run() {
  const scrollRoot = new FakeElement('main');
  scrollRoot.overflowY = 'auto';
  scrollRoot.clientHeight = 800;
  scrollRoot.scrollHeight = 10000;
  body.appendChild(scrollRoot);

  const thread = new FakeElement('div');
  thread.id = 'thread';
  scrollRoot.appendChild(thread);
  let turns = Array.from({ length: 8 }, (_, index) =>
    makeTurn(`turn-${index}`, index % 2 === 0 ? 'user' : 'assistant', 200 + index * 10)
  );
  turns.forEach((turn) => thread.appendChild(turn));

  const virtualizer = global.__CHC_VIRTUALIZATION__.create({
    findThread: () => thread,
    findTurnElements: () => turns,
    getTurnId: (turn) => turn.dataset.turnId,
    getTurnRole: (turn) => turn.role,
    getConversationId: () => 'conversation-a',
    getTurnLayoutElement: (turn) => turn,
    isStreamingTurn: () => false
  }, {
    pinnedRecentTurns: 4,
    navigationNeighborTurns: 1,
    navigationPinMs: 10
  });

  assert.equal(virtualizer.init({ debug: true }), true);
  assert.equal(virtualizer.enable(), true);
  assert.equal(virtualizer.getStats().registeredTurns, 8);
  assert.equal(virtualizer.getStats().measuredTurns, 8);

  const first = turns[0];
  virtualizer.warmObserver.emit(first, false);
  assert.equal(first.dataset.chcVirtualState, 'frozen');
  assert.equal(first.dataset.chcFreezeStrategy, 'hidden');
  assert.equal(first.isConnected, true, 'freezing must not detach the turn');
  assert.match(first.style.getPropertyValue('--chc-intrinsic-height'), /px$/);

  const frozenStats = virtualizer.getStats();
  const extensionNode = new FakeElement('div');
  extensionNode.className = 'chc-bookmark-slot';
  extensionNode.parentElement = first;
  virtualizer.handleMutations([{
    type: 'childList',
    target: first,
    addedNodes: [extensionNode],
    removedNodes: []
  }, {
    type: 'attributes',
    target: first,
    attributeName: 'data-chc-virtual-state',
    addedNodes: [],
    removedNodes: []
  }, {
    type: 'attributes',
    target: first,
    attributeName: 'style',
    addedNodes: [],
    removedNodes: []
  }]);
  assert.equal(first.dataset.chcVirtualState, 'frozen', 'extension mutations must not thaw');
  assert.equal(virtualizer.getStats().extensionMutationIgnoredCount, 3);
  assert.equal(virtualizer.getStats().mutationTriggeredThawCount, 0);
  assert.equal(virtualizer.getStats().reconcileCount, frozenStats.reconcileCount);

  const chatGptNode = new FakeElement('span');
  chatGptNode.parentElement = first;
  virtualizer.handleMutations([{
    type: 'childList',
    target: first,
    addedNodes: [chatGptNode],
    removedNodes: []
  }, {
    type: 'childList',
    target: first,
    addedNodes: [new FakeElement('em')],
    removedNodes: []
  }]);
  assert.equal(first.dataset.chcVirtualState, undefined, 'content mutation must thaw once');
  assert.equal(virtualizer.getStats().mutationTriggeredThawCount, 1);
  assert.equal(virtualizer.getStats().observerTriggeredRefreshCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 30));
  virtualizer.warmObserver.emit(first, false);
  const image = new FakeElement('img');
  image.parentElement = first;
  virtualizer.onResourceLoad({ target: image });
  assert.equal(first.dataset.chcVirtualState, undefined, 'resource load must thaw frozen content');
  assert.equal(virtualizer.getStats().resourceTriggeredThawCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 30));
  const observerRefreshBaseline = virtualizer.getStats().observerTriggeredRefreshCount;
  const threadMutation = {
    type: 'childList',
    target: thread,
    addedNodes: [new FakeElement('section')],
    removedNodes: []
  };
  virtualizer.handleMutations([threadMutation]);
  virtualizer.handleMutations([threadMutation]);
  assert.equal(
    virtualizer.getStats().observerTriggeredRefreshCount,
    observerRefreshBaseline + 1,
    'observer-triggered refreshes must be batched'
  );
  await new Promise((resolve) => setTimeout(resolve, 10));

  const idleBaseline = virtualizer.getStats();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const idleAfter = virtualizer.getStats();
  assert.equal(idleAfter.mutationTriggeredThawCount, idleBaseline.mutationTriggeredThawCount);
  assert.equal(idleAfter.resourceTriggeredThawCount, idleBaseline.resourceTriggeredThawCount);
  assert.equal(idleAfter.observerTriggeredRefreshCount, idleBaseline.observerTriggeredRefreshCount);
  assert.equal(idleAfter.maxTurnsProcessedPerReconcile, 8);

  virtualizer.warmObserver.emit(first, true);
  assert.equal(first.dataset.chcVirtualState, undefined);
  assert.equal(virtualizer.getStats().warmTurns >= 1, true);

  virtualizer.warmObserver.emit(first, false);
  await virtualizer.prepareForNavigation(first);
  assert.equal(first.dataset.chcVirtualState, undefined, 'navigation must thaw before scrolling');

  await new Promise((resolve) => setTimeout(resolve, 30));
  virtualizer.warmObserver.emit(first, false);
  assert.equal(first.dataset.chcVirtualState, 'frozen');

  const replacement = makeTurn('turn-0', 'user', 310);
  first.isConnected = false;
  replacement.parentElement = thread;
  turns = [replacement, ...turns.slice(1)];
  virtualizer.refresh();
  assert.equal(first.dataset.chcVirtualState, undefined, 'unmounted instances must be cleaned');
  assert.equal(virtualizer.getStats().registeredTurns, 8, 'remount must replace, not duplicate, identity');

  virtualizer.warmObserver.emit(replacement, false);
  assert.equal(replacement.dataset.chcVirtualState, 'frozen');
  virtualizer.disable();
  assert.equal(replacement.dataset.chcVirtualState, undefined);
  assert.equal(replacement.dataset.chcVirtualTurnId, undefined);
  assert.equal(replacement.style.getPropertyValue('--chc-intrinsic-height'), '');
  assert.equal(virtualizer.getStats().registeredTurns, 0);

  replacement.isConnected = true;
  const autoVirtualizer = global.__CHC_VIRTUALIZATION__.create({
    findThread: () => thread,
    findTurnElements: () => turns,
    getTurnId: (turn) => turn.dataset.turnId,
    getTurnRole: (turn) => turn.role,
    getConversationId: () => 'conversation-a',
    getTurnLayoutElement: (turn) => turn,
    isStreamingTurn: () => false
  }, {
    freezeStrategy: 'auto',
    pinnedRecentTurns: 4,
    navigationPinMs: 10
  });
  assert.equal(autoVirtualizer.enable(), true);
  autoVirtualizer.warmObserver.emit(replacement, false);
  assert.equal(replacement.dataset.chcFreezeStrategy, 'auto');
  assert.equal(autoVirtualizer.getStats().freezeStrategy, 'auto');
  autoVirtualizer.disable();

  await runAdditionalLifecycleTests();
  console.log('virtualizer lifecycle tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
