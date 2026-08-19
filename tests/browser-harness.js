const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runBrowserHarness() {
  const thread = document.getElementById('thread');
  const scrollRoot = document.getElementById('scroll-root');
  const turns = Array.from({ length: 40 }, (_, index) => {
    const turn = document.createElement('section');
    turn.className = 'turn';
    turn.dataset.turnId = `turn-${index}`;
    turn.dataset.role = index % 2 === 0 ? 'user' : 'assistant';
    const paragraphCount = 5 + index % 5;
    turn.innerHTML = `<h2>Turn ${index + 1}</h2>` +
      Array.from({ length: paragraphCount }, () =>
        '<p>This is synthetic long-conversation content used only to verify browser rendering behavior.</p>'
      ).join('');
    thread.appendChild(turn);
    return turn;
  });

  const domNodeCountBefore = document.getElementsByTagName('*').length;
  const scrollHeightBefore = scrollRoot.scrollHeight;
  const virtualizer = globalThis.__CHC_VIRTUALIZATION__.create({
    findThread: () => thread,
    findTurnElements: () => turns,
    getTurnId: (turn) => turn.dataset.turnId,
    getTurnRole: (turn) => turn.dataset.role,
    getConversationId: () => 'browser-harness',
    getTurnLayoutElement: (turn) => turn,
    isStreamingTurn: () => false
  }, {
    warmMarginPx: 1000,
    pinnedRecentTurns: 4,
    navigationNeighborTurns: 1,
    navigationPinMs: 500
  });

  const supported = virtualizer.enable();
  await sleep(500);
  const initialStats = virtualizer.getStats();
  const scrollHeightFrozen = scrollRoot.scrollHeight;
  const representativeDistantTurnFrozen = turns[10].dataset.chcVirtualState === 'frozen';
  const distantFrozen = turns.some((turn) => turn.dataset.chcVirtualState === 'frozen');
  const lastPinned = turns.at(-1).dataset.chcVirtualState !== 'frozen';

  await virtualizer.prepareForNavigation(turns[0]);
  turns[0].scrollIntoView({ block: 'center' });
  await sleep(200);
  const targetThawedForJump = turns[0].dataset.chcVirtualState !== 'frozen';

  virtualizer.disable();
  const domNodeCountAfter = document.getElementsByTagName('*').length;
  const frozenAttributesAfterDisable = document.querySelectorAll('[data-chc-virtual-state="frozen"]').length;
  const intrinsicStylesAfterDisable = turns.filter((turn) =>
    turn.style.getPropertyValue('--chc-intrinsic-height')
  ).length;

  const assertions = {
    supported,
    registeredAllTurns: initialStats.registeredTurns === turns.length,
    measuredAllTurns: initialStats.measuredTurns === turns.length,
    frozeDistantTurns: distantFrozen && initialStats.frozenTurns > 0,
    representativeDistantTurnWasFrozen: representativeDistantTurnFrozen,
    latestTurnStayedRendered: lastPinned,
    keptScrollHeight: Math.abs(scrollHeightFrozen - scrollHeightBefore) < 80,
    keptDomNodes: domNodeCountAfter >= domNodeCountBefore - 1,
    thawedTargetBeforeJump: targetThawedForJump,
    clearedFrozenState: frozenAttributesAfterDisable === 0,
    clearedIntrinsicStyles: intrinsicStylesAfterDisable === 0
  };
  const result = {
    passed: Object.values(assertions).every(Boolean),
    assertions,
    initialStats,
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
