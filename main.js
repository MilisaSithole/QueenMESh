// QueenMESh — Phase 1.1: static board rendering.
//
// Renders a puzzle as a CSS grid of cells coloured by region. No interactivity
// yet; Phase 2 adds pointer handling and Phase 1.2 replaces the uniform cell
// separators with real region-boundary borders.
//
// Everything here is driven by puzzle.size. The 5x5 in puzzles.js is only a
// scaffolding size — the shipping range is 6x6 to 9x9 — so no dimension, loop
// bound, or palette entry may assume 5.

const BUILD_MARKER = 'build 003';

// Raised only if a board is ever authored larger than the palette can colour.
// The 9-colour ceiling is a real constraint, not an arbitrary one: see the
// "Board size range" section of the implementation plan.
const MAX_BOARD_SIZE = 9;

/**
 * Build the cell grid for a puzzle and mount it into the board container.
 *
 * Each cell carries data-row / data-col / data-region. Those attributes do
 * real work beyond debugging: region colour is applied by CSS attribute
 * selector (so Phase 9 can attach colour-blind patterns without touching
 * markup), and Phase 2 reads row/col off the event target so a single
 * delegated listener on the container replaces N-squared listeners.
 */
function renderBoard(boardEl, puzzle) {
  const { size, regions } = puzzle;

  boardEl.style.setProperty('--board-size', size);

  const cells = document.createDocumentFragment();
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.dataset.region = regions[row][col];
      cells.append(cell);
    }
  }

  boardEl.replaceChildren(cells);
}

/**
 * Cheap structural checks on puzzle data. Phase 4 owns proper loud-failure
 * validation of authored puzzle files; this is just enough to make a
 * malformed board obvious now instead of rendering as silent visual nonsense.
 */
function describeProblem(puzzle) {
  if (!puzzle) return 'no puzzle to load';

  const { size, regions } = puzzle;
  if (!Number.isInteger(size) || size < 2) return `bad size: ${size}`;
  if (size > MAX_BOARD_SIZE) return `size ${size} exceeds the ${MAX_BOARD_SIZE} colour palette`;
  if (!Array.isArray(regions) || regions.length !== size) {
    return `expected ${size} region rows, got ${regions?.length}`;
  }

  for (let row = 0; row < size; row++) {
    if (!Array.isArray(regions[row]) || regions[row].length !== size) {
      return `row ${row} has ${regions[row]?.length} cells, expected ${size}`;
    }
    for (const id of regions[row]) {
      if (!Number.isInteger(id) || id < 0 || id >= size) {
        return `row ${row} has out-of-range region id ${id}`;
      }
    }
  }

  return null;
}

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');

const puzzle = PUZZLES[0];
const problem = describeProblem(puzzle);

if (problem) {
  statusEl.textContent = `Puzzle failed to load — ${problem}`;
  statusEl.dataset.state = 'error';
} else {
  renderBoard(boardEl, puzzle);
  statusEl.textContent = `${puzzle.id} · ${puzzle.size}×${puzzle.size} · ${BUILD_MARKER}`;
}
