// QueenMESh — the puzzle schema, its validator, and the puzzle set.
//
// All three live in one file on purpose. A schema documented in one place and
// enforced in another drifts apart quietly; keeping the spec directly above the
// code that checks it means a change to either is visible in the same diff.
//
// Deliberately a plain JS object rather than a fetched .json file: fetch() is
// blocked under file://, and the project values being able to run the game by
// opening index.html with no server. The shape is exactly what JSON would hold,
// so nothing is lost but the extension — Phase 5's generator emits this format
// directly, and Phase 5.5's Python port can parse it to stay in lockstep.
//
// ---------------------------------------------------------------------------
// SCHEMA
//
//   id          string, non-empty, unique across the set.
//               Stable: it appears in URLs today and keys saved progress in
//               Phase 7, so renaming one silently discards a player's history.
//
//   size        integer, MIN_BOARD_SIZE..MAX_BOARD_SIZE. The board is size x
//               size with exactly `size` regions. Nothing anywhere may assume
//               a particular value.
//
//   difficulty  string label. Hand-assigned by feel until Phase 5's
//               technique-tier solver measures it properly and re-buckets.
//
//   regions     regions[row][col] = region index, 0..size-1. Every index in
//               that span must appear at least once: with fewer than `size`
//               regions the puzzle cannot be solved at all, since one crown
//               per region and one per row cannot both hold.
//
//   solution    solution[row] = column of that row's crown. Never shown to the
//               player. It exists so tooling can verify a board, and so Phase 6
//               can build hints without re-solving at runtime.
//
// ---------------------------------------------------------------------------
// WHAT IS CHECKED WHERE, AND WHY THE SPLIT
//
// The validator below rejects anything that stops a board being *rendered and
// played*. That is a developer safety net, not a defence against bad input:
// this data is static, so its real job is turning "blank board and a cryptic
// console error" into a sentence naming the problem while boards are being
// authored in Phase 4.2.
//
// Two properties are deliberately NOT checked here, and are covered by the test
// suite instead:
//
//   * That `solution` is actually a solution. A board is perfectly playable
//     without one — win detection reads the rules, never this field — so
//     making it fatal at runtime would reject valid boards to guard a field
//     nothing on the page reads.
//
//   * That the solution is the ONLY solution. Confirming uniqueness means
//     enumerating every valid crown arrangement — 47,622 of them at 9x9 —
//     which is wasted work on every page load for data that never changes.
//
// Both are cheap and thorough offline, and a board failing either can never
// reach a player if the suite is run. Checking them here would cost every
// visitor for a mistake only an author can make.

/** Below 4x4 no arrangement satisfies row, column and adjacency at once. */
const MIN_BOARD_SIZE = 4;

/** The palette defines nine region colours; see the plan's board-size section. */
const MAX_BOARD_SIZE = 9;

/**
 * Why a puzzle cannot be played, as a human-readable sentence, or null if it
 * can. Returns on the first problem found — the goal is to name something
 * actionable, not to produce an exhaustive report.
 */
function describePuzzleProblem(puzzle) {
  if (!puzzle) return 'no puzzle to load';

  const { id, size, regions, solution } = puzzle;

  if (typeof id !== 'string' || !id.trim()) {
    return `puzzle has no usable id (got ${JSON.stringify(id)})`;
  }

  if (!Number.isInteger(size) || size < MIN_BOARD_SIZE || size > MAX_BOARD_SIZE) {
    return `${id}: size must be an integer ${MIN_BOARD_SIZE}-${MAX_BOARD_SIZE}, got ${size}`;
  }

  if (!Array.isArray(regions) || regions.length !== size) {
    return `${id}: expected ${size} region rows, got ${regions?.length}`;
  }

  const used = new Set();
  for (let row = 0; row < size; row++) {
    const cells = regions[row];
    if (!Array.isArray(cells) || cells.length !== size) {
      return `${id}: row ${row} has ${cells?.length} cells, expected ${size}`;
    }
    for (const region of cells) {
      if (!Number.isInteger(region) || region < 0 || region >= size) {
        return `${id}: row ${row} has out-of-range region id ${JSON.stringify(region)}`;
      }
      used.add(region);
    }
  }

  if (used.size !== size) {
    const missing = [...Array(size).keys()].filter((i) => !used.has(i));
    return `${id}: region ids ${missing.join(', ')} are unused, so the board cannot be solved`;
  }

  // Shape only. Whether it is a correct solution is the test suite's job.
  if (solution !== undefined) {
    if (!Array.isArray(solution) || solution.length !== size) {
      return `${id}: solution should list ${size} columns, got ${solution?.length}`;
    }
    for (const col of solution) {
      if (!Number.isInteger(col) || col < 0 || col >= size) {
        return `${id}: solution has out-of-range column ${JSON.stringify(col)}`;
      }
    }
  }

  return null;
}

