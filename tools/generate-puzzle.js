// Generate a Queens board with a provably unique solution.
//
//   node tools/generate-puzzle.js 7            one 7x7
//   node tools/generate-puzzle.js 6 7 8 9      one of each
//
// Prints a puzzles.js-shaped entry plus an ASCII preview, for pasting into
// puzzles.js after a human has looked at it. Deliberately not wired into the
// app: Phase 4's boards are generated then *curated*, and "looks like a fair
// puzzle" is not something this script can judge.
//
// WHY THIS IS NOT JUST REJECTION SAMPLING
//
// The obvious approach — grow regions at random, keep the layout if it happens
// to have one solution — does not scale. Measured during Phase 2.2: at 9x9
// there are 47,622 crown arrangements satisfying row/column/adjacency, and
// 143,000 random layouts produced zero unique puzzles. It only appears to work
// at 5x5, where there are 14 arrangements to rule out.
//
// So this grows a layout and then refines it: find an unwanted solution, pick a
// cell where it disagrees with the intended one, and move that cell to a
// neighbouring region so the unwanted solution double-books a region. Accept
// only if the solution count drops and every region stays contiguous with
// exactly one intended crown. Repeat. That reaches a unique 9x9 in a handful of
// layouts rather than never.
//
// Phase 5 should port this rather than rediscover it.

const MIN_SIZE = 4;
const MAX_SIZE = 9;

/** Every crown arrangement satisfying one-per-row, one-per-column, no touching. */
function allArrangements(size) {
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

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shuffled = (items, rand) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Randomised flood fill outward from each crown until every cell is claimed. */
function growRegions(size, seeds, rand) {
  const regions = Array.from({ length: size }, () => new Array(size).fill(-1));
  const frontiers = seeds.map(([r, c], i) => { regions[r][c] = i; return [[r, c]]; });
  let remaining = size * size - seeds.length;

  while (remaining > 0) {
    let progressed = false;
    for (let i = 0; i < seeds.length; i++) {
      const frontier = frontiers[i];
      if (!frontier.length) continue;
      const pick = Math.floor(rand() * frontier.length);
      const [r, c] = frontier[pick];
      const open = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].filter(
        ([nr, nc]) => nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1
      );
      if (!open.length) { frontier.splice(pick, 1); continue; }
      const [nr, nc] = open[Math.floor(rand() * open.length)];
      regions[nr][nc] = i;
      frontier.push([nr, nc]);
      remaining--;
      progressed = true;
    }
    if (!progressed) return null; // stranded cells; discard this layout
  }
  return regions;
}

function solutionsOf(size, regions, arrangements, stopAt = Infinity) {
  const found = [];
  for (const cols of arrangements) {
    const seen = new Set();
    for (let row = 0; row < size; row++) seen.add(regions[row][cols[row]]);
    if (seen.size === size) {
      found.push(cols);
      if (found.length >= stopAt) break;
    }
  }
  return found;
}

function isContiguous(size, regions, id) {
  const cells = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (regions[r][c] === id) cells.push([r, c]);
  }
  if (!cells.length) return false;

  const key = ([r, c]) => r * size + c;
  const all = new Set(cells.map(key));
  const seen = new Set([key(cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const next of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const k = key(next);
      if (all.has(k) && !seen.has(k)) { seen.add(k); stack.push(next); }
    }
  }
  return seen.size === cells.length;
}

/** Nudge a layout toward a single solution. Returns the layout, or null. */
function refine(size, regions, target, arrangements, rand, maxSteps = 500) {
  for (let step = 0; step < maxSteps; step++) {
    const solutions = solutionsOf(size, regions, arrangements);
    if (solutions.length === 1) {
      return solutions[0].join() === target.join() ? regions : null;
    }

    const unwanted = shuffled(solutions.filter((s) => s.join() !== target.join()), rand)[0];
    if (!unwanted) return null;

    // Only cells where the unwanted solution differs from the intended one can
    // be reassigned without disturbing a crown we mean to keep.
    const candidateRows = shuffled(
      [...Array(size).keys()].filter((r) => unwanted[r] !== target[r]),
      rand
    );

    let moved = false;
    for (const row of candidateRows) {
      const col = unwanted[row];
      if (target[row] === col) continue;
      const from = regions[row][col];

      const neighbours = shuffled([...new Set(
        [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]
          .filter(([r, c]) => r >= 0 && r < size && c >= 0 && c < size)
          .map(([r, c]) => regions[r][c])
          .filter((id) => id !== from)
      )], rand);

      for (const to of neighbours) {
        regions[row][col] = to;
        const better =
          isContiguous(size, regions, from) &&
          solutionsOf(size, regions, arrangements, solutions.length).length < solutions.length;
        if (better) { moved = true; break; }
        regions[row][col] = from;
      }
      if (moved) break;
    }
    if (!moved) return null;
  }
  return null;
}

/**
 * Generate one board, preferring even region sizes. A region hogging a quarter
 * of the grid makes a puzzle look wrong even when it is logically sound, so
 * several candidates are produced and the most balanced kept.
 */
