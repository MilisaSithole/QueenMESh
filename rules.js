// QueenMESh — Phase 3: the four constraints, as pure functions.
//
// Deliberately its own file with no DOM access and no mutation of its
// arguments. Two reasons beyond tidiness:
//
//   * Phase 5's generator calls these thousands of times while checking
//     whether a candidate board has a unique solution.
//   * Phase 5.5 ports this file to Python for the RL environment, with a
//     parity test asserting both implementations agree on every move. That is
//     only tractable if the logic has no browser entanglement.
//
// Cell states live here rather than in main.js because they are part of the
// shared model the Python port has to match, not a rendering detail.

const EMPTY = 0;
const MARK = 1;
const CROWN = 2;

/** Stable identity for a cell, used as a Set key. */
function cellKey(row, col) {
  return row + ',' + col;
}

/** Every crown on the board, in row order. */
function crownPositions(states) {
  const crowns = [];
  for (let row = 0; row < states.length; row++) {
    for (let col = 0; col < states[row].length; col++) {
      if (states[row][col] === CROWN) crowns.push({ row, col });
    }
  }
  return crowns;
}

/**
 * Everything wrong with a board, at two levels of detail.
 *
 * @returns {{ cells: Set<string>, scope: Set<string> }}
 *   `cells` — the crowns actually clashing.
 *   `scope` — every cell belonging to a broken constraint: the whole row,
 *             column or region, not just the two crowns in it. Always a
 *             superset of `cells`.
 *
 * The two levels exist because "these two crowns clash" and "they clash
 * *because they share this row*" are different pieces of information, and the
 * second is the one that tells a player what to do about it. Highlighting only
 * the crowns makes a region conflict especially hard to read, since a region's
 * shape is not something you can infer from two cells.
 *
 * All four constraints are "no two crowns may share X", so three of them are
 * the same duplicate-detection over a different grouping key. Both crowns of a
 * clash are reported, not just the later one: there is no meaningful sense in
 * which one of two crowns sharing a row is the wrong one.
 *
 * Adjacency contributes to `cells` only. It is a relationship between two
 * specific squares, not a line or an area, so there is no wider scope to
 * highlight — spreading it over the surrounding cells would imply a constraint
 * that does not exist.
 *
 * Marks are ignored entirely. They are notes to self, not commitments, so a
 * mark sitting where a crown belongs is not an error.
 */
function findViolations(states, regions) {
  const size = states.length;
  const crowns = crownPositions(states);
  const cells = new Set();
  const scope = new Set();

  const cellsInRow = (row) =>
    Array.from({ length: size }, (_, col) => cellKey(row, col));
  const cellsInColumn = (col) =>
    Array.from({ length: size }, (_, row) => cellKey(row, col));

  const byRegion = new Map();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const id = regions[row][col];
      if (!byRegion.has(id)) byRegion.set(id, []);
      byRegion.get(id).push(cellKey(row, col));
    }
  }

  const flagSharedGroups = (groupOf, cellsInGroup) => {
    const groups = new Map();
    for (const crown of crowns) {
      const key = groupOf(crown);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(crown);
    }
    for (const [key, group] of groups) {
      if (group.length < 2) continue;
      for (const { row, col } of group) cells.add(cellKey(row, col));
      for (const member of cellsInGroup(key)) scope.add(member);
    }
  };

  flagSharedGroups(({ row }) => row, cellsInRow);
  flagSharedGroups(({ col }) => col, cellsInColumn);
  flagSharedGroups(({ row, col }) => regions[row][col], (id) => byRegion.get(id));

  // Adjacency, including diagonals — the rule that makes this more than
  // Sudoku-with-colours. Crowns touching corner to corner clash just as much
  // as ones sharing an edge.
  for (let i = 0; i < crowns.length; i++) {
    for (let j = i + 1; j < crowns.length; j++) {
      const a = crowns[i];
      const b = crowns[j];
      if (Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1) {
        cells.add(cellKey(a.row, a.col));
        cells.add(cellKey(b.row, b.col));
      }
    }
  }

  for (const cell of cells) scope.add(cell);

  return { cells, scope };
}

/**
 * True when the puzzle is finished.
 *
 * N crowns with no violations is sufficient on its own — it does not need a
 * separate "one per row/column/region" check. With N crowns on an N-wide board
 * and no row holding two, every row must hold exactly one; the same argument
 * covers columns and regions. Checking those again would be restating the
 * pigeonhole principle in code.
 */
function isSolved(states, regions) {
  return (
    crownPositions(states).length === states.length &&
    findViolations(states, regions).cells.size === 0
  );
}
