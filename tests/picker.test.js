// Phase 4.3 — the puzzle picker, and the reset that comes with it.
//
// Switching boards is mostly a test of what gets left behind. Cell state is the
// obvious thing to clear and the easy one to remember; the violation flags and
// the solved marker live on elements rather than in cellStates, and those are
// the ones that survive a careless switch.

const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('./harness');
const { loadApp, ROOT } = require('./dom-shim');

const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();
const starter = PUZZLES[0];
const nine = PUZZLES.find((p) => p.size === 9);

suite('picker — what it offers');

test('there is one button per puzzle, in order', () => {
  const app = loadApp();
  eq(app.picker.children.length, PUZZLES.length);
  eq(
    app.picker.children.map((b) => b.dataset.puzzleId),
    PUZZLES.map((p) => p.id)
  );
});

test('buttons are labelled by size, which is a fact, not by difficulty, which is a guess', () => {
  const app = loadApp();
  eq(app.pickerLabels(), PUZZLES.map((p) => `${p.size}×${p.size}`));
});

test('each button carries an accessible label naming the difficulty', () => {
  const app = loadApp();
  const missing = app.picker.children.filter((b) => !b.getAttribute('aria-label'));
  eq(missing.length, 0, 'every option needs a label a screen reader can use');
  ok(
    app.picker.children[0].getAttribute('aria-label').includes(starter.difficulty),
    app.picker.children[0].getAttribute('aria-label')
  );
});

test('they are real buttons, so keyboard activation comes for free', () => {
  const app = loadApp();
  // Reads the property rather than the attribute: `button.type = 'button'`
  // reflects to the attribute in a browser, but the shim does not model IDL
  // reflection, and the property is what both environments agree on.
  const wrong = app.picker.children.filter((b) => b.tag !== 'button' || b.type !== 'button');
  eq(wrong.length, 0, 'picker options must be <button type="button">');
});

suite('picker — selection');

test('the loaded puzzle is marked active on first load', () => {
  const app = loadApp();
  eq(app.activePuzzleId(), starter.id);
});

test('exactly one option is ever active', () => {
  const app = loadApp();
  app.choose(nine.id);
  const active = app.picker.children.filter((b) => b.dataset.active === 'true');
  eq(active.length, 1);
  eq(active[0].dataset.puzzleId, nine.id);
});

test('aria-pressed tracks the selection, not just the styling', () => {
  const app = loadApp();
  app.choose(nine.id);
  const pressed = app.picker.children
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.dataset.puzzleId);
  eq(pressed, [nine.id]);
});

test('a URL-selected puzzle is the one marked active', () => {
  const app = loadApp({ search: `?puzzle=${nine.id}` });
  eq(app.activePuzzleId(), nine.id);
});

suite('picker — switching rebuilds the board');

test('choosing a different size re-renders at the new size', () => {
  const app = loadApp();
  eq(app.size, starter.size);
  app.choose(nine.id);
  eq(app.size, 9);
  eq(app.board.children.length, 81);
});

test('the new board matches the new puzzle data', () => {
  const app = loadApp();
  app.choose(nine.id);
  const wrong = [];
  for (let row = 0; row < nine.size; row++) {
    for (let col = 0; col < nine.size; col++) {
      if (Number(app.cellAt(row, col).dataset.region) !== nine.regions[row][col]) {
        wrong.push(`${row},${col}`);
      }
    }
  }
  eq(wrong, []);
});

test('switching back and forth leaves a correct board each time', () => {
  const app = loadApp();
  app.choose(nine.id);
  app.choose(starter.id);
  eq(app.size, starter.size);
  eq(app.board.children.length, starter.size * starter.size);
  app.choose(nine.id);
  eq(app.size, 9);
});

suite('picker — the switch resets everything, not just the cells');

