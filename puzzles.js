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
];