/**
 * Problems with the set as a whole rather than any one puzzle.
 *
 * Duplicate ids matter more than they look: selection is by id, so a duplicate
 * makes it silently ambiguous which board loads, and Phase 7 would file two
 * puzzles' progress under one key.
 */
function describePuzzleSetProblem(puzzles) {
  if (!Array.isArray(puzzles) || puzzles.length === 0) return 'no puzzles are defined';

  const seen = new Set();
  for (const puzzle of puzzles) {
    const id = puzzle?.id;
    if (typeof id === 'string' && seen.has(id)) return `duplicate puzzle id "${id}"`;
    seen.add(id);
  }

  return null;
}

// ---------------------------------------------------------------------------
// THE SET
//
// One board per size, 5x5 through 9x9, ordered gently to steeply.
//
// Every board except the 5x5 came out of `tools/generate-puzzle.js`, which
// grows regions from a chosen crown arrangement and then refines the layout
// until exactly one solution survives. They are generated *and curated*: the
// tool cannot tell whether a board looks like a fair puzzle, so candidates were
// filtered for balanced region sizes and eyeballed before landing here.
//
// Ids never encode difficulty, on purpose. They are stable identifiers — they
// appear in URLs and will key saved progress in Phase 7 — while difficulty is
// expected to change: Phase 5's technique-tier solver measures it properly and
// will re-bucket these. Baking a guess into an id would force a rename later,
// and renaming an id silently discards a player's history.
//
// The `difficulty` labels below are provisional and assigned by grid size,
// which the plan is explicit is a *weak* signal — a small board can be brutal
// and a large one trivial. 'impossible' is the shakiest of them: the tier
// definition means "needs trial-and-error branching", which is a specific claim
// nothing has verified yet.
const PUZZLES = [
  {
    id: 'starter-5x5',
    size: 5,
    difficulty: 'tutorial',

    // Verified to have exactly one solution: of the 14 crown arrangements that
    // satisfy row/column/adjacency on a 5x5, this region layout admits only
    // the one recorded below. Every region is contiguous, sizes are 5/4/4/6/6,
    // and none is a degenerate single cell.
    //
    //   B B a A A       lowercase marks the crown cell
    //   b A A C C
    //   B D D c E
    //   D d D C E
    //   D E E E e
    regions: [
      [1, 1, 0, 0, 0],
      [1, 0, 0, 2, 2],
      [1, 3, 3, 2, 4],
      [3, 3, 3, 2, 4],
      [3, 4, 4, 4, 4],
    ],
    solution: [2, 0, 3, 1, 4],
  },

  {
    id: 'curated-6x6',
    size: 6,
    difficulty: 'easy',

    // region sizes 4,5,5,6,8,8 — spread 4, the most even of the set
    //
    //    1  1  0  0 (0) 0        parens mark the crown cell
    //    5 (1) 1  2  2  3
    //    5  4  1 (2) 3  3
    //    5  4  4  2  2 (3)
    //    5  5 (4) 4  3  3
    //   (5) 5  5  4  4  4
    regions: [
      [1, 1, 0, 0, 0, 0],
      [5, 1, 1, 2, 2, 3],
      [5, 4, 1, 2, 3, 3],
      [5, 4, 4, 2, 2, 3],
      [5, 5, 4, 4, 3, 3],
      [5, 5, 5, 4, 4, 4],
    ],
    solution: [4, 1, 3, 5, 2, 0],
  },

  {
    id: 'curated-7x7',
    size: 7,
    difficulty: 'medium',

    // region sizes 5,5,5,6,8,9,11 — spread 6
    //
    //   (0) 0  0  0  1  1  2
    //    0  0 (1) 0  1  1  2
    //    0  1  1  1  1 (2) 2
    //    3 (3) 1  1  4  2  5
    //    3  3  3  3 (4) 2  5
    //    3  3  3  4  4  4 (5)
    //    6  6  6 (6) 6  5  5
    regions: [
      [0, 0, 0, 0, 1, 1, 2],
      [0, 0, 1, 0, 1, 1, 2],
      [0, 1, 1, 1, 1, 2, 2],
      [3, 3, 1, 1, 4, 2, 5],
      [3, 3, 3, 3, 4, 2, 5],
      [3, 3, 3, 4, 4, 4, 5],
      [6, 6, 6, 6, 6, 5, 5],
    ],
    solution: [0, 2, 5, 1, 4, 6, 3],
  },

  {
    id: 'curated-8x8',
    size: 8,
    difficulty: 'hard',

    // region sizes 5,6,6,6,8,8,12,13 — spread 8
    //
    //    1  0  0  0  0 (0) 0  0
    //    1 (1) 2  2  2  0  0  0
    //    3  1  2 (2) 2  0  2  0
    //   (3) 1  2  2  2  2  2  2
    //    3  3  3  3  4  4  4 (4)
    //    7  7  3  3 (5) 6  6  4
    //    7  7  5  5  5  5 (6) 4
    //    7  7 (7) 7  5  6  6  6
    regions: [
      [1, 0, 0, 0, 0, 0, 0, 0],
      [1, 1, 2, 2, 2, 0, 0, 0],
      [3, 1, 2, 2, 2, 0, 2, 0],
      [3, 1, 2, 2, 2, 2, 2, 2],
      [3, 3, 3, 3, 4, 4, 4, 4],
      [7, 7, 3, 3, 5, 6, 6, 4],
      [7, 7, 5, 5, 5, 5, 6, 4],
      [7, 7, 7, 7, 5, 6, 6, 6],
    ],
    solution: [5, 1, 3, 0, 7, 4, 6, 2],
  },

  {
    // Replaces the dev-only 9x9 that Phase 2.2 added for tap-target testing.
    // Same purpose still applies — this is the board to load when checking
    // touch ergonomics, since 9x9 leaves only 44.20px per cell on a 412px-wide
    // phone and every smaller board passes that check trivially.
    id: 'curated-9x9',
    size: 9,
    difficulty: 'impossible',

    // region sizes 4,5,6,8,9,10,11,14,14 — spread 10
    //
    //    0 (0) 0  2  2  2  2  1  1
    //    0  3  0  0  2  2  1  1 (1)
    //    3  3  0  0  2  2 (2) 2  1
    //   (3) 0  0  0  2  2  2  1  1
    //    3  3  0  0  2  4  4 (4) 1
    //    3  3  0  5 (5) 5  5  4  4
    //    3  3 (6) 6  8  5  5  4  4
    //    6  3  6  6  8 (7) 4  4  4
    //    6  6  6 (8) 8  7  7  7  7
    regions: [
      [0, 0, 0, 2, 2, 2, 2, 1, 1],
      [0, 3, 0, 0, 2, 2, 1, 1, 1],
      [3, 3, 0, 0, 2, 2, 2, 2, 1],
      [3, 0, 0, 0, 2, 2, 2, 1, 1],
      [3, 3, 0, 0, 2, 4, 4, 4, 1],
      [3, 3, 0, 5, 5, 5, 5, 4, 4],
      [3, 3, 6, 6, 8, 5, 5, 4, 4],
      [6, 3, 6, 6, 8, 7, 4, 4, 4],
      [6, 6, 6, 8, 8, 7, 7, 7, 7],
    ],
    solution: [1, 8, 6, 0, 7, 4, 2, 5, 3],
  },
];
