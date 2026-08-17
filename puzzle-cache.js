// Keeps a stock of ready-to-play boards for the size and difficulty the player
// has chosen, topped up in the background.
//
// Three things this gets right that the first attempt did not:
//
//   * It generates for one bucket — the selected size *and* difficulty. The
//     first version let the cache pick a size, so choosing "hard" could hand
//     back a 7x7 or a 9x9 and refreshing changed it. If you ask for 5x5 easy
//     you get 5x5 easy, every time.
//   * It starts from a random seed. The generator is deterministic by design,
//     so a fixed starting point means every session produces the same boards in
//     the same order — a puzzle game that looks generated and is not.
//   * Seeds from puzzles.js are a fallback for their own bucket only, never a
//     substitute for a different one.
//
// Feasibility, measured: every size and difficulty pair generates in under half
// a second except 9x9 easy and 9x9 medium, which are rare enough not to turn up
// in eight seconds of searching. Those two are honest about still looking
// rather than pretending to be instant.

const CACHE_TARGET = 3;
const DIFFICULTIES = ['easy', 'medium', 'hard', 'impossible'];
const SIZES = [5, 6, 7, 8, 9];

/**
 * Sizes cheap enough to generate on the main thread without a visible stall.
 * Measured in Phase 6.1: a 9x9 candidate costs about 1.9s, everything smaller
 * is milliseconds. Only relevant without a worker — opening index.html straight
 * off the filesystem, where browsers refuse to construct one.
 */
const CHEAP_SIZES = [5, 6, 7, 8];

const bucketKey = (size, difficulty) => `${size}:${difficulty}`;

/** Far enough apart that two sessions do not explore the same seeds. */
const randomSeedOrigin = () => 1 + Math.floor(Math.random() * 1000000) * 977;

function createPuzzleCache({
  seeds = [],
  onReady = () => {},
  seedOrigin = randomSeedOrigin(),
} = {}) {
  const stock = new Map();
  const seen = new Set();

  // Where the search has got to for each bucket. Advancing this rather than
  // restarting is what stops the same handful of boards reappearing.
  const searchFrom = new Map();

  let selected = { size: SIZES[0], difficulty: DIFFICULTIES[0] };
  let worker = null;
  let busy = false;
  let stopped = false;

  const held = (size, difficulty) => stock.get(bucketKey(size, difficulty)) ?? [];

  function admit(puzzle, { notify = true } = {}) {
    if (!puzzle || seen.has(puzzle.id)) return;
    if (!DIFFICULTIES.includes(puzzle.difficulty) || !SIZES.includes(puzzle.size)) return;

    const key = bucketKey(puzzle.size, puzzle.difficulty);
    if (!stock.has(key)) stock.set(key, []);
    seen.add(puzzle.id);
    stock.get(key).push(puzzle);
    if (notify) onReady(puzzle.size, puzzle.difficulty, stock.get(key).length);
  }

  // Silently: onReady means "a board just finished generating", and firing it
  // during construction would call back before this function has returned.
  for (const seed of seeds) admit(seed, { notify: false });

  function nextSeedFor(size, difficulty) {
    const key = bucketKey(size, difficulty);
    const from = searchFrom.get(key) ?? seedOrigin;
    // Step well past the range just searched, so the next attempt explores new
    // ground instead of re-deriving boards already found and taken.
    searchFrom.set(key, from + 5000);
    return from;
  }

  // --- background filling -------------------------------------------------

  function startWorker() {
    try {
      worker = new Worker('worker.js');
    } catch {
      return false; // file:// forbids workers; the main-thread path covers it
    }

    worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === 'puzzle') admit(message.puzzle);
      else if (message.type === 'done') { busy = false; schedule(fill); }
    };
    worker.onerror = () => { worker = null; busy = false; };
    return true;
  }

  function fillWithWorker(size, difficulty) {
    busy = true;
    worker.postMessage({
      size,
      difficulty,
      count: CACHE_TARGET - held(size, difficulty).length,
      seedFrom: nextSeedFor(size, difficulty),
      deadlineMs: 10000,
    });
  }

  function fillOnMainThread(size, difficulty) {
    if (!CHEAP_SIZES.includes(size)) return; // a 9x9 here would freeze the page

    const options = { attempts: 4000, timeBudgetMs: 60, seedFrom: nextSeedFor(size, difficulty) };
    for (const candidate of candidates(size, options)) {
      const puzzle = {
        id: `generated-${size}-${difficulty}-${candidate.seed}`,
        size,
        difficulty,
        regions: candidate.regions,
        solution: candidate.solution,
      };
      if (difficultyOf(rate(puzzle)) !== difficulty) continue;
      admit(puzzle);
      break;
    }
    schedule(fill);
  }

  const schedule = (fn) =>
    (typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => fn(), { timeout: 300 })
      : setTimeout(fn, 20));

  /** Only ever fills the selected bucket — that is the whole contract. */
  function fill() {
    if (stopped || busy) return;
    const { size, difficulty } = selected;
    if (held(size, difficulty).length >= CACHE_TARGET) return;
    if (worker) fillWithWorker(size, difficulty);
    else fillOnMainThread(size, difficulty);
  }

  return {
    sizes: SIZES,
    difficulties: DIFFICULTIES,

    /** Choose the bucket to play from and to keep stocked. */
    select(size, difficulty) {
      selected = { size, difficulty };
      schedule(fill);
    },

    selection: () => ({ ...selected }),

    /** Take a board from a bucket, or null when none is ready yet. */
    take(size, difficulty) {
      const bucket = held(size, difficulty);
      if (!bucket.length) return null;
      const [puzzle] = bucket.splice(Math.floor(Math.random() * bucket.length), 1);
      schedule(fill);
      return puzzle;
    },

    countFor: (size, difficulty) => held(size, difficulty).length,

    counts() {
      const out = {};
      for (const [key, boards] of stock) out[key] = boards.length;
      return out;
    },

    start() {
      stopped = false;
      if (!worker) startWorker();
      schedule(fill);
    },

    stop() {
      stopped = true;
      if (worker) worker.terminate();
      worker = null;
    },

    get usingWorker() { return Boolean(worker); },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    createPuzzleCache, CACHE_TARGET, DIFFICULTIES, SIZES, CHEAP_SIZES, bucketKey,
  };
}
