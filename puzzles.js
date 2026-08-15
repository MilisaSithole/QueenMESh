// QueenMESh — puzzle data.
//
// Phase 1.1 holds a single hardcoded puzzle, but it is already shaped the way
// the Phase 4 JSON schema will want it, so that phase is a file move rather
// than a rewrite. Deliberately a plain JS object rather than a fetched .json
// file: fetch() is blocked under file://, and the plan values being able to
// open index.html directly with no server.
//
// Schema
//   id         stable identifier, used later for progress persistence (Phase 7)
//   size       N. The board is N x N with N regions. Nothing else may assume 5.
//   difficulty coarse label; Phase 5 replaces hand-labels with tier scoring
//   regions    regions[row][col] = region index, 0 .. size-1
//   solution   solution[row] = column of that row's crown
//
// `solution` is not shown to the player. It exists so Phase 3 can verify win
// detection against a known-good answer and Phase 6 can build hints on it.
//
// Any puzzle here can be loaded with ?puzzle=<id> until Phase 4 adds a picker.

const PUZZLES = [
  {
    id: 'starter-5x5',
    size: 5,
    difficulty: 'easy',

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
    // Exists for one reason: 9x9 is the largest board the game will ship, and
    // it is the only size where the ~44px tap target is actually in question
    // (~45px per cell on a 412px-wide phone). Testing input on the 5x5 passes
    // trivially and proves nothing. Phase 4 either promotes this into the real
    // puzzle set or replaces it with a better-authored board.
    //
    // Worth recording for Phase 5: growing regions at random and keeping only
    // unique-solution boards does NOT scale. At 9x9 there are 47,622 crown
    // arrangements satisfying row/column/adjacency, and 143,000 random layouts
    // produced zero unique puzzles. This one came from grow-then-refine —
    // repeatedly find an unwanted alternate solution and reassign one cell to
    // a neighbouring region to kill it, keeping every region contiguous and
    // still holding exactly one crown. That found a unique board in 8 layouts.
    id: 'dev-9x9',
    size: 9,
    difficulty: 'dev',

    //    2  2  2  1  1 (0) 0  0  3        lowercase/parens = crown cell
    //    2  1  1 (1) 1  1  0  0  3
    //    2 (2) 1  1  1  1  0  0  3
    //    2  4  4  4  1  1  0  0 (3)
    //    2  4 (4) 4  1  6  0  3  3
    //    7  4  4  4  4  6 (5) 3  3
    //    7  4  4  4 (6) 6  5  5  3
    //   (7) 4  4  7  7  6  8  5  8
    //    7  7  7  7  6  6  8 (8) 8
    regions: [
      [2, 2, 2, 1, 1, 0, 0, 0, 3],
      [2, 1, 1, 1, 1, 1, 0, 0, 3],
      [2, 2, 1, 1, 1, 1, 0, 0, 3],
      [2, 4, 4, 4, 1, 1, 0, 0, 3],
      [2, 4, 4, 4, 1, 6, 0, 3, 3],
      [7, 4, 4, 4, 4, 6, 5, 3, 3],
      [7, 4, 4, 4, 6, 6, 5, 5, 3],
      [7, 4, 4, 7, 7, 6, 8, 5, 8],
      [7, 7, 7, 7, 6, 6, 8, 8, 8],
    ],
    solution: [5, 3, 1, 8, 2, 6, 4, 0, 7],
  },
];
