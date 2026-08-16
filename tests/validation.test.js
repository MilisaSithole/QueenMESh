// Phase 3 — rule feedback reaching the board.
//
// rules.test.js proves the constraints are right. This proves they are wired
// up: that playing real gestures flags the right cells, clears them again, and
// announces a win at exactly the right moment. The two halves fail differently
// — correct rules that never render look identical to no rules at all.

const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('./harness');
const { loadApp, ROOT } = require('./dom-shim');
const { geometry5x5 } = require('./fixtures');

const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();
const starter = PUZZLES[0];

suite('validation — flags appear and clear as you play');

test('an untouched board flags nothing and is not solved', () => {
  const app = loadApp();
  eq(app.violations(), []);
  eq(app.solved(), false);
});

test('one crown is never a violation', () => {
  const app = loadApp();
  app.placeCrown(2, 2);
  eq(app.violations(), []);
});

test('a second crown in the same row flags both', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  eq(app.violations(), ['0,0', '0,3']);
});

test('removing the offending crown clears both flags', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  app.tap(0, 3); // crown -> empty
  eq(app.stateOf(0, 3), 'empty');
  eq(app.violations(), [], 'the surviving crown must not stay flagged');
});

test('adjacent crowns flag diagonally too', () => {
  const app = loadApp();
  app.placeCrown(1, 1);
  app.placeCrown(2, 2);
  ok(app.violatingAt(1, 1) && app.violatingAt(2, 2), `flagged ${app.violations()}`);
});

test('marking cells never flags anything', () => {
  const app = loadApp();
  app.drag([[0, 0], [0, 1], [0, 2], [0, 3]]);
  eq(app.violations(), []);
  eq(app.solved(), false);
});

test('a drag that paints marks around a crown leaves it unflagged', () => {
  const app = loadApp();
  app.placeCrown(2, 2);
  app.drag([[2, 0], [2, 1]]);
  eq(app.violations(), []);
});

suite('validation — the whole row, column or region is highlighted');

test('a row clash highlights the entire row', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  eq(app.violations(), ['0,0', '0,3'], 'the crowns keep the strong marker');
  eq(app.scope(), ['0,1', '0,2', '0,4'], 'the rest of row 0 is tinted');
  eq(app.highlighted().length, starter.size, 'exactly one row, nothing else');
});

test('a column clash highlights the entire column', () => {
  const app = loadApp();
  app.placeCrown(0, 1);
  app.placeCrown(3, 1);
  eq(app.violations(), ['0,1', '3,1']);
  eq(app.scope(), ['1,1', '2,1', '4,1']);
});

test('a region clash highlights the whole region, however it is shaped', () => {
  // Uses a frozen board: this names exact cells, so it is a test about one
  // particular L-shaped region rather than about whatever currently ships.
  const app = loadApp({ puzzle: geometry5x5 });
  const regionOne = [];
  for (let row = 0; row < geometry5x5.size; row++) {
    for (let col = 0; col < geometry5x5.size; col++) {
      if (geometry5x5.regions[row][col] === 1) regionOne.push(`${row},${col}`);
    }
  }
  app.placeCrown(0, 1);
  app.placeCrown(2, 0);
  eq(app.highlighted().sort(), regionOne.sort(), 'every cell of the region, and only those');
});

test('adjacency highlights only the two crowns, since it has no wider scope', () => {
  // Frozen board again: these two cells must be adjacent while sharing no row,
  // column or region, which is a property of a specific layout.
  const app = loadApp({ puzzle: geometry5x5 });
  app.placeCrown(1, 1);
  app.placeCrown(2, 2);
  eq(app.violations(), ['1,1', '2,2']);
  eq(app.scope(), [], 'an adjacency clash is a pair, not a line or an area');
});

test('overlapping clashes highlight the union', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3); // row 0 clash
  app.placeCrown(3, 3); // column 3 clash with (0,3)
  eq(app.violations(), ['0,0', '0,3', '3,3']);
  const highlighted = app.highlighted();
  for (const key of ['0,1', '0,2', '0,4', '1,3', '2,3', '4,3']) {
    ok(highlighted.includes(key), `${key} should be highlighted; got ${highlighted}`);
  }
});

