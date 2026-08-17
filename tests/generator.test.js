// Phase 6.1 — the puzzle generator.
//
// It went untested until now because it was an offline authoring tool whose
// output a human looked at before it shipped. Phase 6.2 puts it in the browser
// generating boards nobody reviews, so what it produces has to be guaranteed
// rather than inspected.
//
// The other half is the Phase 6.1 optimisation itself. createSolutionIndex is
// a fast rewrite of solutionsOf, and a faster function that gives different
// answers is not an optimisation, so the two are held against each other
// directly.

const { suite, test, note, eq, ok } = require('./harness');
const {
  candidates, allArrangements, isContiguous, solutionsOf, createSolutionIndex, mulberry32,
  growRegions, refine,
} = require('../generator');
const { countSolutions, rate, difficultyOf } = require('../solver');

// Generating a 9x9 costs about two seconds even after the Phase 6.1 speedup,
// and mutation-check.js runs this whole suite once per mutation — well over a
// hundred times. QUEENS_FAST trims the sample to the sizes that are instant.
//
// Safe because every generator defect these tests guard against is
// size-agnostic: a broken bitmask or a dropped contiguity check fails at 6x6
// exactly as it fails at 9x9. A normal `node tests/run.js` still covers the
// large boards, which is where the *performance* claim needs checking.
const FAST = process.env.QUEENS_FAST === '1';
const SIZES = FAST ? [6, 7] : [6, 7, 8, 9];
const PER_SIZE = FAST ? 3 : 5;

/** A handful of boards per size, generated once and reused across tests. */
const sample = {};
for (const size of SIZES) {
  sample[size] = [];
  for (const candidate of candidates(size, { attempts: 3000, timeBudgetMs: 20000 })) {
    sample[size].push(candidate);
    if (sample[size].length >= PER_SIZE) break;
  }
}

const asPuzzle = (size, c) => ({
  id: `generated-${size}-${c.seed}`, size, difficulty: 'test',
  regions: c.regions, solution: c.solution,
});

suite('generator — the fast solution index matches the slow count');

for (const size of [6, 7]) {
  test(`${size}x${size}: index agrees with a full rescan after every mutation`, () => {
    const arrangements = allArrangements(size);
    const base = sample[size][0];
    const regions = base.regions.map((row) => [...row]);
    const index = createSolutionIndex(size, regions, arrangements);

    eq(index.count, solutionsOf(size, regions, arrangements).length, 'initial count');

    // Mutate cells at random and check the incremental count never drifts from
    // a from-scratch rescan. Drift would be invisible in normal use — the
    // generator would simply start accepting boards that are not unique.
    const rand = mulberry32(size * 31);
    const disagreements = [];
    for (let step = 0; step < 60; step++) {
      const row = Math.floor(rand() * size);
      const col = Math.floor(rand() * size);
      regions[row][col] = Math.floor(rand() * size);
      index.update(row, col);

      const expected = solutionsOf(size, regions, arrangements).length;
      if (index.count !== expected) {
        disagreements.push(`step ${step}: index ${index.count}, rescan ${expected}`);
      }
    }
    eq(disagreements, []);
  });
}

test('the index lists the same solutions, not merely the same number', () => {
  const size = 6;
  const arrangements = allArrangements(size);
  const regions = sample[size][0].regions.map((row) => [...row]);
  const index = createSolutionIndex(size, regions, arrangements);

  const fromIndex = index.solutions().map((s) => s.join()).sort();
  const fromScan = solutionsOf(size, regions, arrangements).map((s) => s.join()).sort();
  eq(fromIndex, fromScan);
});

suite('generator — every board it produces is playable');

