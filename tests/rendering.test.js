// What the board actually puts in the DOM, and the sizing arithmetic behind
// the 44px tap target.
//
// The boundary tests treat data-region as the source of truth for what colour
// a cell is, so nothing there would notice renderBoard writing the wrong region
// — the edges would simply be consistently wrong. That gap is closed here.

const fs = require('fs');
const path = require('path');
const { suite, test, note, eq, ok } = require('./harness');
const { loadApp, ROOT } = require('./dom-shim');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();

// A missing <script> tag breaks the whole page and nothing else notices: the
// browser throws a ReferenceError on load and renders an empty board. There is
// no module system here to catch it, so the page's own script list is the only
// source of truth and it needs asserting directly.
suite('page — every script is loaded, in a workable order');

{
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

  // worker.js is a root script that index.html deliberately does *not* load —
  // it is a worker entry point, started with new Worker() instead. Excluded by
  // name rather than by pattern, so a genuinely forgotten script still fails.
  const WORKER_ENTRY_POINTS = ['worker.js'];

  test('index.html loads every JavaScript file in the project root', () => {
    const onDisk = fs
      .readdirSync(ROOT)
      .filter((f) => f.endsWith('.js') && !WORKER_ENTRY_POINTS.includes(f))
      .sort();
    eq(scripts.slice().sort(), onDisk, 'scripts referenced vs files present');
  });

  test('the worker entry point is reachable from somewhere', () => {
    // Excluding it above would otherwise let it rot: unreferenced, untested,
    // and quietly dead while still looking like part of the app.
    const referenced = fs
      .readdirSync(ROOT)
      .filter((f) => f.endsWith('.js'))
      .some((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes("Worker('worker.js')"));
    ok(referenced, 'nothing constructs the worker');
  });

  test("the worker's own imports all exist and are loaded by the page too", () => {
    // importScripts paths are strings the bundler-free setup cannot check.
    // Rename solver.js and the page keeps working while the worker dies
    // silently, taking background generation with it.
    const source = fs.readFileSync(path.join(ROOT, 'worker.js'), 'utf8');
    const imported = [...source.matchAll(/importScripts\(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((q) => q[1]));

    ok(imported.length > 0, 'no importScripts found — check the pattern');
    eq(imported.filter((f) => !fs.existsSync(path.join(ROOT, f))), [], 'missing files');
    eq(imported.filter((f) => !scripts.includes(f)), [], 'imported but not loaded by index.html');
  });

  test('every referenced script actually exists', () => {
    const missing = scripts.filter((src) => !fs.existsSync(path.join(ROOT, src)));
    eq(missing, []);
  });

  test('dependencies load before the code that uses them', () => {
    const order = (name) => scripts.indexOf(name);
    ok(order('rules.js') !== -1, 'rules.js must be loaded');
    ok(order('puzzles.js') !== -1, 'puzzles.js must be loaded');
    ok(order('main.js') !== -1, 'main.js must be loaded');
    ok(order('rules.js') < order('main.js'), 'rules.js defines what main.js calls');
    ok(order('puzzles.js') < order('main.js'), 'main.js reads PUZZLES at load');
  });
}

suite('rendering — the grid matches the puzzle');

for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: renders exactly one cell per square, addressed correctly`, () => {
    const app = loadApp({ search: `?puzzle=${puzzle.id}` });
    eq(app.board.children.length, puzzle.size * puzzle.size, 'cell count');

    const seen = new Set();
    for (const cell of app.board.children) seen.add(`${cell.dataset.row},${cell.dataset.col}`);
    eq(seen.size, puzzle.size * puzzle.size, 'distinct row,col pairs');
  });

  test(`${puzzle.id}: every cell's data-region matches the puzzle data`, () => {
    const app = loadApp({ search: `?puzzle=${puzzle.id}` });
    const wrong = [];
    for (let row = 0; row < puzzle.size; row++) {
      for (let col = 0; col < puzzle.size; col++) {
        const rendered = Number(app.cellAt(row, col).dataset.region);
        if (rendered !== puzzle.regions[row][col]) {
          wrong.push(`${row},${col}: rendered ${rendered}, expected ${puzzle.regions[row][col]}`);
        }
      }
    }
    eq(wrong, []);
  });

  test(`${puzzle.id}: every cell starts empty`, () => {
    const app = loadApp({ search: `?puzzle=${puzzle.id}` });
    const notEmpty = app.board.children
      .filter((c) => c.dataset.state !== 'empty')
      .map((c) => `${c.dataset.row},${c.dataset.col}`);
    eq(notEmpty, []);
  });
}

suite('rendering — glyphs');

test('the sprite defines every symbol main.js references', () => {
  const defined = [...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => '#' + m[1]);
  const referenced = [...js.matchAll(/'(#glyph-[a-z]+)'/g)].map((m) => m[1]);
  ok(referenced.length > 0, 'no glyph references found in main.js — check the pattern');
  eq(referenced.filter((r) => !defined.includes(r)), [], 'unresolved <use> targets');
});