test('the highlight clears completely when the clash is resolved', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  ok(app.highlighted().length > 0);
  app.tap(0, 3);
  eq(app.highlighted(), []);
});

test('a marked cell inside a highlighted row is still highlighted', () => {
  const app = loadApp();
  app.tap(0, 2); // leave a mark in the row about to clash
  app.placeCrown(0, 0);
  app.placeCrown(0, 4);
  eq(app.stateOf(0, 2), 'mark');
  ok(app.scope().includes('0,2'), 'the tint applies to the cell regardless of its contents');
});

suite('validation — winning');

test('the starter puzzle is solved by playing its solution', () => {
  const app = loadApp();
  app.placeCrowns(starter.solution);
  eq(app.violations(), []);
  eq(app.solved(), true);
  ok(app.status.textContent.startsWith('Solved!'), app.status.textContent);
  eq(app.status.dataset.state, 'solved');
});

test('the win fires on the final crown, not before', () => {
  const app = loadApp();
  const crowns = starter.solution.map((col, row) => [row, col]);

  for (let i = 0; i < crowns.length - 1; i++) {
    app.placeCrown(...crowns[i]);
    eq(app.solved(), false, `solved too early, after ${i + 1} crowns`);
  }

  app.placeCrown(...crowns[crowns.length - 1]);
  eq(app.solved(), true, 'the last crown should complete it');
});

test('the win needs no extra action after the final crown', () => {
  const app = loadApp();
  app.placeCrowns(starter.solution);
  eq(app.solved(), true);
  eq(app.status.dataset.state, 'solved', 'the status updates in the same gesture');
});

test('the 9x9 can be solved too', () => {
  const nine = PUZZLES.find((p) => p.id === 'curated-9x9');
  const app = loadApp({ search: '?puzzle=curated-9x9' });
  app.placeCrowns(nine.solution);
  eq(app.violations(), []);
  eq(app.solved(), true);
});

test('removing a crown from a solved board un-solves it', () => {
  const app = loadApp();
  app.placeCrowns(starter.solution);
  eq(app.solved(), true);

  app.tap(0, starter.solution[0]); // crown -> empty
  eq(app.solved(), false);
  eq(app.status.dataset.state, undefined, 'the solved styling must be removed too');
  ok(!app.status.textContent.startsWith('Solved!'), app.status.textContent);
});

test('a full board of crowns in one column does not win', () => {
  const app = loadApp();
  for (let row = 0; row < starter.size; row++) app.placeCrown(row, 0);
  eq(app.solved(), false);
  eq(app.violations().length, starter.size, 'every crown should be flagged');
});

test('the board carries data-solved only while solved', () => {
  const app = loadApp();
  eq(app.board.dataset.solved, undefined);
  app.placeCrowns(starter.solution);
  eq(app.board.dataset.solved, 'true');
  app.tap(0, starter.solution[0]);
  eq(app.board.dataset.solved, undefined);
});

suite('validation — flags survive the awkward paths');

test('a cancelled gesture still leaves rule state consistent', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  const id = app.down(4, 4);
  app.cancel(id);
  eq(app.violations(), ['0,0', '0,3'], 'existing flags must survive a cancel');
});

test('flags are recomputed from scratch, not accumulated', () => {
  const app = loadApp();
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  eq(app.violations(), ['0,0', '0,3']);

  // Clear the clash entirely — one tap takes a crown straight back to empty.
  app.tap(0, 0);
  app.tap(0, 3);
  eq([app.stateOf(0, 0), app.stateOf(0, 3)], ['empty', 'empty']);
  eq(app.violations(), [], 'flags must clear when the crowns causing them go');

  // Recreate the same clash in a different row; nothing from the old one
  // should linger.
  app.placeCrown(4, 0);
  app.placeCrown(4, 3);
  eq(app.violations(), ['4,0', '4,3']);
});
