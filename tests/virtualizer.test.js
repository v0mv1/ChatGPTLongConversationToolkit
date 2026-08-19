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

  closest() {
    return this.turnOwner || null;
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
}

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.observed = new Set();
  }

  observe(element) {
    this.observed.add(element);
  }

  unobserve(element) {
    this.observed.delete(element);
  }

  disconnect() {
    this.observed.clear();
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

  assert.equal(virtualizer.enable(), true);
  assert.equal(virtualizer.getStats().registeredTurns, 8);
  assert.equal(virtualizer.getStats().measuredTurns, 8);

  const first = turns[0];
  virtualizer.warmObserver.emit(first, false);
  assert.equal(first.dataset.chcVirtualState, 'frozen');
  assert.equal(first.isConnected, true, 'freezing must not detach the turn');
  assert.match(first.style.getPropertyValue('--chc-intrinsic-height'), /px$/);

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

  console.log('virtualizer lifecycle tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
