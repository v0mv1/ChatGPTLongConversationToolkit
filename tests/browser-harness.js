const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

async function waitForFrozen(turn, timeoutMs = 1500) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (turn.dataset.chcVirtualState === 'frozen') return true;
    await sleep(50);
  }
  return turn.dataset.chcVirtualState === 'frozen';
}

function counterDelta(after, before) {
  return {
    mutationTriggeredThawCount:
      after.mutationTriggeredThawCount - before.mutationTriggeredThawCount,
    resourceTriggeredThawCount:
      after.resourceTriggeredThawCount - before.resourceTriggeredThawCount,
    observerTriggeredRefreshCount:
      after.observerTriggeredRefreshCount - before.observerTriggeredRefreshCount,
    thawCount: after.thawCount - before.thawCount,
    reconcileCount: after.reconcileCount - before.reconcileCount
  };
}

function findViewportAnchor(turns, scrollRoot) {
  const rootRect = scrollRoot.getBoundingClientRect();
  return turns.find((turn) => turn.getBoundingClientRect().bottom > rootRect.top + 80) || turns[0];
}

async function runResizeSequence(virtualizer, turns, scrollRoot) {
  const transitions = [
    { from: 1600, to: 1200 },
    { from: 1200, to: 900 },
    { from: 900, to: 1600 }
  ];
  const findings = [];

  for (const transition of transitions) {
    scrollRoot.scrollTop = Math.round((scrollRoot.scrollHeight - scrollRoot.clientHeight) * 0.45);
    await sleep(180);
    const anchor = findViewportAnchor(turns, scrollRoot);
    const rootRectBefore = scrollRoot.getBoundingClientRect();
    const anchorOffsetBefore = anchor.getBoundingClientRect().top - rootRectBefore.top;
    const scrollTopBefore = scrollRoot.scrollTop;

    scrollRoot.style.width = `${transition.to}px`;
    const rootRectAfterWidthChange = scrollRoot.getBoundingClientRect();
    const anchorOffsetAfterWidthChange =
      anchor.getBoundingClientRect().top - rootRectAfterWidthChange.top;
    virtualizer.onWindowResize();
    const expectedScrollHeight = scrollRoot.scrollHeight;
    await nextFrame();
    await sleep(650);

    const rootRectAfter = scrollRoot.getBoundingClientRect();
    const anchorOffsetAfter = anchor.getBoundingClientRect().top - rootRectAfter.top;
    const actualScrollHeight = scrollRoot.scrollHeight;
    const errorPercent = expectedScrollHeight > 0
      ? Math.abs(actualScrollHeight - expectedScrollHeight) / expectedScrollHeight * 100
      : 0;
    findings.push({
      ...transition,
      expectedScrollHeight,
      actualScrollHeight,
      errorPercent,
      scrollTopBefore,
      scrollTopAfter: scrollRoot.scrollTop,
      anchorId: anchor.dataset.turnId,
      anchorOffsetBefore,
      anchorOffsetAfterWidthChange,
      anchorOffsetAfter,
      scrollJumpPx: Math.abs(anchorOffsetAfter - anchorOffsetBefore),
      naturalReflowJumpPx: Math.abs(anchorOffsetAfterWidthChange - anchorOffsetBefore),
      virtualizationAddedJumpPx: Math.abs(anchorOffsetAfter - anchorOffsetAfterWidthChange)
    });
  }
  return findings;
}