/**
 * Yield every unique, reasonably balanced board this search turns up.
 *
 * Separate from generate() because a batch wants all of them — rating a
 * population is the only way to see what the generator actually produces —
 * while authoring one board wants the single most balanced.
 */
function* candidates(size, { attempts = 1500, timeBudgetMs = 120000, seedFrom = 1 } = {}) {
  const arrangements = allArrangements(size);
  const smallest = 3;
  const largest = size * 2;
  const startedAt = Date.now();

  for (let seed = seedFrom; seed < seedFrom + attempts; seed++) {
    if (Date.now() - startedAt > timeBudgetMs) return;

    const rand = mulberry32(seed * 7919 + size);
    const target = arrangements[Math.floor(rand() * arrangements.length)];
    const layout = growRegions(size, target.map((c, r) => [r, c]), rand);
    if (!layout) continue;

    const refined = refine(size, layout, target, arrangements, rand);
    if (!refined) continue;

    const sizes = new Array(size).fill(0);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) sizes[refined[r][c]]++;
    if (Math.min(...sizes) < smallest || Math.max(...sizes) > largest) continue;
    if (!sizes.every((_, id) => isContiguous(size, refined, id))) continue;

    yield {
      size,
      regions: refined,
      solution: target,
      sizes,
      spread: Math.max(...sizes) - Math.min(...sizes),
      seed,
    };
  }
}

function generate(size, { attempts = 1500, timeBudgetMs = 120000 } = {}) {
  const arrangements = allArrangements(size);
  // A three-cell region is normal on a real board; scaling the floor with size
  // sounds tidy but rules out ordinary layouts on the larger grids, where
  // refinement tends to shave a region down as it kills off extra solutions.
  const smallest = 3;
  const largest = size * 2;
  const startedAt = Date.now();

  let best = null;
  let grown = 0;
  let unique = 0;

  for (let seed = 1; seed <= attempts; seed++) {
    if (Date.now() - startedAt > timeBudgetMs) break;

    const rand = mulberry32(seed * 7919 + size);
    const target = arrangements[Math.floor(rand() * arrangements.length)];
    const layout = growRegions(size, target.map((c, r) => [r, c]), rand);
    if (!layout) continue;
    grown++;

    const refined = refine(size, layout, target, arrangements, rand);
    if (!refined) continue;
    unique++;

    const sizes = new Array(size).fill(0);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) sizes[refined[r][c]]++;
    if (Math.min(...sizes) < smallest || Math.max(...sizes) > largest) continue;
    if (!sizes.every((_, id) => isContiguous(size, refined, id))) continue;

    const spread = Math.max(...sizes) - Math.min(...sizes);
    if (!best || spread < best.spread) best = { regions: refined, solution: target, sizes, spread, seed };
    if (best.spread <= Math.ceil(size / 2)) break;
  }

  return {
    best,
    stats: { arrangements: arrangements.length, grown, unique, size, smallest, largest },
  };
}

function preview(size, regions, solution) {
  const lines = [];
  for (let r = 0; r < size; r++) {
    lines.push('  ' + regions[r].map((v, c) => (solution[r] === c ? `(${v})` : ` ${v} `)).join(''));
  }
  return lines.join('\n');
}

module.exports = {
  generate, candidates, allArrangements, growRegions, refine, isContiguous, mulberry32,
  MIN_SIZE, MAX_SIZE,
};

// Everything below is the command line, and must stay behind this guard so the
// module can be required without generating anything.
if (require.main !== module) return;

const sizes = process.argv.slice(2).map(Number);
if (!sizes.length || sizes.some((n) => !Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE)) {
  console.error(`usage: node tools/generate-puzzle.js <size ${MIN_SIZE}-${MAX_SIZE}> [more sizes...]`);
  process.exit(1);
}

for (const size of sizes) {
  const started = Date.now();
  const { best: result, stats } = generate(size);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  if (!result) {
    console.log(`\n${size}x${size}: no board met the balance criteria (${seconds}s)`);
    console.log(`  ${stats.arrangements} arrangements, ${stats.grown} layouts grown, ` +
      `${stats.unique} reached a unique solution`);
    console.log(`  criteria were: every region ${stats.smallest}-${stats.largest} cells`);
    continue;
  }

  console.log(`\n${'='.repeat(64)}`);
  console.log(`${size}x${size}  —  ${stats.arrangements} arrangements, ${stats.grown} layouts grown, ` +
    `${stats.unique} unique, best spread ${result.spread}  (${seconds}s)`);
  console.log(`region sizes ${result.sizes.join(',')}  total ${result.sizes.reduce((a, b) => a + b)}`);
  console.log();
  console.log(preview(size, result.regions, result.solution));
  console.log();
  console.log('    regions: [');
  console.log(result.regions.map((row) => `      [${row.join(', ')}],`).join('\n'));
  console.log('    ],');
  console.log(`    solution: [${result.solution.join(', ')}],`);
}
