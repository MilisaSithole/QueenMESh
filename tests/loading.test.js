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

test('?puzzle=dev-9x9 loads the 9x9', () => {
  const app = loadApp({ search: '?puzzle=dev-9x9' });
  eq(app.size, 9, 'board size');
  eq(app.board.children.length, 81, 'cell count');
  ok(app.status.textContent.includes('dev-9x9'), app.status.textContent);
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
  const app = loadApp({ search: '?puzzle=dev-9x9' });
  app.tap(8, 8);
  eq(app.stateOf(8, 8), 'mark', 'last cell of the 9x9 responds to input');
  app.drag([[0, 0], [0, 1], [0, 2]]);
  eq([app.stateOf(0, 0), app.stateOf(0, 1), app.stateOf(0, 2)], ['mark', 'mark', 'mark']);
});

suite('loading — malformed puzzles fail visibly');

const broken = {
  'a row is short': { size: 4, regions: [[0, 1, 2, 3], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3]] },
  'too few rows': { size: 4, regions: [[0, 1, 2, 3], [0, 1, 2, 3]] },
  'a region id is out of range': { size: 4, regions: [[0, 1, 2, 9], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]] },
  'a region id is not a number': { size: 4, regions: [[0, 1, 2, 'x'], [0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]] },
  'size exceeds the palette': { size: 10, regions: Array.from({ length: 10 }, () => Array.from({ length: 10 }, (_, i) => i)) },
  'regions missing entirely': { size: 4 },
};

for (const [name, regions] of Object.entries(broken)) {
  test(name, () => {
    const app = loadApp({ puzzle: { id: 'broken', difficulty: 'test', ...regions } });
    eq(app.status.dataset.state, 'error', `status should be an error, got "${app.status.textContent}"`);
    eq(app.board.children.length, 0, 'a broken puzzle must render no cells at all');
  });
}

test('a valid puzzle produces no error state', () => {
  const app = loadApp();
  eq(app.status.dataset.state, undefined);
  ok(app.status.textContent.includes('build'), 'status carries the build marker');
});
