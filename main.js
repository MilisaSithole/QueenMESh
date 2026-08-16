// QueenMESh — Phase 3: rendering, input, and live rule feedback.
//
// Tapping a cell cycles it empty -> mark -> crown -> empty; dragging across
// cells paints or erases X marks in bulk. After every gesture the board is
// re-checked against the four constraints in rules.js, clashing cells are
// flagged, and a completed puzzle is announced.
//
// Everything is driven by puzzle.size. The 5x5 in puzzles.js is only a
// scaffolding size — the shipping range is 6x6 to 9x9 — so no dimension, loop
// bound, or palette entry may assume 5.

const BUILD_MARKER = 'build 012';

// Raised only if a board is ever authored larger than the palette can colour.
// The 9-colour ceiling is a real constraint, not an arbitrary one: see the
// "Board size range" section of the implementation plan.
const MAX_BOARD_SIZE = 9;

// EMPTY / MARK / CROWN come from rules.js, which owns the shared model. The
// names below are presentation only.
//
// The state array is a plain 2D array of small integers rather than anything
// richer, because it outlives this phase: rules.js validates it, Phase 6's
// undo/redo clones it on every move, and Phase 7 serialises it to
// localStorage. Cheap to copy and cheap to stringify beats expressive.

// Index by state; drives both the data-state attribute and the glyph lookup.
const STATE_NAMES = ['empty', 'mark', 'crown'];
const STATE_GLYPHS = [null, '#glyph-mark', '#glyph-crown'];

/**
 * Live game state. Rebuilt by startPuzzle(); never shared with puzzle data,
 * which is immutable and outlives any individual attempt.
 */
let cellStates = [];
let cellElements = [];

/**
 * Build the cell grid for a puzzle and mount it into the board container.
 *
 * Each cell carries data-row / data-col / data-region. Those attributes do
 * real work beyond debugging: region colour is applied by CSS attribute
 * selector (so Phase 6.5 can attach region patterns without touching markup),
 * and the pointer handler reads row/col off the event target so a single
 * delegated listener on the container replaces N-squared listeners.
 *
 * Returns a 2D array of the created elements so state changes can address a
 * cell directly instead of querying the DOM on every tap.
 */
function renderBoard(boardEl, puzzle) {
  const { size, regions } = puzzle;

  boardEl.style.setProperty('--board-size', size);

  const elements = [];
  const cells = document.createDocumentFragment();

  for (let row = 0; row < size; row++) {
    elements[row] = [];

    for (let col = 0; col < size; col++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = row;
      cell.dataset.col = col;
      cell.dataset.region = regions[row][col];
      cell.dataset.state = STATE_NAMES[EMPTY];

      // One stable glyph node per cell, hidden by CSS while the cell is
      // empty. Swapping the <use> target is cheaper than rebuilding markup,
      // and leaves Phase 6 a node that persists across state changes.
      const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      glyph.setAttribute('class', 'glyph');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.setAttribute('focusable', 'false');
      glyph.append(document.createElementNS('http://www.w3.org/2000/svg', 'use'));
      cell.append(glyph);

      // Region boundaries. Both cells sharing a boundary mark it, each drawing
      // half the width, so the line ends up centred on the grid line and
      // corners join cleanly -- see the box-shadow comment in style.css for
      // why drawing it once from a single side leaves notches at corners.
      //
      // Hairlines are the exception: they are drawn once, on the right and
      // bottom, so only those two sides have a "no neighbour" case to suppress.
      const region = regions[row][col];

      if (col === size - 1) {
        cell.classList.add('last-col');
      } else if (region !== regions[row][col + 1]) {
        cell.classList.add('b-r');
      }

      if (row === size - 1) {
        cell.classList.add('last-row');
      } else if (region !== regions[row + 1][col]) {
        cell.classList.add('b-b');
      }

      if (col > 0 && region !== regions[row][col - 1]) cell.classList.add('b-l');
      if (row > 0 && region !== regions[row - 1][col]) cell.classList.add('b-t');

      elements[row][col] = cell;
      cells.append(cell);
    }
  }

  boardEl.replaceChildren(cells);
  return elements;
}