test('crowns and marks do not survive a switch', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.tap(2, 2);
  app.choose(nine.id);
  const dirty = app.board.children.filter((c) => c.dataset.state !== 'empty');
  eq(dirty.length, 0, 'every cell of the new board should start empty');
});

test('violation flags do not survive a switch', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  ok(app.highlighted().length > 0, 'set up a visible clash first');
  app.choose(nine.id);
  eq(app.highlighted(), [], 'flags live on elements, not in cellStates');
});

test('the solved state does not survive a switch', () => {
  const app = loadApp();
  app.placeCrowns(starter.solution);
  eq(app.solved(), true);
  app.choose(nine.id);
  eq(app.solved(), false);
  eq(app.board.dataset.solved, undefined);
  ok(!app.status.textContent.startsWith('Solved!'), app.status.textContent);
});

test('switching away from a solved board and back gives a fresh board', () => {
  const app = loadApp();
  app.placeCrowns(starter.solution);
  app.choose(nine.id);
  app.choose(starter.id);
  eq(app.solved(), false);
  const dirty = app.board.children.filter((c) => c.dataset.state !== 'empty');
  eq(dirty.length, 0);
});

// Every board is a different size, so a switch always rebuilds the grid and
// would clear cell state even by accident. Re-picking the *current* board is
// the one case where the reset has to be deliberate — and until Phase 6 adds a
// clear button, it is also the only way to start a board over.
test('re-picking the current puzzle restarts it', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  ok(app.highlighted().length > 0, 'set up something to clear');

  app.choose(starter.id);

  eq(app.size, starter.size, 'still the same board');
  eq(app.board.children.filter((c) => c.dataset.state !== 'empty').length, 0, 'cells cleared');
  eq(app.highlighted(), [], 'flags cleared');
});

test('re-picking a solved board clears the win', () => {
  const app = loadApp();
  app.placeCrowns(starter.solution);
  eq(app.solved(), true);
  app.choose(starter.id);
  eq(app.solved(), false);
});

test('the status line follows the new puzzle', () => {
  const app = loadApp();
  app.choose(nine.id);
  ok(app.status.textContent.includes(nine.id), app.status.textContent);
  ok(app.status.textContent.includes('9×9'), app.status.textContent);
});

test('an unknown-puzzle warning clears once a board is chosen', () => {
  const app = loadApp({ search: '?puzzle=nope' });
  eq(app.status.dataset.state, 'warning');
  app.choose(nine.id);
  eq(app.status.dataset.state, undefined, 'the address bar complaint is stale now');
  ok(!app.status.textContent.includes('nope'), app.status.textContent);
});

suite('picker — the new board is live, not just drawn');

test('the switched-in board accepts input', () => {
  const app = loadApp();
  app.choose(nine.id);
  app.tap(8, 8);
  eq(app.stateOf(8, 8), 'mark', 'delegated listeners must survive a re-render');
});

test('drag works on the switched-in board', () => {
  const app = loadApp();
  app.choose(nine.id);
  app.drag([[4, 0], [4, 1], [4, 2]]);
  eq([app.stateOf(4, 0), app.stateOf(4, 1), app.stateOf(4, 2)], ['mark', 'mark', 'mark']);
});

test('rules apply to the switched-in board', () => {
  const app = loadApp();
  app.choose(nine.id);
  app.placeCrown(0, 0);
  app.placeCrown(0, 4);
  eq(app.violations(), ['0,0', '0,4']);
});

test('the switched-in board can be solved', () => {
  const app = loadApp();
  app.choose(nine.id);
  app.placeCrowns(nine.solution);
  eq(app.solved(), true);
});

test('every puzzle in the set can be reached and solved through the picker', () => {
  const app = loadApp();
  for (const entry of PUZZLES) {
    app.choose(entry.id);
    eq(app.size, entry.size, `${entry.id} should render at its own size`);
    app.placeCrowns(entry.solution);
    eq(app.solved(), true, `${entry.id} should be solvable after switching to it`);
  }
});
