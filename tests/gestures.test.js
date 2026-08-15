// Phase 2.1 — the tap-versus-drag pointer state machine.
//
// This is the part of the app with the most branches and the least visibility:
// several of these cases are awkward to trigger by hand and impossible to
// notice going wrong.

const { suite, test, eq } = require('./harness');
const { loadApp } = require('./dom-shim');

suite('gestures — tap cycles a cell');

{
  const app = loadApp();

  test('empty -> mark', () => {
    app.tap(0, 0);
    eq(app.stateOf(0, 0), 'mark');
  });

  test('mark -> crown', () => {
    app.tap(0, 0);
    eq(app.stateOf(0, 0), 'crown');
  });

  test('crown -> empty', () => {
    app.tap(0, 0);
    eq(app.stateOf(0, 0), 'empty');
  });
}

suite('gestures — drag paints marks');

{
  const app = loadApp();

  test('marks every cell touched, including the one it started on', () => {
    app.reset();
    app.drag([[1, 0], [1, 1], [1, 2]]);
    eq([app.stateOf(1, 0), app.stateOf(1, 1), app.stateOf(1, 2)], ['mark', 'mark', 'mark']);
  });

  test('the released-on cell is marked, not cycled to a crown', () => {
    eq(app.stateOf(1, 2), 'mark');
  });

  test('a drag from a marked cell erases along the whole path', () => {
    app.drag([[1, 0], [1, 1]]);
    eq(
      [app.stateOf(1, 0), app.stateOf(1, 1), app.stateOf(1, 2)],
      ['empty', 'empty', 'mark'],
      'only the cells dragged over should clear'
    );
  });
}

suite('gestures — crowns survive bulk gestures');

{
  const app = loadApp();
  app.reset();
  app.tap(2, 1);
  app.tap(2, 1);

  test('a crown is in place to drag through', () => {
    eq(app.stateOf(2, 1), 'crown');
  });

  test('dragging through a crown marks around it and leaves it alone', () => {
    app.drag([[2, 0], [2, 1], [2, 2]]);
    eq([app.stateOf(2, 0), app.stateOf(2, 1), app.stateOf(2, 2)], ['mark', 'crown', 'mark']);
  });

  test('a drag starting on a crown paints nothing at all', () => {
    app.drag([[2, 1], [2, 2], [2, 3]]);
    eq(
      [app.stateOf(2, 1), app.stateOf(2, 2), app.stateOf(2, 3)],
      ['crown', 'mark', 'empty'],
      '(2,2) keeps the mark it already had; (2,3) must stay untouched'
    );
  });
}

suite('gestures — bookkeeping');

{
  const app = loadApp();

  test('leaving a cell and returning does not also cycle it on release', () => {
    app.reset();
    const id = app.down(3, 0);
    app.move(3, 1, id);
    app.up(3, 0, id);
    eq([app.stateOf(3, 0), app.stateOf(3, 1)], ['mark', 'mark']);
  });

  test('a cancelled gesture does not fire a tap on the following pointerup', () => {
    app.reset();
    const id = app.down(3, 0);
    app.cancel(id);
    app.up(3, 0, id);
    eq(app.stateOf(3, 0), 'empty');
  });

  test('a second pointer is ignored while a gesture is in progress', () => {
    app.reset();
    const first = app.down(4, 0);
    const second = app.down(4, 2, 999);
    app.up(4, 2, second);
    eq([app.stateOf(4, 0), app.stateOf(4, 2)], ['empty', 'empty']);
    app.up(4, 0, first);
  });

  test('the original pointer still completes its tap afterwards', () => {
    eq(app.stateOf(4, 0), 'mark');
  });

  test('a stray extra pointerup is ignored', () => {
    app.reset();
    const id = app.down(0, 0);
    app.up(0, 0, id);
    app.up(0, 0, id);
    eq(app.stateOf(0, 0), 'mark');
  });
}