test('cycling a cell points its <use> at the matching symbol', () => {
  const app = loadApp();
  const href = () => app.cellAt(0, 0).querySelector('use').getAttribute('href');

  app.tap(0, 0);
  eq([app.stateOf(0, 0), href()], ['mark', '#glyph-mark']);

  app.tap(0, 0);
  eq([app.stateOf(0, 0), href()], ['crown', '#glyph-crown']);

  app.tap(0, 0);
  eq(app.stateOf(0, 0), 'empty', 'CSS hides the glyph on empty, so href may stay stale');
});

test('a dragged cell gets the mark glyph, not just the state', () => {
  const app = loadApp();
  app.drag([[1, 0], [1, 1]]);
  eq(
    [app.cellAt(1, 0), app.cellAt(1, 1)].map((c) => c.querySelector('use').getAttribute('href')),
    ['#glyph-mark', '#glyph-mark']
  );
});

test('both glyphs sit inside the viewBox and are centred', () => {
  const sprite = html.match(/<svg class="sprite"[\s\S]*?<\/svg>/)[0];
  const problems = [];

  for (const match of sprite.matchAll(/<symbol id="([^"]+)"[\s\S]*?<\/symbol>/g)) {
    const [body, id] = [match[0], match[1]];
    const xs = [];
    const ys = [];

    for (const d of body.matchAll(/d="([^"]+)"/g)) {
      const nums = d[1].replace(/[A-Za-z]/g, ' ').split(/[\s,]+/).filter((t) => /^-?[\d.]+$/.test(t)).map(Number);
      for (let i = 0; i < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
    }
    for (const r of body.matchAll(/<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/g)) {
      xs.push(+r[1], +r[1] + +r[3]);
      ys.push(+r[2], +r[2] + +r[4]);
    }

    const stroke = Number((body.match(/stroke-width="([\d.]+)"/) || [0, 0])[1]) / 2;
    const x0 = Math.min(...xs) - stroke;
    const x1 = Math.max(...xs) + stroke;
    const y0 = Math.min(...ys) - stroke;
    const y1 = Math.max(...ys) + stroke;

    if (x0 < 0 || y0 < 0 || x1 > 24 || y1 > 24) problems.push(`${id} escapes the viewBox`);
    if (Math.abs((x0 + x1) / 2 - 12) > 0.1) problems.push(`${id} off-centre horizontally`);
    if (Math.abs((y0 + y1) / 2 - 12) > 0.1) problems.push(`${id} off-centre vertically`);
  }

  ok(problems.length === 0 || false, problems.join('; '));
});

suite('rendering — the 44px tap target at 9x9');

// The whole reason the dev 9x9 exists. Recomputes the sizing arithmetic from
// the CSS constants rather than trusting a comment, so widening the page
// padding or shrinking the board cap fails here instead of on the phone.
{
  const REM = 16;
  const VIEWPORT = 412; // S25 Ultra, CSS px, portrait
  const MINIMUM = 44;

  const grab = (pattern, what) => {
    const m = css.match(pattern);
    if (!m) throw new Error(`could not read ${what} from style.css — update the pattern`);
    return Number(m[1]);
  };

  test('a 9x9 cell clears 44px on a 412px-wide phone', () => {
    const appPadding = grab(/\.app\s*{[^}]*padding-left:\s*max\(([\d.]+)rem/s, 'app horizontal padding') * REM;
    const widthPercent = grab(/--board-px:\s*min\((\d+)vw/, 'board width percentage');
    const capRem = grab(/--board-px:\s*min\([^)]*?(\d+)rem\)/, 'board width cap');
    const minBoundary = grab(/--boundary:\s*clamp\((\d+)px/, 'minimum boundary width');

    // The container-query path is what modern browsers take: the board is as
    // wide as the space left after the page padding, capped on desktop.
    const available = VIEWPORT - 2 * appPadding;
    const boardWidth = Math.min(available, capRem * REM, (widthPercent / 100) * VIEWPORT);

    // box-sizing is border-box, so the frame eats into the track area.
    const content = boardWidth - 2 * minBoundary;
    const cell = content / 9;

    note(`board ${boardWidth}px, frame ${minBoundary}px x2, cell ${cell.toFixed(2)}px`);
    ok(cell >= MINIMUM, `9x9 cell is ${cell.toFixed(2)}px, below the ${MINIMUM}px minimum`);
  });

  test('a 10x10 would not fit, which is why 9x9 is the documented ceiling', () => {
    const appPadding = grab(/\.app\s*{[^}]*padding-left:\s*max\(([\d.]+)rem/s, 'app horizontal padding') * REM;
    const minBoundary = grab(/--boundary:\s*clamp\((\d+)px/, 'minimum boundary width');
    const cell = (VIEWPORT - 2 * appPadding - 2 * minBoundary) / 10;
    ok(cell < MINIMUM, `10x10 cell measures ${cell.toFixed(2)}px — the size cap may need revisiting`);
  });

  test('no puzzle exceeds the 9x9 ceiling', () => {
    eq(PUZZLES.filter((p) => p.size > 9).map((p) => p.id), []);
  });
}
