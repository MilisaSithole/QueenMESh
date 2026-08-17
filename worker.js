// Generates puzzles off the main thread.
//
// Generation is not slice-able into idle-sized pieces: one 9x9 board takes
// about two seconds of solid work inside a single refinement run, and there is
// no natural yield point in the middle of it. Chunking on the main thread
// would still hand the browser a two-second task, which is exactly the freeze
// this is meant to avoid. A worker sidesteps the problem instead of managing
// it.
//
// The fallback for environments without workers lives in puzzle-cache.js.

/* global importScripts, postMessage */

importScripts('rules.js', 'solver.js', 'generator.js');

/**
 * Produce boards of a requested difficulty.
 *
 * Difficulty cannot be requested from the generator directly — it emerges from
 * the board and is only known once the solver has rated it. So this generates
 * candidates and keeps the ones that landed in the bucket asked for, reporting
 * each as it arrives rather than batching, so the cache can start using the
 * first one without waiting for the rest.
 */
function generateFor(size, difficulty, count, deadlineMs, seedFrom) {
  const startedAt = Date.now();
  let made = 0;

  // seedFrom matters more than it looks. The generator is deterministic, so
  // starting every session at the same seed produces the same boards in the
  // same order — generated in name only.
  for (const candidate of candidates(size, { attempts: 20000, timeBudgetMs: deadlineMs, seedFrom })) {
    const puzzle = {
      id: `generated-${size}-${difficulty}-${candidate.seed}`,
      size,
      difficulty,
      regions: candidate.regions,
      solution: candidate.solution,
    };

    if (difficultyOf(rate(puzzle)) !== difficulty) continue;

    postMessage({ type: 'puzzle', puzzle });
    if (++made >= count) return made;
    if (Date.now() - startedAt > deadlineMs) return made;
  }
  return made;
}

self.onmessage = (event) => {
  const { size, difficulty, count = 1, deadlineMs = 15000, seedFrom = 1 } = event.data;
  let made = 0;
  try {
    made = generateFor(size, difficulty, Math.max(1, count), deadlineMs, seedFrom);
  } catch (error) {
    postMessage({ type: 'error', message: String(error && error.message) });
  }
  postMessage({ type: 'done', size, difficulty, made });
};
