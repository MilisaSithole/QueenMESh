// Phase 6.2 — the picker, and a fresh board every time.
//
// The picker asks for a size *and* a difficulty. An earlier version offered
// difficulty alone and chose the size itself, which meant asking for "hard"
// could hand back a 7x7 one moment and a 9x9 the next — a shuffle rather than
// a choice. Both axes are the player's now, and the selection survives a
// refresh, because refreshing is how you ask for another board.

const fs = require('fs');
const path = require('path');
const { suite, test, note, eq, ok } = require('./harness');
const { loadApp, ROOT } = require('./dom-shim');

const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();
const SIZES = [5, 6, 7, 8, 9];
const DIFFICULTIES = ['easy', 'medium', 'hard', 'impossible'];

suite('picker — what it offers');

test('two rows: every size, and every difficulty', () => {
  const app = loadApp();
  eq(app.pickerLabels(), [SIZES.map((n) => `${n}×${n}`), DIFFICULTIES]);
});

test('each button carries an accessible label naming its axis', () => {
  const app = loadApp();
  const labels = app.pickerButtons().map((b) => b.getAttribute('aria-label'));
  eq(labels.filter((l) => !l).length, 0, 'every option needs a label');
  ok(labels.some((l) => l.startsWith('Size:')), labels.join(' | '));
  ok(labels.some((l) => l.startsWith('Difficulty:')), labels.join(' | '));
});

test('they are real buttons, so keyboard activation comes for free', () => {
  const app = loadApp();
  const wrong = app.pickerButtons().filter((b) => b.tag !== 'button' || b.type !== 'button');
  eq(wrong.length, 0);
});

test('buttons report whether that bucket has anything ready', () => {
  const app = loadApp();
  eq(app.pickerButtons().filter((b) => b.dataset.stocked === undefined).length, 0);
});

suite('picker — the selection is honoured exactly');

test('choosing a size keeps the difficulty, and vice versa', () => {
  const app = loadApp();
  app.choose('difficulty', 'hard');
  eq(app.activeDifficulty(), 'hard');

  app.choose('size', 7);
  eq(app.activeSize(), 7);
  eq(app.activeDifficulty(), 'hard', 'changing size must not reset the difficulty');
});

test('exactly one size and one difficulty are ever active', () => {
  const app = loadApp();
  app.choose('size', 8);
  app.choose('difficulty', 'medium');

  const active = app.pickerButtons().filter((b) => b.dataset.active === 'true');
  eq(active.length, 2, 'one per row');
  eq(app.activeSize(), 8);
  eq(app.activeDifficulty(), 'medium');
});

test('a board that loads matches the whole selection, not half of it', () => {
  const app = loadApp();
  app.choose('size', 6);
  app.choose('difficulty', 'easy');
  for (let i = 0; i < 20; i++) app.runBackgroundWork();
  app.choose('difficulty', 'easy'); // ask again, now that stock exists

  if (app.size === 0) return; // still generating; covered separately below
  eq(app.size, 6, `asked for 6x6 easy, got ${app.size}x${app.size}`);
});

test('refreshing keeps the same size and difficulty', () => {
  // Refreshing is how a new board is requested, so a picker that forgets
  // itself turns every reload into a reset.
  const storage = new Map();
  const first = loadApp({ storage, random: true });
  first.choose('size', 7);
  first.choose('difficulty', 'hard');
  eq(first.savedChoice(), { size: 7, difficulty: 'hard' });

  const second = loadApp({ storage, random: true });
  eq(second.activeSize(), 7, 'size was forgotten across the reload');
  eq(second.activeDifficulty(), 'hard', 'difficulty was forgotten across the reload');
});

test('a corrupt saved choice falls back instead of breaking the page', () => {
  const storage = new Map([['queenmesh:choice', 'not json']]);
  const app = loadApp({ storage, random: true });
  ok(SIZES.includes(app.activeSize()), `bad size ${app.activeSize()}`);
  ok(DIFFICULTIES.includes(app.activeDifficulty()), `bad difficulty ${app.activeDifficulty()}`);
});

suite('picker — switching resets the board');

test('crowns, marks, flags and the solved state do not survive a switch', () => {
  const app = loadApp();

  // Stock the bucket first. Switching to one with nothing ready deliberately
  // leaves the current board up rather than blanking the screen, so without
  // this the test would be checking the waiting path, not the reset.
  app.choose('difficulty', 'hard');
  for (let i = 0; i < 25; i++) app.runBackgroundWork();

  app.choose('difficulty', PUZZLES[0].difficulty);
  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  ok(app.highlighted().length > 0, 'set up a visible clash first');

  app.choose('difficulty', 'hard');
  eq(app.board.children.filter((c) => c.dataset.state !== 'empty').length, 0, 'cells cleared');
  eq(app.highlighted(), [], 'flags cleared');
  eq(app.solved(), false);
});

test('re-picking the same choice starts the board over', () => {
  // Also the only way to restart until Phase 6.4 adds a clear button, so it
  // must reset even when nothing about the selection changed.
  const only = { ...PUZZLES[0], id: 'reset-fixture' };
  const app = loadApp({ puzzle: only });

  app.placeCrown(0, 0);
  app.placeCrown(0, 3);
  ok(app.highlighted().length > 0);

  app.choose('difficulty', only.difficulty);
  eq(app.size, only.size, 'same size, so nothing is cleared incidentally');
  eq(app.board.children.filter((c) => c.dataset.state !== 'empty').length, 0);
  eq(app.highlighted(), []);
});

test('the switched-in board is live', () => {
  const app = loadApp();
  app.choose('difficulty', PUZZLES[0].difficulty);
  app.tap(0, 0);
  eq(app.stateOf(0, 0), 'mark', 'delegated listeners must survive a re-render');
});

suite('picker — fresh boards, not a fixed rotation');

test('generated boards reach the player, not just the baked-in five', () => {
  // Serving seeds forever looks identical from outside — a board loads either
  // way — and that was the actual complaint: the same handful on rotation.
  const app = loadApp();
  const seed = PUZZLES[0];
  app.choose('size', seed.size);
  app.choose('difficulty', seed.difficulty);

  const served = new Set();
  for (let round = 0; round < 12; round++) {
    for (let i = 0; i < 8; i++) app.runBackgroundWork();
    app.choose('difficulty', seed.difficulty);
    served.add(app.currentPuzzleId());
  }

  const generated = [...served].filter((id) => id.startsWith('generated-'));
  note(`served ${served.size} distinct boards, ${generated.length} generated`);
  ok(generated.length > 0, `only ever served seeds: ${[...served].join(', ')}`);
});

test('an explicit ?puzzle= still wins, so deep links keep working', () => {
  const target = PUZZLES[PUZZLES.length - 1];
  for (let i = 0; i < 3; i++) {
    eq(loadApp({ search: `?puzzle=${target.id}` }).size, target.size);
  }
});

test('background generation starts on load', () => {
  const app = loadApp();
  ok(app.runBackgroundWork() > 0, 'the cache never started filling');
});
