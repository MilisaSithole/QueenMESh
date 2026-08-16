// Puzzle selection and the guard against malformed puzzle data.
//
// Both are exercised through the shim rather than by calling the functions
// directly, because main.js is a classic script with no exports — and testing
// the observable result (which board rendered, what the status line says) is
// closer to what actually matters anyway.

const { suite, test, eq, ok } = require('./harness');
const { loadApp } = require('./dom-shim');

suite('loading — ?puzzle= selects a board');

test('no parameter loads the first puzzle', () => {
  const app = loadApp();
  eq(app.size, 5, 'board size');
  ok(app.status.textContent.includes('starter-5x5'), app.status.textContent);
});

test('?puzzle=curated-9x9 loads the 9x9', () => {
  const app = loadApp({ search: '?puzzle=curated-9x9' });
  eq(app.size, 9, 'board size');
  eq(app.board.children.length, 81, 'cell count');
  ok(app.status.textContent.includes('curated-9x9'), app.status.textContent);
});

test('?puzzle=starter-5x5 loads the 5x5 explicitly', () => {
  const app = loadApp({ search: '?puzzle=starter-5x5' });
  eq(app.size, 5, 'board size');
});

test('an unrecognised id falls back but says so, rather than failing silently', () => {
  const app = loadApp({ search: '?puzzle=nope' });
  eq(app.size, 5, 'falls back to the first puzzle');
  eq(app.status.dataset.state, 'warning', 'status is flagged');
  ok(app.status.textContent.includes('nope'), 'names the id that was not found');
});

test('other query parameters are ignored', () => {
  const app = loadApp({ search: '?utm_source=x&debug=1' });
  eq(app.size, 5);
  eq(app.status.dataset.state, undefined, 'no spurious warning');
});

test('the selected board is playable, not just rendered', () => {
  const app = loadApp({ search: '?puzzle=curated-9x9' });
  app.tap(8, 8);
  eq(app.stateOf(8, 8), 'mark', 'last cell of the 9x9 responds to input');
  app.drag([[0, 0], [0, 1], [0, 2]]);
  eq([app.stateOf(0, 0), app.stateOf(0, 1), app.stateOf(0, 2)], ['mark', 'mark', 'mark']);
});

suite('loading — malformed puzzles fail visibly');

const rows = (size, fn) => Array.from({ length: size }, (_, r) =>
  Array.from({ length: size }, (_, c) => fn(r, c)));

/** A well-formed board of the given size: every region id used exactly once per row. */
const sound = (size) => rows(size, (_r, c) => c);

const broken = {
  'a row is short': { size: 4, regions: [[0, 1, 2, 3], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3]] },
  'too few rows': { size: 4, regions: [[0, 1, 2, 3], [0, 1, 2, 3]] },
  'a region id is out of range': { size: 4, regions: [[0, 1, 2, 9], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]] },
  // The case above is also caught by the "every id used" rule, since the stray
  // 9 pushes the distinct count past `size`. Here the count still comes to
  // exactly 4, so only the range check can catch it.
  'an out-of-range id that keeps the region count correct': {
    size: 4,
    regions: rows(4, (_r, c) => (c === 3 ? 9 : c)),
  },
  'a region id is not a number': { size: 4, regions: [[0, 1, 2, 'x'], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]] },
  'size exceeds the palette': { size: 10, regions: sound(10) },
  'size is below the smallest solvable board': { size: 3, regions: sound(3) },
  'size is not an integer': { size: 5.5, regions: sound(5) },
  'regions missing entirely': { size: 4 },
  'a region id is never used, so no solution can exist': {
    size: 4,
    regions: rows(4, (_r, c) => (c === 3 ? 2 : c)),
  },
  'the id is empty': { id: '', size: 4, regions: sound(4) },
  'the id is missing': { id: undefined, size: 4, regions: sound(4) },
  'the solution is the wrong length': { size: 4, regions: sound(4), solution: [0, 1] },
  'the solution names a column off the board': { size: 4, regions: sound(4), solution: [0, 1, 2, 7] },
};

for (const [name, fields] of Object.entries(broken)) {
  test(name, () => {
    const app = loadApp({ puzzle: { id: 'broken', difficulty: 'test', ...fields } });
    eq(app.status.dataset.state, 'error', `status should be an error, got "${app.status.textContent}"`);
    eq(app.board.children.length, 0, 'a broken puzzle must render no cells at all');
  });
}

test('the error message names the problem rather than just failing', () => {
  const app = loadApp({ puzzle: { id: 'broken', size: 4, regions: [[0, 1, 2, 3], [0, 1, 2, 3]] } });
  ok(/region rows/.test(app.status.textContent), app.status.textContent);
});

suite('loading — problems with the set as a whole');

test('duplicate ids are rejected, since selection by id becomes ambiguous', () => {
  const twin = { id: 'same', size: 4, difficulty: 'test', regions: sound(4) };
  const app = loadApp({ puzzles: [twin, { ...twin }] });
  eq(app.status.dataset.state, 'error');
  ok(/duplicate/.test(app.status.textContent), app.status.textContent);
});

test('an empty puzzle set is rejected, and says so at the set level', () => {
  const app = loadApp({ puzzles: [] });
  eq(app.status.dataset.state, 'error');
  eq(app.board.children.length, 0);
  // Asserting the wording is the point here, not pedantry: without the
  // set-level check this still errors, via "no puzzle to load" from the
  // per-puzzle validator. That message sends you hunting through one board's
  // fields when the actual problem is that there are no boards at all.
  ok(/no puzzles/.test(app.status.textContent), app.status.textContent);
});

test('distinct ids are fine', () => {
  const base = { size: 4, difficulty: 'test', regions: sound(4) };
  const app = loadApp({ puzzles: [{ ...base, id: 'a' }, { ...base, id: 'b' }] });
  eq(app.status.dataset.state, undefined, app.status.textContent);
});

suite('loading — a sound board loads cleanly');

test('a valid puzzle produces no error state', () => {
  const app = loadApp();
  eq(app.status.dataset.state, undefined);
  ok(app.status.textContent.includes('build'), 'status carries the build marker');
});

test('a board without a declared solution still plays', () => {
  // solution is required of shipped puzzles but is not needed to render: win
  // detection reads the rules, never this field. Making it fatal at runtime
  // would reject valid boards to guard something nothing on the page uses.
  const app = loadApp({ puzzle: { id: 'no-solution', size: 4, difficulty: 'test', regions: sound(4) } });
  eq(app.status.dataset.state, undefined, app.status.textContent);
  eq(app.board.children.length, 16);
  app.tap(0, 0);
  eq(app.stateOf(0, 0), 'mark');
});
