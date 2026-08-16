// Phase 1.2 — region-boundary edges.
//
// Reads the classes off the board the real renderBoard produced, rather than
// reimplementing the edge rules here, so the tests cannot drift into agreeing
// with a broken shipped file.

const { suite, test, eq, ok } = require('./harness');
const { loadApp } = require('./dom-shim');

const HALF = 2;   // half a boundary, in raster units
const UNIT = 16;  // cell size, in raster units

/**
 * A random region grid that still satisfies the schema — every region id must
 * appear at least once, or the board is unsolvable and the loader rejects it
 * before these tests get a board to inspect. Each id is seeded on the diagonal
 * first, then the remaining cells are filled at random.
 */
function randomGrid(size, seed) {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  const grid = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => (r === c ? r : -1))
  );
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === -1) grid[r][c] = Math.floor(rand() * size);
    }
  }
  return grid;
}

function syntheticPuzzle(size, seed) {
  return { id: `synthetic-${size}-${seed}`, size, difficulty: 'test', regions: randomGrid(size, seed) };
}

/**
 * Paint the boundary lines into a raster.
 *
 * `oneSided` reproduces the original, defective scheme — each boundary drawn
 * once from the right/bottom only — so the junction test below can be shown to
 * actually detect the defect rather than passing vacuously.
 */
function paint(size, regions, edgeAt, oneSided) {
  const pad = HALF * 2;
  const span = size * UNIT + pad * 2;
  const px = Array.from({ length: span }, () => new Array(span).fill(0));
  const fill = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(span, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(span, x1); x++) px[y][x] = 1;
    }
  };
  const w = oneSided ? HALF * 2 : HALF;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const x = pad + col * UNIT;
      const y = pad + row * UNIT;
      const edges = edgeAt(row, col);
      if (edges.right) fill(x + UNIT - w, y, x + UNIT, y + UNIT);
      if (edges.bottom) fill(x, y + UNIT - w, x + UNIT, y + UNIT);
      if (!oneSided) {
        if (edges.left) fill(x, y, x + w, y + UNIT);
        if (edges.top) fill(x, y, x + UNIT, y + w);
      }
    }
  }
  return { px, pad };
}

/**
 * Count vertices where two or more boundary segments meet but the painted
 * pixels around them fall into disconnected pieces — a visible notch where a
 * region outline turns a corner.
 *
 * Deliberately a *local* check. An earlier version tested whether the whole
 * boundary network was connected, which passed on the broken code: the network
 * is a closed loop, so a notch at one corner still joins up the long way round.
 */
function countNotches(size, regions, edgeAt, oneSided) {
  const { px, pad } = paint(size, regions, edgeAt, oneSided);
  let notched = 0;

  for (let row = 1; row < size; row++) {
    for (let col = 1; col < size; col++) {
      const arms = [
        regions[row - 1][col - 1] !== regions[row - 1][col],
        regions[row][col - 1] !== regions[row][col],
        regions[row - 1][col - 1] !== regions[row][col - 1],
        regions[row - 1][col] !== regions[row][col],
      ].filter(Boolean).length;
      if (arms < 2) continue;

      const cx = pad + col * UNIT;
      const cy = pad + row * UNIT;
      const box = HALF * 2;
      const painted = new Set();
      for (let y = cy - box; y < cy + box; y++) {
        for (let x = cx - box; x < cx + box; x++) if (px[y][x]) painted.add(x + ',' + y);
      }

      let pieces = 0;
      const seen = new Set();
      for (const start of painted) {
        if (seen.has(start)) continue;
        pieces++;
        const queue = [start];
        seen.add(start);
        while (queue.length) {
          const [a, b] = queue.pop().split(',').map(Number);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = a + dx + ',' + (b + dy);
            if (painted.has(key) && !seen.has(key)) { seen.add(key); queue.push(key); }
          }
        }
      }
      if (pieces > 1) notched++;
    }
  }
  return notched;
}

/** Read the edge classes the shipped renderBoard actually applied. */
function edgeReader(app) {
  return (row, col) => {
    const cell = app.cellAt(row, col);
    return {
      right: cell.classList.contains('b-r'),
      bottom: cell.classList.contains('b-b'),
      left: cell.classList.contains('b-l'),
      top: cell.classList.contains('b-t'),
    };
  };
}

suite('boundaries — every shared edge is claimed by both cells');

for (const size of [5, 6, 7, 8, 9]) {
  const puzzle = size === 5 ? undefined : syntheticPuzzle(size, size * 7919);
  const app = loadApp({ puzzle });
  const regions = puzzle ? puzzle.regions : null;

  test(`${size}x${size}: b-r/b-l and b-b/b-t agree with the region grid`, () => {
    const edge = edgeReader(app);
    const regionOf = (r, c) => Number(app.cellAt(r, c).dataset.region);
    const problems = [];

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (col < size - 1) {
          const differs = regionOf(row, col) !== regionOf(row, col + 1);
          if (edge(row, col).right !== differs) problems.push(`right of ${row},${col}`);
          if (edge(row, col + 1).left !== differs) problems.push(`left of ${row},${col + 1}`);
        } else if (edge(row, col).right) {
          problems.push(`${row},${col} draws a right edge on the board edge`);
        }

        if (row < size - 1) {
          const differs = regionOf(row, col) !== regionOf(row + 1, col);
          if (edge(row, col).bottom !== differs) problems.push(`bottom of ${row},${col}`);
          if (edge(row + 1, col).top !== differs) problems.push(`top of ${row + 1},${col}`);
        } else if (edge(row, col).bottom) {
          problems.push(`${row},${col} draws a bottom edge on the board edge`);
        }
      }
    }
    eq(problems, [], 'edges disagreeing with the region grid');
  });
}

suite('boundaries — corners join without notches');

{
  const app = loadApp();
  const size = 5;
  const regions = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => Number(app.cellAt(r, c).dataset.region))
  );
  const edge = edgeReader(app);

  test('starter puzzle: no notched junctions', () => {
    eq(countNotches(size, regions, edge, false), 0);
  });

  test('negative control: the one-sided scheme this replaced IS notched', () => {
    const notches = countNotches(size, regions, edge, true);
    ok(notches > 0, `expected the defective scheme to notch, but measured ${notches}`);
  });
}

for (const size of [6, 7, 8, 9]) {
  test(`${size}x${size} synthetic boards: no notched junctions`, () => {
    let total = 0;
    let controlTotal = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const puzzle = syntheticPuzzle(size, seed);
      const app = loadApp({ puzzle });
      const edge = edgeReader(app);
      total += countNotches(size, puzzle.regions, edge, false);
      controlTotal += countNotches(size, puzzle.regions, edge, true);
    }
    eq(total, 0, 'notched junctions across 25 boards');
    ok(controlTotal > 0, 'negative control never fired — the test is not discriminating');
  });
}
