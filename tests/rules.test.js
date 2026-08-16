// Phase 3 — the four constraints, tested directly against rules.js.
//
// These run on hand-built state arrays rather than through the board, so a
// failure points at the rule and not at the rendering. The board-level
// wiring is covered separately in validation.test.js.

const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('./harness');
const { loadApp, ROOT } = require('./dom-shim');

const { EMPTY, CROWN, findViolations, isSolved, crownPositions } = loadApp().rules;
const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();

/** Regions where every cell is its own — isolates row/column/adjacency. */
const allDistinctRegions = (size) =>
  Array.from({ length: size }, (_, r) => Array.from({ length: size }, (_, c) => r * size + c));

/** Build a state array from a list of crown positions. */
function board(size, crowns) {
  const states = Array.from({ length: size }, () => new Array(size).fill(EMPTY));
  for (const [row, col] of crowns) states[row][col] = CROWN;
  return states;
}

/** A region grid where each row is its own region — isolates row/col/adjacency. */
const rowRegions = (size) =>
  Array.from({ length: size }, (_, r) => new Array(size).fill(r));

/** A region grid where each column is its own region. */
const colRegions = (size) =>
  Array.from({ length: size }, () => Array.from({ length: size }, (_, c) => c));

const flagged = (states, regions) => [...findViolations(states, regions).cells].sort();
const scopeOf = (states, regions) => [...findViolations(states, regions).scope].sort();

suite('rules — a clean board');

test('an empty board has no violations and is not solved', () => {
  const states = board(5, []);
  eq(flagged(states, rowRegions(5)), []);
  eq(isSolved(states, rowRegions(5)), false);
});

test('a single crown never violates anything', () => {
  const states = board(5, [[2, 2]]);
  eq(flagged(states, rowRegions(5)), []);
});

test('marks are notes, not commitments, so they never violate', () => {
  const states = board(5, []);
  states[0][0] = 1;
  states[0][1] = 1;
  states[1][0] = 1;
  eq(flagged(states, rowRegions(5)), []);
});

suite('rules — each constraint in isolation');

test('two crowns in a row are both flagged', () => {
  // Columns 0 and 3 so they are neither adjacent nor sharing a column.
  eq(flagged(board(5, [[0, 0], [0, 3]]), colRegions(5)), ['0,0', '0,3']);
});

test('two crowns in a column are both flagged', () => {
  eq(flagged(board(5, [[0, 1], [3, 1]]), rowRegions(5)), ['0,1', '3,1']);
});

test('two crowns in a region are both flagged', () => {
  // Rows 0 and 2, columns 0 and 3: no row, column or adjacency clash.
  const regions = rowRegions(5).map((row) => row.slice());
  regions[0][0] = 7;
  regions[2][3] = 7;
  eq(flagged(board(5, [[0, 0], [2, 3]]), regions), ['0,0', '2,3']);
});

test('three crowns in one row flag all three, not just the extras', () => {
  eq(flagged(board(7, [[0, 0], [0, 3], [0, 6]]), colRegions(7)), ['0,0', '0,3', '0,6']);
});

suite('rules — adjacency, including diagonals');

const neighbours = {
  'directly below': [1, 2],
  'directly above': [-1, 2],
  'directly right': [0, 3],
  'directly left': [0, 1],
  'diagonally down-right': [1, 3],
  'diagonally down-left': [1, 1],
  'diagonally up-right': [-1, 3],
  'diagonally up-left': [-1, 1],
};

for (const [name, [dr, dc]] of Object.entries(neighbours)) {
  test(`a crown ${name} clashes`, () => {
    const a = [2, 2];
    const b = [2 + dr, dc];
    const got = flagged(board(5, [a, b]), allDistinctRegions(5));
    ok(got.includes(`${a[0]},${a[1]}`) && got.includes(`${b[0]},${b[1]}`), `flagged ${got}`);
  });
}

test('a knight-move apart does not clash', () => {
  eq(flagged(board(5, [[2, 2], [0, 1]]), allDistinctRegions(5)), [], 'two rows and one column apart');
});

test('two apart diagonally does not clash', () => {
  eq(flagged(board(5, [[2, 2], [4, 4]]), allDistinctRegions(5)), []);
});

