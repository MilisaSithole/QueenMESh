// Puzzle data integrity, and the palette guarantees the rest of the CSS leans
// on. Both are things that look fine on screen while being quietly wrong:
// a puzzle with two solutions renders identically to one with a single
// solution, and a contrast regression only shows up as "the crown looks a bit
// muddy on that one colour".
//
// Everything here iterates over PUZZLES, so puzzles added in Phase 4 are
// covered automatically.

const fs = require('fs');
const path = require('path');
const { suite, test, eq, ok } = require('./harness');
const { ROOT } = require('./dom-shim');

const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

/**
 * Every crown arrangement satisfying one-per-row, one-per-column and the
 * no-touching rule. With one crown per row, diagonal adjacency reduces to
 * |col[i] - col[i+1]| >= 2 on consecutive rows.
 */
function arrangements(size) {
  const out = [];
  const cols = [];
  const used = new Array(size).fill(false);
  (function place(row) {
    if (row === size) { out.push([...cols]); return; }
    for (let col = 0; col < size; col++) {
      if (used[col]) continue;
      if (row > 0 && Math.abs(col - cols[row - 1]) < 2) continue;
      used[col] = true; cols.push(col);
      place(row + 1);
      cols.pop(); used[col] = false;
    }
  })(0);
  return out;
}

function solutions(puzzle) {
  return arrangements(puzzle.size).filter(
    (cols) => new Set(cols.map((col, row) => puzzle.regions[row][col])).size === puzzle.size
  );
}

function regionCells(puzzle, id) {
  const cells = [];
  for (let row = 0; row < puzzle.size; row++) {
    for (let col = 0; col < puzzle.size; col++) {
      if (puzzle.regions[row][col] === id) cells.push([row, col]);
    }
  }
  return cells;
}

function isContiguous(puzzle, id) {
  const cells = regionCells(puzzle, id);
  if (!cells.length) return false;
  const key = ([r, c]) => r + ',' + c;
  const all = new Set(cells.map(key));
  const seen = new Set([key(cells[0])]);
  const queue = [cells[0]];
  while (queue.length) {
    const [r, c] = queue.pop();
    for (const next of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const k = key(next);
      if (all.has(k) && !seen.has(k)) { seen.add(k); queue.push(next); }
    }
  }
  return seen.size === cells.length;
}

const luminance = (hex) => {
  const channel = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};

const contrast = (a, b) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/**
 * CIE L*a*b*. Needed because contrast ratio is a *luminance* measure and says
 * nothing about hue — by contrast alone, crimson and indigo look like the same
 * colour, which is exactly the wrong answer for "are these two regions
 * distinguishable".
 */
function lab(hex) {
  const channel = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const n = parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIE76. Roughly: 2.3 is the just-noticeable difference, 25+ reads as a
 *  plainly different colour. */
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

// The runtime validator only rejects what stops a board being rendered and
// played. These are the schema obligations it deliberately leaves alone,
// because they are either unnecessary at load or too expensive to check there.
suite('puzzles — the schema contract on shipped data');

test('the set has no duplicate ids', () => {
  const seen = new Set();
  const duplicates = PUZZLES.map((p) => p.id).filter((id) => seen.size === seen.add(id).size);
  eq(duplicates, []);
});

for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: declares every field the schema requires`, () => {
    const missing = ['id', 'size', 'difficulty', 'regions', 'solution']
      .filter((field) => puzzle[field] === undefined);
    eq(missing, []);
  });

  // Not enforced at load: a board is playable without one, so making it fatal
  // would reject valid boards to guard a field nothing on the page reads.
  // Shipped puzzles still owe us one, for tooling and for Phase 6's hints.
  test(`${puzzle.id}: declares a solution of the right shape`, () => {
    ok(Array.isArray(puzzle.solution), 'solution must be an array');
    eq(puzzle.solution.length, puzzle.size, 'one column per row');
    const outOfRange = puzzle.solution.filter(
      (col) => !Number.isInteger(col) || col < 0 || col >= puzzle.size
    );
    eq(outOfRange, []);
  });

  test(`${puzzle.id}: size is within the supported range`, () => {
    ok(puzzle.size >= 4, `${puzzle.size} is below the smallest solvable board`);
    ok(puzzle.size <= 9, `${puzzle.size} exceeds the nine-colour palette`);
  });
}

suite('puzzles — structure');

for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: regions form a ${puzzle.size}x${puzzle.size} grid with in-range ids`, () => {
    eq(puzzle.regions.length, puzzle.size, 'row count');
    const bad = [];
    puzzle.regions.forEach((row, r) => {
      if (row.length !== puzzle.size) bad.push(`row ${r} has ${row.length} cells`);
      row.forEach((id, c) => {
        if (!Number.isInteger(id) || id < 0 || id >= puzzle.size) bad.push(`${r},${c} = ${id}`);
      });
    });
    eq(bad, []);
  });

  test(`${puzzle.id}: every region is contiguous and no region is a single cell`, () => {
    const broken = [];
    for (let id = 0; id < puzzle.size; id++) {
      const cells = regionCells(puzzle, id);
      if (cells.length === 0) broken.push(`region ${id} is empty`);
      else if (cells.length === 1) broken.push(`region ${id} is a lone cell`);
      else if (!isContiguous(puzzle, id)) broken.push(`region ${id} is disconnected`);
    }
    eq(broken, []);
  });
}