async function runBrowserHarness() {
  const params = new URLSearchParams(location.search);
  const freezeStrategy = params.get('strategy') === 'auto' ? 'auto' : 'hidden';
  const runNativeFind = params.get('nativeFind') === '1';
  const nativeFindHoldMs = Number(params.get('nativeFindHoldMs')) || 0;
  const thread = document.getElementById('thread');
  const scrollRoot = document.getElementById('scroll-root');
  scrollRoot.style.width = '1600px';
  const reflowText = 'This is synthetic long-conversation content with enough words to exercise responsive text reflow across several viewport widths, including inline code, links, and naturally wrapping prose. '.repeat(2);

  const turns = Array.from({ length: 40 }, (_, index) => {
    const turn = document.createElement('section');
    turn.className = 'turn';
    turn.dataset.testid = `conversation-turn-${index}`;
    turn.dataset.turnId = `turn-${index}`;
    turn.dataset.role = index % 2 === 0 ? 'user' : 'assistant';
    const paragraphCount = 5 + index % 5;
    const uniqueText = index === 10
      ? '<span class="find-token">CHC_FIND_FROZEN_TOKEN</span>'
      : '';
    const resource = index === 22 ? '<img alt="synthetic resource" width="1" height="1">' : '';
    turn.innerHTML = `<h2>Turn ${index + 1}</h2>` +
      Array.from({ length: paragraphCount }, () =>
        `<p>${reflowText}</p>`
      ).join('') +
      uniqueText +
      resource +
      `<a href="#turn-${index}" class="focus-link">Focusable link ${index + 1}</a>`;
    thread.appendChild(turn);
    return turn;
  });

  const virtualizer = globalThis.__CHC_VIRTUALIZATION__.create({
    findThread: () => thread,
    findTurnElements: () => turns,
    getTurnId: (turn) => turn.dataset.turnId,
    getTurnRole: (turn) => turn.dataset.role,
    getConversationId: () => `browser-harness-${freezeStrategy}`,
    getTurnLayoutElement: (turn) => turn,
    isStreamingTurn: () => false
  }, {
    freezeStrategy,
    warmMarginPx: 1000,
    pinnedRecentTurns: 4,
    navigationNeighborTurns: 1,
    navigationPinMs: 350,
    resizeDebounceMs: 120
  });

  const mutationObserver = new MutationObserver((records) => virtualizer.handleMutations(records));
  mutationObserver.observe(thread, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true
  });

  const domNodeCountBefore = thread.getElementsByTagName('*').length;
  const scrollHeightBefore = scrollRoot.scrollHeight;
  virtualizer.init({ debug: true });
  const supported = virtualizer.enable();
  await sleep(750);

  const initialStats = virtualizer.getStats();
  const scrollHeightFrozen = scrollRoot.scrollHeight;
  const target = turns[10];
  const targetChild = target.querySelector('.find-token');
  const targetLink = target.querySelector('.focus-link');
  const representativeDistantTurnFrozen = target.dataset.chcVirtualState === 'frozen';
  const computedStrategy = getComputedStyle(target).contentVisibility;
  const childClientRectCountBeforeInteraction = targetChild.getClientRects().length;
  const extensionNavigatorFound = turns.find((turn) =>
    turn.textContent.includes('CHC_FIND_FROZEN_TOKEN')
  ) === target;

  const idleBaseline = virtualizer.getStats();
  await sleep(600);
  const idleAfter = virtualizer.getStats();
  const idleDelta = counterDelta(idleAfter, idleBaseline);

  if (nativeFindHoldMs > 0) {
    document.body.dataset.nativeFindReady = 'true';
    await sleep(nativeFindHoldMs);
    delete document.body.dataset.nativeFindReady;
  }

  let nativeFindResult = null;
  if (runNativeFind && typeof window.find === 'function') {
    getSelection().removeAllRanges();
    nativeFindResult = window.find('CHC_FIND_FROZEN_TOKEN', false, false, true, false, false, false);
    getSelection().removeAllRanges();
    scrollRoot.scrollTop = 0;
    await sleep(500);
  }

  targetLink.focus({ preventScroll: true });
  const programmaticFocusSucceeded = document.activeElement === targetLink;
  targetLink.blur();
  const selection = getSelection();
  selection.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(targetChild);
  selection.addRange(range);
  const programmaticSelectionText = selection.toString();
  selection.removeAllRanges();
  scrollRoot.scrollTop = 0;
  await sleep(500);

  const resizeFindings = await runResizeSequence(virtualizer, turns, scrollRoot);
  scrollRoot.scrollTop = 0;
  await sleep(500);

  const navigatorTarget = turns[12];
  await virtualizer.prepareForNavigation(navigatorTarget);
  navigatorTarget.scrollIntoView({ block: 'center' });
  const navigatorTargetThawed = navigatorTarget.dataset.chcVirtualState !== 'frozen';
  const bookmarkTarget = turns[18];
  await virtualizer.prepareForNavigation(bookmarkTarget);
  bookmarkTarget.scrollIntoView({ block: 'center' });
  const bookmarkTargetThawed = bookmarkTarget.dataset.chcVirtualState !== 'frozen';

  scrollRoot.scrollTop = 0;
  await sleep(800);
  const mutationTarget = turns[20];
  const mutationBaseline = virtualizer.getStats();
  const extensionNode = document.createElement('div');
  extensionNode.className = 'chc-bookmark-slot';
  mutationTarget.appendChild(extensionNode);
  await sleep(120);
  const afterExtensionMutation = virtualizer.getStats();
  const extensionMutationKeptFrozen = mutationTarget.dataset.chcVirtualState === 'frozen';

  const chatGptNode = document.createElement('span');
  chatGptNode.textContent = 'simulated ChatGPT async content';
  mutationTarget.appendChild(chatGptNode);
  await sleep(120);
  const afterContentMutation = virtualizer.getStats();
  const contentMutationThawed = mutationTarget.dataset.chcVirtualState !== 'frozen';

  await sleep(500);
  scrollRoot.scrollTop = 0;
  virtualizer.refresh();
  const resourceTarget = turns[22];
  const resourceTargetWasFrozen = await waitForFrozen(resourceTarget);
  const resourceBaseline = virtualizer.getStats();
  resourceTarget.querySelector('img').dispatchEvent(new Event('load'));
  await sleep(80);
  const afterResourceLoad = virtualizer.getStats();
  const resourceLoadThawed = resourceTarget.dataset.chcVirtualState !== 'frozen';

  await sleep(800);
  const settledBaseline = virtualizer.getStats();
  await sleep(600);
  const settledAfter = virtualizer.getStats();
  const settledDelta = counterDelta(settledAfter, settledBaseline);
  const latestTurnStayedRendered = turns.at(-1).dataset.chcVirtualState !== 'frozen';

  virtualizer.disable();
  mutationObserver.disconnect();
  const domNodeCountAfter = thread.getElementsByTagName('*').length;
  const frozenAttributesAfterDisable = document.querySelectorAll('[data-chc-virtual-state="frozen"]').length;
  const intrinsicStylesAfterDisable = turns.filter((turn) =>
    turn.style.getPropertyValue('--chc-intrinsic-height')
  ).length;

  const assertions = {
    supported,
    registeredAllTurns: initialStats.registeredTurns === turns.length,
    measuredAllTurns: initialStats.measuredTurns === turns.length,
    frozeDistantTurns: initialStats.frozenTurns > 0,
    representativeDistantTurnWasFrozen: representativeDistantTurnFrozen,
    appliedRequestedStrategy: computedStrategy === freezeStrategy,
    latestTurnStayedRendered,
    keptInitialScrollHeight:
      Math.abs(scrollHeightFrozen - scrollHeightBefore) / scrollHeightBefore * 100 < 1,
    resizeCacheStayedWithinOnePercent:
      resizeFindings.every((finding) => finding.errorPercent < 1),
    resizeVirtualizationAddedJumpWithinOnePixel:
      resizeFindings.every((finding) => finding.virtualizationAddedJumpPx < 1),
    extensionNavigatorFound,
    navigatorTargetThawed,
    bookmarkTargetThawed,
    extensionMutationDidNotThaw: extensionMutationKeptFrozen &&
      afterExtensionMutation.mutationTriggeredThawCount === mutationBaseline.mutationTriggeredThawCount,
    contentMutationThawedOnce: contentMutationThawed &&
      afterContentMutation.mutationTriggeredThawCount ===
        afterExtensionMutation.mutationTriggeredThawCount + 1,
    resourceLoadThawedOnce: resourceTargetWasFrozen && resourceLoadThawed &&
      afterResourceLoad.resourceTriggeredThawCount === resourceBaseline.resourceTriggeredThawCount + 1,
    idleHadNoUnexpectedActivity: Object.values(idleDelta).every((value) => value === 0),
    settledHadNoUnexpectedActivity: Object.values(settledDelta).every((value) => value === 0),
    keptConversationDom: domNodeCountAfter >= domNodeCountBefore,
    clearedFrozenState: frozenAttributesAfterDisable === 0,
    clearedIntrinsicStyles: intrinsicStylesAfterDisable === 0
  };

  const result = {
    passed: Object.values(assertions).every(Boolean),
    freezeStrategy,
    assertions,
    semantics: {
      rendering: {
        computedStrategy,
        childClientRectCountBeforeInteraction
      },
      nativeFindViaWindowFind: nativeFindResult,
      programmaticFocusSucceeded,
      programmaticSelectionText,
      extensionNavigatorFound,
      navigatorTargetThawed,
      bookmarkTargetThawed
    },
    mutationAudit: {
      idleDelta,
      settledDelta,
      extensionMutationIgnoredDelta:
        afterExtensionMutation.extensionMutationIgnoredCount - mutationBaseline.extensionMutationIgnoredCount,
      mutationTriggeredThawDelta:
        afterContentMutation.mutationTriggeredThawCount - afterExtensionMutation.mutationTriggeredThawCount,
      resourceTargetWasFrozen,
      resourceTriggeredThawDelta:
        afterResourceLoad.resourceTriggeredThawCount - resourceBaseline.resourceTriggeredThawCount
    },
    resizeFindings,
    initialStats,
    finalStats: settledAfter,
    scrollHeightBefore,
    scrollHeightFrozen,
    domNodeCountBefore,
    domNodeCountAfter
  };
  globalThis.__harnessResult = result;
  document.getElementById('result').textContent = JSON.stringify(result, null, 2);
}

runBrowserHarness().catch((error) => {
  globalThis.__harnessResult = { passed: false, error: error.stack || error.message };
  document.getElementById('result').textContent = JSON.stringify(globalThis.__harnessResult, null, 2);
});
