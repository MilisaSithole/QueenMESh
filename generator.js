// Generate a Queens board with a provably unique solution.
//
// Runs in the browser (Phase 6.2 generates boards in the background) and in
// Node. The command line lives in tools/generate-puzzle.js.
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

/**
 * An incremental view of "which arrangements are currently solutions".
 *
 * Refinement changes one cell at a time and then asks how many solutions
 * remain, which the naive version answers by rescanning every arrangement —
 * 47,622 of them at 9x9, on every step and again for every candidate move it
 * tries. That is what made a 9x9 take over twenty seconds.
 *
 * Two changes remove almost all of it:
 *
 *   * A region set becomes a bitmask. `mask |= 1 << region` with a popcount
 *     replaces building and sizing a Set of nine values.
 *   * Changing cell (r, c) can only affect arrangements whose crown in row r
 *     sits in column c — one Nth of them. Indexing arrangements by cell means
 *     a move re-checks ~5,300 arrangements instead of 47,622.
 */
function createSolutionIndex(size, regions, arrangements) {
  // arrangementsByCell[row][col] = indices of arrangements using that cell.
  const byCell = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => []));
  arrangements.forEach((cols, i) => {
    for (let row = 0; row < size; row++) byCell[row][cols[row]].push(i);
  });

  const full = (1 << size) - 1;
  const isSolution = (cols) => {
    let mask = 0;
    for (let row = 0; row < size; row++) mask |= 1 << regions[row][cols[row]];
    return mask === full;
  };

  const valid = new Uint8Array(arrangements.length);
  let count = 0;
  arrangements.forEach((cols, i) => {
    valid[i] = isSolution(cols) ? 1 : 0;
    count += valid[i];
  });

  return {
    get count() { return count; },

    /** Re-evaluate only the arrangements a change at (row, col) can affect. */
    update(row, col) {
      for (const i of byCell[row][col]) {
        const next = isSolution(arrangements[i]) ? 1 : 0;
        if (next !== valid[i]) { count += next - valid[i]; valid[i] = next; }
      }
    },

    solutions() {
      return arrangements.filter((_, i) => valid[i]);
    },
  };
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
  const index = createSolutionIndex(size, regions, arrangements);

  for (let step = 0; step < maxSteps; step++) {
    if (index.count === 1) {
      // The surviving solution is always the target, and that is an invariant
      // rather than a coincidence: the only cells refinement ever reassigns are
      // ones where the unwanted solution differs from the target, so no target
      // crown cell is ever touched and the target never stops being a solution.
      // If it is the last one standing, it is the one.
      //
      // Kept as a guard anyway, because the invariant depends on the candidate
      // filter above and a future change there would break it silently.
      const only = index.solutions()[0];
      return only.join() === target.join() ? regions : null;
    }

    const solutions = index.solutions();
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
        index.update(row, col);

        if (index.count < solutions.length && isContiguous(size, regions, from)) {
          moved = true;
          break;
        }

        regions[row][col] = from;
        index.update(row, col);
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

// Loaded two ways: as a classic <script> in the browser, where these functions
// simply become globals, and as a CommonJS module by the Node tools and tests.
// The guard is what lets one file serve both without a build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generate, candidates, allArrangements, growRegions, refine, isContiguous, mulberry32,
    solutionsOf, createSolutionIndex, MIN_SIZE, MAX_SIZE,
   };
}