/**
 * Apply a state to one cell, updating both the model and just that cell's DOM.
 *
 * Deliberately not a whole-board re-render: rebuilding every cell on each tap
 * would discard hover and focus state and leave Phase 6's animations nothing
 * stable to animate.
 */
function setCellState(row, col, state) {
  cellStates[row][col] = state;

  const cell = cellElements[row][col];
  cell.dataset.state = STATE_NAMES[state];

  const target = STATE_GLYPHS[state];
  if (target) cell.querySelector('use').setAttribute('href', target);
}

/**
 * empty -> mark -> crown -> empty. The mark is a note-to-self ("no crown can
 * go here"), so placing a crown deliberately costs two taps; that is the
 * interaction model, not an accident.
 */
function cycleCell(row, col) {
  setCellState(row, col, (cellStates[row][col] + 1) % STATE_NAMES.length);
}

/**
 * Recompute rule violations and win state, and reflect both in the DOM.
 *
 * Violations are derived, never stored: keeping a second copy of "which cells
 * are wrong" alongside the board would just be a cache to forget to
 * invalidate. Recomputing costs a pass over at most 81 cells, which is far
 * below anything a player could perceive.
 *
 * Called after every completed gesture rather than only after crown changes.
 * Marks cannot create or clear a violation, so the extra calls are wasted
 * work — but "recompute after any change" is a rule with no exceptions to get
 * wrong later, and the work is negligible.
 */
function refreshRuleState() {
  const violations = findViolations(cellStates, puzzle.regions);

  // Two tiers: the clashing crowns get the strong marker, the rest of the
  // broken row/column/region gets a tint. Both come off one attribute so a
  // cell can never end up in an in-between state.
  for (let row = 0; row < puzzle.size; row++) {
    for (let col = 0; col < puzzle.size; col++) {
      const cell = cellElements[row][col];
      const key = cellKey(row, col);
      if (violations.cells.has(key)) cell.dataset.violation = 'cell';
      else if (violations.scope.has(key)) cell.dataset.violation = 'scope';
      else delete cell.dataset.violation;
    }
  }

  const solved = isSolved(cellStates, puzzle.regions);
  if (solved) boardEl.dataset.solved = 'true';
  else delete boardEl.dataset.solved;

  updateStatus(solved);
}

function updateStatus(solved) {
  const base = notice
    ? `${notice} · ${BUILD_MARKER}`
    : `${puzzle.id} · ${puzzle.size}×${puzzle.size} · ${BUILD_MARKER}`;

  statusEl.textContent = solved ? `Solved! · ${base}` : base;

  if (solved) statusEl.dataset.state = 'solved';
  else if (notice) statusEl.dataset.state = 'warning';
  else delete statusEl.dataset.state;
}

// ---------------------------------------------------------------------------
// Input
//
// One gesture, two meanings: a press and release without leaving the cell is a
// tap and cycles that cell, while dragging across cells paints X marks. Which
// one happened is only known at the end, so nothing is applied on pointerdown.
//
// Pointer Events unify mouse, touch and pen, so the S Pen arrives here as an
// ordinary pointer with no stylus-specific branch.
// ---------------------------------------------------------------------------

/** Pointer currently driving a gesture; ignores additional fingers. */
let gesturePointerId = null;
let gestureStart = null;
/** null until the pointer leaves the starting cell, then 'mark' or 'erase'. */
let paintMode = null;
let hasLeftStartCell = false;

/**
 * The cell under the pointer right now.
 *
 * Hit-testing by coordinate rather than reading event.target, because touch
 * implicitly captures the pointer to whatever element received pointerdown --
 * so during a touch drag every pointermove reports the *starting* cell and
 * nothing else. Glyphs are pointer-events:none, so this always resolves to a
 * cell and never to a crown drawn on one.
 */
function cellAtPoint(event) {
  const el = document.elementFromPoint(event.clientX, event.clientY);
  return el ? el.closest('.cell') : null;
}

