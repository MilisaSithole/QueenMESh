// Generate candidate boards, rate them, and print the ones worth shipping.
//
//   node tools/build-puzzle-set.js              survey every size
//   node tools/build-puzzle-set.js 6 7          survey just those sizes
//
// The point of this over generate-puzzle.js is the rating. That tool selects
// for uniqueness and balanced region sizes, which says nothing about whether a
// person can solve the board by reasoning — and Phase 5.2 found the two come
// apart badly. Roughly 40% of unique boards cannot be solved by logic at all.
//
// So difficulty is *measured here and selected for*, rather than guessed at
// afterwards. A board's label is the bucket its solve path actually earned.

const { candidates } = require('../generator');
const { rate, difficultyOf } = require('../solver');

const BUCKETS = ['easy', 'medium', 'hard', 'impossible'];

function survey(size, { attempts = 600, timeBudgetMs = 90000 } = {}) {
  const found = Object.fromEntries(BUCKETS.map((b) => [b, []]));
  let total = 0;

  for (const candidate of candidates(size, { attempts, timeBudgetMs })) {
    const puzzle = {
      id: `candidate-${size}-${candidate.seed}`,
      size,
      difficulty: 'unrated',
      regions: candidate.regions,
      solution: candidate.solution,
    };
    const rating = rate(puzzle);
    const bucket = difficultyOf(rating);
    total++;
    if (bucket) found[bucket].push({ ...candidate, rating });
  }

  // Prefer the most evenly-shaped board in each bucket: region balance is a
  // presentation concern, difficulty is the thing being selected for, and
  // there is no reason not to have both.
  for (const bucket of BUCKETS) found[bucket].sort((a, b) => a.spread - b.spread);
  return { found, total };
}

function emit(size, bucket, entry) {
  const preview = entry.regions
    .map((row, r) => '    //   ' + row.map((v, c) => (entry.solution[r] === c ? `(${v})` : ` ${v} `)).join(''))
    .join('\n');

  // The id carries the size but never the difficulty. Difficulty is a
  // measurement that moves whenever the solver gains a rule, and ids are
  // stable keys — Phase 7 files saved progress under them, so a rename
  // discards a player's history.
  console.log(`
  {
    id: 'board-${size}x${size}',
    size: ${size},
    difficulty: '${bucket}',

    // region sizes ${[...entry.sizes].sort((a, b) => a - b).join(',')} — spread ${entry.spread}
    // rated by tools/solver.js: tier ${entry.rating.tier}, ${entry.rating.log.length} deductions
${preview}
    regions: [
${entry.regions.map((row) => `      [${row.join(', ')}],`).join('\n')}
    ],
    solution: [${entry.solution.join(', ')}],
  },`);
}

const sizes = process.argv.slice(2).map(Number).filter(Boolean);
const wanted = sizes.length ? sizes : [5, 6, 7, 8, 9];

console.log('size  candidates  easy  medium  hard  impossible');
const surveys = {};
for (const size of wanted) {
  const { found, total } = survey(size);
  surveys[size] = found;
  console.log(
    String(size).padEnd(5),
    String(total).padEnd(11),
    ...BUCKETS.map((b) => String(found[b].length).padEnd(b === 'impossible' ? 10 : b.length + 2))
  );
}

console.log('\n--- best of each bucket, by region balance ---');
for (const size of wanted) {
  for (const bucket of BUCKETS) {
    const best = surveys[size][bucket][0];
    if (best) emit(size, bucket, best);
  }
}