suite('rules — the scope of a violation');

test('a row clash scopes to the whole row', () => {
  eq(scopeOf(board(5, [[0, 0], [0, 3]]), colRegions(5)),
    ['0,0', '0,1', '0,2', '0,3', '0,4']);
});

test('a column clash scopes to the whole column', () => {
  eq(scopeOf(board(5, [[0, 1], [3, 1]]), rowRegions(5)),
    ['0,1', '1,1', '2,1', '3,1', '4,1']);
});

test('a region clash scopes to the whole region, whatever its shape', () => {
  // An L-shaped region: three cells down column 0 plus one alongside.
  const regions = allDistinctRegions(5).map((row) => row.slice());
  for (const [r, c] of [[0, 0], [1, 0], [2, 0], [2, 1]]) regions[r][c] = 99;
  eq(scopeOf(board(5, [[0, 0], [2, 1]]), regions),
    ['0,0', '1,0', '2,0', '2,1']);
});

test('an adjacency clash scopes to the two crowns and nothing else', () => {
  eq(scopeOf(board(5, [[1, 1], [2, 2]]), allDistinctRegions(5)), ['1,1', '2,2']);
});

// The documented contract, and the reason nothing downstream has to combine
// the two sets itself.
test('scope always contains every clashing crown', () => {
  const cases = [
    [board(5, [[0, 0], [0, 3]]), colRegions(5)],
    [board(5, [[0, 1], [3, 1]]), rowRegions(5)],
    [board(5, [[1, 1], [2, 2]]), allDistinctRegions(5)],
    [board(5, [[0, 0], [0, 2], [1, 4], [3, 1]]), rowRegions(5)],
  ];
  for (const [states, regions] of cases) {
    const { cells, scope } = findViolations(states, regions);
    const missing = [...cells].filter((key) => !scope.has(key));
    eq(missing, [], 'crowns absent from scope');
  }
});

test('a clean board scopes to nothing', () => {
  eq(scopeOf(board(5, [[0, 0], [2, 2]]), allDistinctRegions(5)), []);
});

suite('rules — solving');

for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: the declared solution is clean and counts as solved`, () => {
    const states = board(puzzle.size, puzzle.solution.map((col, row) => [row, col]));
    eq(flagged(states, puzzle.regions), [], 'violations');
    eq(isSolved(states, puzzle.regions), true, 'solved');
  });

  test(`${puzzle.id}: one crown short is not a win`, () => {
    const states = board(
      puzzle.size,
      puzzle.solution.map((col, row) => [row, col]).slice(0, -1)
    );
    eq(crownPositions(states).length, puzzle.size - 1);
    eq(flagged(states, puzzle.regions), [], 'a partial-but-correct board must not be flagged');
    eq(isSolved(states, puzzle.regions), false);
  });
}

test('N crowns with a violation is not a win', () => {
  // Five crowns down a single column: right count, wrong board.
  const states = board(5, [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  eq(crownPositions(states).length, 5);
  eq(isSolved(states, rowRegions(5)), false);
});

test('more than N crowns is not a win, even with no clashes', () => {
  // A 5x5 cannot hold six mutually non-clashing crowns, so use regions that
  // permit it and check the count rule alone rejects the board.
  const states = board(5, [[0, 0], [0, 2], [0, 4], [2, 0], [2, 2], [2, 4]]);
  eq(isSolved(states, rowRegions(5)), false);
});

suite('rules — purity');

test('findViolations does not mutate the board it is given', () => {
  const states = board(5, [[0, 0], [0, 3]]);
  const before = JSON.stringify(states);
  findViolations(states, colRegions(5));
  eq(JSON.stringify(states), before);
});

test('isSolved does not mutate the board or regions it is given', () => {
  const puzzle = PUZZLES[0];
  const states = board(puzzle.size, puzzle.solution.map((col, row) => [row, col]));
  const statesBefore = JSON.stringify(states);
  const regionsBefore = JSON.stringify(puzzle.regions);
  isSolved(states, puzzle.regions);
  eq(JSON.stringify(states), statesBefore, 'states');
  eq(JSON.stringify(puzzle.regions), regionsBefore, 'regions');
});