function cellCoords(cell) {
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

/**
 * Apply the active paint mode to one cell.
 *
 * Crowns are skipped in both directions: a drag is a bulk annotation gesture,
 * and having it wipe out deliberately placed crowns would make it dangerous to
 * use on a board you have work invested in.
 */
function paintCell(row, col) {
  const state = cellStates[row][col];
  if (paintMode === 'mark' && state === EMPTY) setCellState(row, col, MARK);
  else if (paintMode === 'erase' && state === MARK) setCellState(row, col, EMPTY);
}

function onPointerDown(event) {
  if (gesturePointerId !== null) return;

  const cell = event.target.closest('.cell');
  if (!cell) return;

  gesturePointerId = event.pointerId;
  gestureStart = cellCoords(cell);
  paintMode = null;
  hasLeftStartCell = false;

  // Capture so the gesture survives the pointer leaving the board mid-drag.
  boardEl.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (event.pointerId !== gesturePointerId) return;

  const cell = cellAtPoint(event);
  if (!cell) return;

  const { row, col } = cellCoords(cell);
  const onStartCell = row === gestureStart.row && col === gestureStart.col;
  if (onStartCell && !hasLeftStartCell) return;

  if (!hasLeftStartCell) {
    hasLeftStartCell = true;

    // Direction is decided once, from what the gesture started on, so one
    // stroke never both adds and removes marks: dragging from a marked cell
    // erases, dragging from anywhere else marks. Starting on a crown paints
    // nothing at all -- that gesture is almost certainly a mis-drag.
    const startState = cellStates[gestureStart.row][gestureStart.col];
    if (startState === CROWN) return;

    paintMode = startState === MARK ? 'erase' : 'mark';
    paintCell(gestureStart.row, gestureStart.col);
  }

  if (paintMode) paintCell(row, col);
}

function onPointerUp(event) {
  if (event.pointerId !== gesturePointerId) return;

  // A gesture that never left its starting cell is a tap.
  if (!hasLeftStartCell) cycleCell(gestureStart.row, gestureStart.col);

  endGesture(event);
}

/** Fires when the OS takes the gesture over -- palm rejection, system swipes. */
function onPointerCancel(event) {
  if (event.pointerId !== gesturePointerId) return;
  endGesture(event);
}

function endGesture(event) {
  if (boardEl.hasPointerCapture(event.pointerId)) {
    boardEl.releasePointerCapture(event.pointerId);
  }
  gesturePointerId = null;
  gestureStart = null;
  paintMode = null;
  hasLeftStartCell = false;

  // Every gesture ends here, including cancelled ones, so this is the single
  // place rule state can be refreshed with no path left uncovered.
  refreshRuleState();
}

/**
 * Pick which puzzle to load from `?puzzle=<id>`.
 *
 * A stopgap until Phase 4's picker, so the 9x9 can be reached for tap-target
 * testing. Keyed by id rather than index so a URL keeps working when the
 * puzzle list is reordered.
 *
 * An unrecognised id falls back to the first puzzle but reports itself: a
 * silent fallback would look identical to a typo in the URL, and you would
 * spend a while wondering why the 9x9 "isn't working".
 *
 * Pure, so it can be tested without a DOM or a browser.
 */
function selectPuzzle(puzzles, search) {
  const requested = new URLSearchParams(search || '').get('puzzle');
  if (!requested) return { puzzle: puzzles[0], notice: null };

  const found = puzzles.find((p) => p.id === requested);
  if (found) return { puzzle: found, notice: null };

  return {
    puzzle: puzzles[0],
    notice: `no puzzle "${requested}" — loaded ${puzzles[0].id}`,
  };
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

const { puzzle, notice } = selectPuzzle(PUZZLES, location.search);
const problem = describeProblem(puzzle);

if (problem) {
  statusEl.textContent = `Puzzle failed to load — ${problem}`;
  statusEl.dataset.state = 'error';
} else {
  cellStates = Array.from({ length: puzzle.size }, () => new Array(puzzle.size).fill(EMPTY));
  cellElements = renderBoard(boardEl, puzzle);
  boardEl.addEventListener('pointerdown', onPointerDown);
  boardEl.addEventListener('pointermove', onPointerMove);
  boardEl.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('pointercancel', onPointerCancel);

  // Establishes the status line and, on an empty board, confirms no cell is
  // flagged — the same path every later update takes.
  refreshRuleState();
}
