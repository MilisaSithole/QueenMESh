// Phase 6.2 — the puzzle cache.
//
// Tested directly rather than through the board. Almost everything the cache
// does is invisible from outside: it hands over a board that looks the same
// whether it came from stock or a seed, and it refills on idle callbacks the
// app never waits for.
//
// The three properties that matter, and that the first version got wrong:
// boards must be *new* each session, they must match the *whole* selection
// (size and difficulty, not one of them), and generation must never be
// attempted at a size expensive enough to stall the page.

const { suite, test, note, eq, ok } = require('./harness');
const { createPuzzleCache, CACHE_TARGET, DIFFICULTIES, SIZES, CHEAP_SIZES } =
  require('../puzzle-cache');
const generator = require('../generator');
const solver = require('../solver');

// The cache expects these as globals, because in the browser every script
// shares one scope. Providing them here is what the page does implicitly.
global.candidates = generator.candidates;
global.rate = solver.rate;
global.difficultyOf = solver.difficultyOf;

/** Run queued idle work by hand, so nothing happens except when a test says so. */
function withManualIdle(fn) {
  const queued = [];
  const previous = global.requestIdleCallback;
  global.requestIdleCallback = (cb) => { queued.push(cb); return queued.length; };
  try {
    return fn((rounds = 1) => {
      let ran = 0;
      for (let i = 0; i < rounds; i++) {
        const batch = queued.splice(0, queued.length);
        if (!batch.length) break;
        for (const cb of batch) cb();
        ran += batch.length;
      }
      return ran;
    });
  } finally {
    global.requestIdleCallback = previous;
  }
}

/**
 * Empty a bucket, with a hard stop. The obvious `while (take())` never ends if
 * take() stops removing what it hands over — which cost an hour of a hung
 * mutation run to discover. A bound turns that defect into a failed assertion.
 */
function drain(cache, size, difficulty, limit = 50) {
  const taken = [];
  for (let i = 0; i < limit; i++) {
    const puzzle = cache.take(size, difficulty);
    if (!puzzle) return taken;
    taken.push(puzzle);
  }
  throw new Error(`take(${size}, '${difficulty}') never emptied — it is not removing boards`);
}

const board = (id, size, difficulty) => ({
  id, size, difficulty,
  regions: Array.from({ length: size }, () => Array.from({ length: size }, (_, c) => c)),
  solution: Array.from({ length: size }, (_, r) => r),
});

suite('cache — buckets are size *and* difficulty');

test('a board is filed under both halves of its identity', () => {
  const cache = createPuzzleCache({ seeds: [board('a', 6, 'easy')] });
  eq(cache.countFor(6, 'easy'), 1);
  eq(cache.countFor(7, 'easy'), 0, 'a different size is a different bucket');
  eq(cache.countFor(6, 'hard'), 0, 'a different difficulty is a different bucket');
});

test('taking from one bucket never serves another', () => {
  // The first version picked a size itself, so asking for hard could hand back
  // any size and refreshing changed it. Asking for a bucket with nothing in it
  // must return nothing, not something close.
  const cache = createPuzzleCache({ seeds: [board('a', 6, 'easy')] });
  eq(cache.take(7, 'easy'), null);
  eq(cache.take(6, 'hard'), null);
  ok(cache.take(6, 'easy'), 'the matching bucket still works');
});

test('taking a board removes it from stock', () => {
  const cache = withManualIdle(() => createPuzzleCache({ seeds: [board('a', 6, 'easy')] }));
  ok(cache.take(6, 'easy'));
  eq(cache.countFor(6, 'easy'), 0);
  eq(cache.take(6, 'easy'), null);
});

test('taking a board schedules a top-up', () => {
  withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [board('a', 6, 'easy')] });
    cache.select(6, 'easy');
    runIdle();
    cache.take(6, 'easy');
    ok(runIdle() > 0, 'nothing was queued after taking a board');
  });
});

suite('cache — what it refuses');

test('a board of an unknown size or difficulty is not filed', () => {
  const cache = createPuzzleCache({
    seeds: [board('x', 6, 'fiendish'), board('y', 12, 'easy')],
  });
  eq(Object.values(cache.counts()).reduce((a, b) => a + b, 0), 0);
});

test('the same board is never stocked twice', () => {
  const cache = createPuzzleCache({ seeds: [board('a', 6, 'easy'), board('a', 6, 'easy')] });
  eq(cache.countFor(6, 'easy'), 1);
});

suite('cache — generating for the selected bucket only');

test('it fills the bucket that was selected, and no other', () => {
  withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [] });
    cache.select(6, 'medium');
    cache.start();
    runIdle(40);

    const counts = cache.counts();
    note(`stocked: ${JSON.stringify(counts)}`);
    ok(cache.countFor(6, 'medium') > 0, 'the selected bucket was never filled');
    eq(
      Object.keys(counts).filter((k) => k !== '6:medium' && counts[k] > 0),
      [],
      'generation leaked into buckets nobody asked for'
    );
  });
});