suite('puzzles — solvability');

for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: has exactly one solution`, () => {
    eq(solutions(puzzle).length, 1, 'solution count');
  });

  test(`${puzzle.id}: the declared solution is that solution`, () => {
    eq(solutions(puzzle)[0], puzzle.solution);
  });

  test(`${puzzle.id}: the declared solution obeys every rule`, () => {
    const cols = puzzle.solution;
    eq(new Set(cols).size, puzzle.size, 'one crown per column');
    eq(cols.length, puzzle.size, 'one crown per row');
    eq(
      new Set(cols.map((col, row) => puzzle.regions[row][col])).size,
      puzzle.size,
      'one crown per region'
    );
    const touching = cols
      .slice(0, -1)
      .map((col, row) => (Math.abs(col - cols[row + 1]) < 2 ? `rows ${row}/${row + 1}` : null))
      .filter(Boolean);
    eq(touching, [], 'no two crowns adjacent');
  });
}

suite('palette — contrast floor the glyph colour depends on');

{
  const gridLine = css.match(/--grid-line:\s*(#[0-9a-f]{6})/)[1];
  const fills = [...css.matchAll(/--region-(\d): (#[0-9a-f]{6}); \/\* (\w+)/g)];

  test('all nine region colours are defined', () => {
    eq(fills.length, 9, 'region colour count');
  });

  test('every region fill clears 4.5:1 against the grid line', () => {
    const low = fills
      .map(([, i, hex, name]) => ({ name, ratio: contrast(hex, gridLine) }))
      .filter((f) => f.ratio < 4.5)
      .map((f) => `${f.name} ${f.ratio.toFixed(2)}`);
    eq(low, [], `fills below the floor (grid line ${gridLine})`);
  });

  // Guards the property that makes a 9-region board readable at all: with
  // nine fills on screen at once, any two that drift together stop being
  // separate regions to the eye. The current floor is 32 (indigo/violet), so
  // 25 leaves room to retune without silently crossing into confusable.
  // The violation marker has to read on all nine fills, and it cannot do so
  // directly: red disappears on crimson and barely registers on yellow. The
  // design dims the offending cell first, so this checks the marker against
  // each *dimmed* fill rather than the raw one. Yellow is the binding case.
  test('the violation marker reads on every dimmed region fill', () => {
    const marker = css.match(/--violation:\s*(#[0-9a-f]{6})/)[1];
    const washPercent = Number(css.match(/--violation-wash:\s*(\d+)%/)[1]) / 100;
    const gridLine = css.match(/--grid-line:\s*(#[0-9a-f]{6})/)[1];

    const channels = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const dim = (fill) =>
      '#' + channels(gridLine)
        .map((v, i) => Math.round(washPercent * v + (1 - washPercent) * channels(fill)[i]))
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');

    const weak = fills
      .map(([, , hex, name]) => ({ name, ratio: contrast(marker, dim(hex)) }))
      .filter((f) => f.ratio < 3)
      .map((f) => `${f.name} ${f.ratio.toFixed(2)}`);

    eq(weak, [], 'dimmed fills where the violation marker falls below 3:1');
  });

  // The scope tint is judged differently from the marker. A player compares a
  // tinted cell against the same region's untinted cells elsewhere on the
  // board, so what matters is how far the tint moves a fill from its normal
  // self — not its absolute contrast against anything. Crimson is the binding
  // case, having the least room to shift toward red.
  test('the scope tint visibly shifts every region fill', () => {
    const tint = css.match(/--violation-tint:\s*(#[0-9a-f]{6})/)[1];
    const amount = Number(css.match(/--violation-tint-amount:\s*(\d+)%/)[1]) / 100;

    const channels = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const mix = (over, base, alpha) =>
      '#' + channels(over)
        .map((v, i) => Math.round(alpha * v + (1 - alpha) * channels(base)[i]))
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');

    const weak = fills
      .map(([, , hex, name]) => ({ name, shift: deltaE(hex, mix(tint, hex, amount)) }))
      .filter((f) => f.shift < 25)
      .map((f) => `${f.name} shifts only ${f.shift.toFixed(1)}`);

    eq(weak, [], 'fills the scope tint barely changes');
  });

  // If the two tiers look alike, the distinction between "this crown clashes"
  // and "this is the row it clashes in" is lost.
  test('the two violation tiers are distinguishable from each other', () => {
    const tint = css.match(/--violation-tint:\s*(#[0-9a-f]{6})/)[1];
    const tintAmount = Number(css.match(/--violation-tint-amount:\s*(\d+)%/)[1]) / 100;
    const gridLine = css.match(/--grid-line:\s*(#[0-9a-f]{6})/)[1];
    const washAmount = Number(css.match(/--violation-wash:\s*(\d+)%/)[1]) / 100;

    const channels = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const mix = (over, base, alpha) =>
      '#' + channels(over)
        .map((v, i) => Math.round(alpha * v + (1 - alpha) * channels(base)[i]))
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');

    const tooSimilar = fills
      .map(([, , hex, name]) => ({
        name,
        gap: deltaE(mix(tint, hex, tintAmount), mix(gridLine, hex, washAmount)),
      }))
      .filter((f) => f.gap < 15)
      .map((f) => `${f.name}: tiers only ${f.gap.toFixed(1)} apart`);

    eq(tooSimilar, []);
  });

  test('no two region fills are perceptually close', () => {
    const clashes = [];
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        const distance = deltaE(fills[i][2], fills[j][2]);
        if (distance < 25) {
          clashes.push(`${fills[i][3]}/${fills[j][3]} deltaE ${distance.toFixed(1)}`);
        }
      }
    }
    eq(clashes, [], 'confusable colour pairs');
  });
}

suite('css — traps already hit once');

{
  test('grid tracks use minmax(0, 1fr) so glyphs cannot stretch a row', () => {
    ok(/grid-template-rows:[^;]*minmax\(0,\s*1fr\)/.test(css), 'rows');
    ok(/grid-template-columns:[^;]*minmax\(0,\s*1fr\)/.test(css), 'columns');
  });

  test('zeroed edge widths carry a unit, or box-shadow silently dies', () => {
    const unitless = [...css.matchAll(/--edge-[a-z]+:\s*0\s*;/g)].map((m) => m[0]);
    eq(unitless, [], 'unitless zeros feeding calc() in the box-shadow');
  });

  test('glyphs do not swallow pointer input', () => {
    ok(/\.glyph\s*{[^}]*pointer-events:\s*none/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')));
  });

  // The boundary tests read classes off the rendered DOM, so they cannot see a
  // CSS rule that stops turning a class into a drawn edge. Without this, half
  // the boundary styling could be deleted and every other test would still
  // pass. Static pattern matching, not a rendering check — there is no layout
  // engine here — but it does pin the wiring.
  // The bug this guards against was invisible to every other CSS test here,
  // because they check that a rule *exists*, not that it survives the cascade.
  // `.cell[data-region="N"] { background: ... }` sits after the violation rules
  // at equal specificity, and the shorthand resets background-image — silently
  // erasing every violation wash while the ring and glyph colour still applied,
  // so it looked precisely like the feature had never been implemented.
  test('no cell rule uses the background shorthand, which resets background-image', () => {
    const offenders = [];
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, selector, body] = match;
      if (!selector.includes('.cell')) continue;
      if (/(^|[;\s])background\s*:/.test(body)) offenders.push(selector.trim());
    }
    eq(offenders, [], 'use background-color or background-image explicitly');
  });

  test('a clashing crown is actually styled, not just labelled', () => {
    ok(/\.cell\[data-violation="cell"\]\s*{[^}]*--violation-ring:/.test(css), 'ring');
    ok(/\.cell\[data-violation="cell"\]\s*{[^}]*background-image:/.test(css), 'dimming');
    ok(
      /\.cell\[data-violation="cell"\]\s\.glyph\s*{[^}]*color:\s*var\(--violation\)/.test(css),
      'glyph colour'
    );
  });

  test('the wider row/column/region highlight is styled too', () => {
    ok(
      /\.cell\[data-violation="scope"\]\s*{[^}]*var\(--violation-tint\)/.test(css),
      'scope cells must be tinted, or the whole point of the two tiers is lost'
    );
  });

  test('the violation ring is inert until a rule is broken', () => {
    ok(/\.cell\s*{[^}]*--violation-ring:\s*0px/s.test(css), 'default must be 0px, and carry a unit');
  });

  test('a solved board is styled', () => {
    ok(/\.board\[data-solved\]/.test(css), 'board');
    ok(/\.status\[data-state="solved"\]/.test(css), 'status');
  });

  test('all four boundary sides are wired up in CSS', () => {
    const missing = ['r', 'b', 'l', 't'].filter(
      (side) =>
        !new RegExp(`\\.cell\\.b-${side}\\s*\\{[^}]*--edge-${side}:\\s*var\\(--half-boundary\\)`).test(css)
    );
    eq(missing, [], 'sides whose class no longer draws a half boundary');
  });
}