for (const size of SIZES) {
  test(`${size}x${size}: boards have exactly one solution`, () => {
    ok(sample[size].length > 0, `no ${size}x${size} boards were generated`);
    const wrong = sample[size]
      .map((c) => ({ seed: c.seed, count: countSolutions(asPuzzle(size, c), 3) }))
      .filter((r) => r.count !== 1)
      .map((r) => `seed ${r.seed}: ${r.count} solutions`);
    eq(wrong, []);
  });

  test(`${size}x${size}: every region is contiguous and none is a lone cell`, () => {
    const broken = [];
    for (const c of sample[size]) {
      const counts = new Array(size).fill(0);
      c.regions.forEach((row) => row.forEach((id) => counts[id]++));
      for (let id = 0; id < size; id++) {
        if (counts[id] < 2) broken.push(`seed ${c.seed}: region ${id} has ${counts[id]} cells`);
        else if (!isContiguous(size, c.regions, id)) broken.push(`seed ${c.seed}: region ${id} split`);
      }
    }
    eq(broken, []);
  });

  test(`${size}x${size}: the declared solution obeys every rule`, () => {
    const broken = [];
    for (const c of sample[size]) {
      const cols = c.solution;
      if (new Set(cols).size !== size) broken.push(`seed ${c.seed}: repeated column`);
      if (new Set(cols.map((col, r) => c.regions[r][col])).size !== size) {
        broken.push(`seed ${c.seed}: two crowns in one region`);
      }
      for (let r = 0; r < size - 1; r++) {
        if (Math.abs(cols[r] - cols[r + 1]) < 2) broken.push(`seed ${c.seed}: crowns touch at row ${r}`);
      }
    }
    eq(broken, []);
  });

  test(`${size}x${size}: every region id is used, so the board is solvable`, () => {
    const broken = [];
    for (const c of sample[size]) {
      const used = new Set(c.regions.flat());
      if (used.size !== size) broken.push(`seed ${c.seed}: ${used.size} regions, expected ${size}`);
    }
    eq(broken, []);
  });
}

suite('generator — refinement keeps the solution it aimed for');

// The sampled boards above rarely exercise this, because refinement usually
// converges on the arrangement it started from. Driving refine() directly over
// many seeds makes the rare case common enough to catch: a board whose single
// solution is *not* the crown arrangement recorded alongside it would ship a
// wrong `solution` field, and every downstream check — hints, win detection
// against the answer, the difficulty rating — would quietly be about the wrong
// board.
test('a refined board always solves to its declared arrangement', () => {
  const size = 6;
  const arrangements = allArrangements(size);
  const mismatches = [];
  let refined = 0;

  for (let seed = 1; seed <= 300 && refined < 40; seed++) {
    const rand = mulberry32(seed * 7919 + size);
    const target = arrangements[Math.floor(rand() * arrangements.length)];
    const layout = growRegions(size, target.map((c, r) => [r, c]), rand);
    if (!layout) continue;

    const result = refine(size, layout, target, arrangements, rand);
    if (!result) continue;
    refined++;

    const puzzle = { id: `refined-${seed}`, size, difficulty: 'test', regions: result, solution: target };
    if (countSolutions(puzzle, 3) !== 1) {
      mismatches.push(`seed ${seed}: not unique`);
      continue;
    }
    const actual = solutionsOf(size, result, arrangements)[0];
    if (actual.join() !== target.join()) {
      mismatches.push(`seed ${seed}: solves to ${actual} but declares ${target}`);
    }
  }

  note(`checked ${refined} refined boards`);
  ok(refined > 10, `only ${refined} boards refined successfully — sample too small to mean anything`);
  eq(mismatches, []);
});

suite('generator — determinism and difficulty');

test('the same seed always produces the same board', () => {
  const first = [...candidates(6, { attempts: 50, timeBudgetMs: 5000, seedFrom: 1 })].slice(0, 3);
  const again = [...candidates(6, { attempts: 50, timeBudgetMs: 5000, seedFrom: 1 })].slice(0, 3);
  eq(
    first.map((c) => `${c.seed}:${c.regions.flat().join('')}`),
    again.map((c) => `${c.seed}:${c.regions.flat().join('')}`)
  );
});

test('different seed ranges produce different boards', () => {
  const low = [...candidates(6, { attempts: 30, timeBudgetMs: 5000, seedFrom: 1 })][0];
  const high = [...candidates(6, { attempts: 30, timeBudgetMs: 5000, seedFrom: 500 })][0];
  ok(low && high, 'expected a board from each range');
  ok(low.regions.flat().join('') !== high.regions.flat().join(''), 'boards should differ');
});

test('generated boards span more than one difficulty', () => {
  // The whole premise of Phase 6.2's cache is that generation can fill several
  // buckets. If it only ever produced one, the difficulty picker is a lie.
  const buckets = new Set();
  for (const size of SIZES) {
    for (const c of sample[size]) buckets.add(difficultyOf(rate(asPuzzle(size, c))));
  }
  for (const b of buckets) note(`produced: ${b}`);
  ok(buckets.size >= 2, `only produced ${[...buckets]}`);
});