test('every generated board matches the bucket exactly', () => {
  withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [] });
    cache.select(7, 'hard');
    cache.start();
    runIdle(40);

    const wrong = drain(cache, 7, 'hard')
      .filter((p) => p.size !== 7 || solver.difficultyOf(solver.rate(p)) !== 'hard')
      .map((p) => `${p.id}: ${p.size}x${p.size} ${solver.difficultyOf(solver.rate(p))}`);
    eq(wrong, []);
  });
});

test('changing the selection moves generation with it', () => {
  withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [] });
    cache.select(6, 'easy');
    cache.start();
    runIdle(20);
    ok(cache.countFor(6, 'easy') > 0, 'first bucket never filled');

    cache.select(6, 'hard');
    runIdle(30);
    ok(cache.countFor(6, 'hard') > 0, 'generation did not follow the new selection');
  });
});

test('filling stops once the selected bucket is full', () => {
  withManualIdle((runIdle) => {
    const full = Array.from({ length: CACHE_TARGET }, (_, i) => board(`f${i}`, 6, 'easy'));
    const cache = createPuzzleCache({ seeds: full });
    cache.select(6, 'easy');
    cache.start();
    const before = cache.counts();
    runIdle(5);
    eq(cache.counts(), before, 'a full bucket should generate nothing');
  });
});

suite('cache — boards differ between sessions');

test('two sessions of the same bucket produce different boards', () => {
  // The generator is deterministic by design. Starting every session at the
  // same seed means the same boards in the same order — generated in name only,
  // which is exactly the complaint this rework answers.
  const run = () => withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [] });
    cache.select(6, 'medium');
    cache.start();
    runIdle(40);
    return drain(cache, 6, 'medium').map((p) => p.id);
  });

  const first = run();
  const second = run();
  note(`session A: ${first.join(', ') || 'none'}`);
  note(`session B: ${second.join(', ') || 'none'}`);

  ok(first.length && second.length, 'a session produced no boards at all');
  ok(first.join() !== second.join(), 'both sessions produced identical boards');
});

test('a fixed seed origin still reproduces exactly, for debugging', () => {
  const run = () => withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [], seedOrigin: 4242 });
    cache.select(6, 'medium');
    cache.start();
    runIdle(40);
    // Sorted: take() hands boards out in random order on purpose, so the set
    // generated is the reproducible part, not the sequence they arrive in.
    return drain(cache, 6, 'medium').map((p) => p.id).sort();
  });
  eq(run(), run(), 'the same seed origin should generate the same boards');
});

suite('cache — never stalls the main thread');

test('main-thread filling only ever asks for cheap sizes', () => {
  // Tests the decision, not the outcome. Watching what lands cannot see this:
  // a 9x9 attempted inside the time budget usually produces nothing, so the
  // bucket stays empty and every assertion about its contents still passes.
  // Timing is no better — a failed refinement returns fast. The request itself
  // is what the size filter controls, so that is what to observe.
  const realCandidates = global.candidates;
  const asked = [];
  global.candidates = function* (size) { asked.push(size); };

  try {
    withManualIdle((runIdle) => {
      const cache = createPuzzleCache({ seeds: [] });
      cache.select(9, 'hard'); // the one size too costly to attempt here
      cache.start();
      runIdle(20);
    });
  } finally {
    global.candidates = realCandidates;
  }

  note(`sizes requested: ${[...new Set(asked)].join(', ') || 'none'}`);
  eq(asked.filter((size) => !CHEAP_SIZES.includes(size)), [], 'an expensive size was attempted');
});

test('a 9x9 selection simply waits rather than freezing', () => {
  withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [] });
    cache.select(9, 'hard');
    cache.start();
    const startedAt = Date.now();
    runIdle(10);
    const elapsed = Date.now() - startedAt;
    note(`${elapsed}ms across ten idle rounds at 9x9`);
    ok(elapsed < 500, `background work took ${elapsed}ms — the page would stutter`);
  });
});

test('every offered size and difficulty is a real bucket', () => {
  const cache = createPuzzleCache({ seeds: [] });
  eq(cache.sizes, SIZES);
  eq(cache.difficulties, DIFFICULTIES);
  for (const size of cache.sizes) {
    for (const difficulty of cache.difficulties) {
      eq(cache.countFor(size, difficulty), 0, `${size}:${difficulty} should start empty`);
    }
  }
});

test('stop() halts background work', () => {
  withManualIdle((runIdle) => {
    const cache = createPuzzleCache({ seeds: [] });
    cache.select(6, 'easy');
    cache.start();
    cache.stop();
    runIdle(3);
    eq(Object.values(cache.counts()).reduce((a, b) => a + b, 0), 0);
  });
});
