// Frozen boards for tests that depend on exact geometry.
//
// Any test that names specific cells — "region 1 is an L shape", "these two
// crowns are adjacent but share nothing else" — is really a test about a
// particular arrangement, not about whatever happens to ship. Pointing those
// at PUZZLES[0] worked until Phase 5.3 replaced the puzzle set, at which point
// several broke and, worse, one negative control silently stopped
// discriminating: it measured zero notches on the new board and would have
// passed against the very defect it exists to catch.
//
// So: content lives in puzzles.js and changes freely; these never change.
// Tests that care about *the shipped set* should still iterate PUZZLES.

/**
 * A 5x5 with deliberately varied region shapes — an L, a diagonal-ish strip,
 * a couple of blobs. Was the Phase 1.1 starter board, kept here because its
 * geometry is referenced by name in several tests.
 *
 *   1 1 0 0 0      region 1 is the L at top-left: (0,0) (0,1) (1,0) (2,0)
 *   1 0 0 2 2      region 2 is (1,3) (1,4) (2,3) (3,3)
 *   1 3 3 2 4
 *   3 3 3 2 4
 *   3 4 4 4 4
 */
const geometry5x5 = {
  id: 'fixture-geometry',
  size: 5,
  difficulty: 'test',
  regions: [
    [1, 1, 0, 0, 0],
    [1, 0, 0, 2, 2],
    [1, 3, 3, 2, 4],
    [3, 3, 3, 2, 4],
    [3, 4, 4, 4, 4],
  ],
  solution: [2, 0, 3, 1, 4],
};

/**
 * A 4x4 whose region 0 is a single cell, so Tier 1 is forced immediately and
 * the eliminations cascade. The only board in the project that the tiered
 * solver can open using Tier 1 alone.
 */
const tierOne4x4 = {
  id: 'fixture-tier1',
  size: 4,
  difficulty: 'test',
  regions: [
    [2, 0, 1, 1],
    [2, 1, 1, 1],
    [2, 2, 3, 3],
    [2, 3, 3, 3],
  ],
  solution: [1, 3, 0, 2],
};

module.exports = { geometry5x5, tierOne4x4 };
