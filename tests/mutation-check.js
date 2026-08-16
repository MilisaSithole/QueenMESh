// Checks the tests, not the code.
//
//   node tests/mutation-check.js
//
// Breaks the source on purpose, one defect at a time, and confirms the suite
// notices each one. A test that cannot fail is worse than no test, because it
// reads as coverage. This exists because a boundary test written during
// Phase 1.2 passed happily against genuinely broken code, and because it later
// caught a second real gap: the suite read edge classes off the DOM but never
// checked the CSS turned them into drawn edges.
//
// Add a mutation here whenever you add a test. If a new mutation is not
// caught, that is a coverage hole worth filling before trusting the suite.
//
// Caveat: this rewrites main.js / style.css / puzzles.js in place and restores
// them in a `finally`. If the process is killed mid-run, recover with
// `git checkout -- main.js style.css puzzles.js`.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FILES = ['main.js', 'style.css', 'puzzles.js', 'index.html', 'rules.js'];
const backup = Object.fromEntries(
  FILES.map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')])
);

const mutations = [
  ['style.css', 'grid tracks revert to bare 1fr',
    (s) => s.replace(/minmax\(0, 1fr\)/g, '1fr')],
  ['style.css', 'zeroed edge width loses its unit',
    (s) => s.replace('--edge-r: 0px;', '--edge-r: 0;')],
  ['style.css', 'boundaries drawn one-sided again (b-l/b-t stop drawing)',
    (s) => s.replace(/\.cell\.b-l \{[^}]*\}/, '.cell.b-l { }').replace(/\.cell\.b-t \{[^}]*\}/, '.cell.b-t { }')],
  ['style.css', 'two region fills collide',
    (s) => s.replace('--region-8: #bd5cff;', '--region-8: #6b78ff;')],
  ['style.css', 'a fill drops below the contrast floor',
    (s) => s.replace('--region-3: #6b78ff;', '--region-3: #1b1f4a;')],
  ['style.css', 'glyph stops ignoring pointer input',
    (s) => s.replace('pointer-events: none;', 'pointer-events: auto;')],
  ['main.js', 'drag always marks, never erases',
    (s) => s.replace("paintMode = startState === MARK ? 'erase' : 'mark';", "paintMode = 'mark';")],
  ['main.js', 'drag paints over crowns',
    (s) => s.replace("if (paintMode === 'mark' && state === EMPTY)", "if (paintMode === 'mark' && state !== MARK)")],
  ['main.js', 'drag skips the cell it started on',
    (s) => s.replace('paintCell(gestureStart.row, gestureStart.col);', '')],
  ['main.js', 'pointerup cycles even after a drag',
    (s) => s.replace('if (!hasLeftStartCell) cycleCell(', 'if (true) cycleCell(')],
  ['main.js', 'pointercancel no longer ends the gesture',
    (s) => s.replace(/function onPointerCancel\(event\) \{[\s\S]*?\n\}/, 'function onPointerCancel(event) { }')],
  ['main.js', 'a second pointer can hijack a gesture',
    (s) => s.replace('if (gesturePointerId !== null) return;', '')],
  ['main.js', 'hit-testing reverts to event.target (works on mouse, dead on touch)',
    (s) => s.replace('const el = document.elementFromPoint(event.clientX, event.clientY);', 'const el = event.target;')],
  ['main.js', 'left/top boundary classes never applied',
    (s) => s.replace(/if \(col > 0 && region !== regions\[row\]\[col - 1\]\).*\n.*if \(row > 0 && region !== regions\[row - 1\]\[col\]\).*/, '')],
  ['puzzles.js', 'a region id is altered, adding a second solution',
    (s) => s.replace('[1, 1, 0, 0, 0],', '[1, 0, 0, 0, 0],')],
  ['puzzles.js', 'the declared solution is wrong',
    (s) => s.replace('solution: [2, 0, 3, 1, 4]', 'solution: [2, 0, 3, 4, 1]')],
  // One mutation per board, so the per-puzzle test loops are shown to actually
  // cover every entry rather than only the first. Each was found by searching
  // for a single-cell change with the stated effect — most edits leave a board
  // unique, so picking these by eye does not work.
  ['puzzles.js', 'the 6x6 gains four extra solutions',
    (s) => s.replace('[1, 1, 0, 0, 0, 0],', '[0, 1, 0, 0, 0, 0],')],
  ['puzzles.js', 'the 7x7 gains a second solution',
    (s) => s.replace('[0, 0, 0, 0, 1, 1, 2],', '[1, 0, 0, 0, 1, 1, 2],')],
  ['puzzles.js', 'the 8x8 gains four extra solutions',
    (s) => s.replace('[1, 0, 0, 0, 0, 0, 0, 0],', '[3, 0, 0, 0, 0, 0, 0, 0],')],
  ['puzzles.js', 'the 9x9 gains two extra solutions',
    (s) => s.replace('[0, 0, 0, 2, 2, 2, 2, 1, 1],', '[2, 0, 0, 2, 2, 2, 2, 1, 1],')],
  ['puzzles.js', 'a 9x9 region becomes disconnected',
    (s) => s.replace('[0, 0, 0, 2, 2, 2, 2, 1, 1],', '[1, 0, 0, 2, 2, 2, 2, 1, 1],')],
  ['puzzles.js', 'an 8x8 region becomes disconnected',
    (s) => s.replace('[1, 0, 0, 0, 0, 0, 0, 0],', '[1, 0, 1, 0, 0, 0, 0, 0],')],

  // Phase 2.2 — puzzle selection
  ['main.js', '?puzzle= is ignored and the first board always loads',
    (s) => s.replace('const requested = new URLSearchParams(search || \'\').get(\'puzzle\');', 'const requested = null;')],
  ['main.js', 'an unknown puzzle id falls back silently',
    (s) => s.replace(/notice: `no puzzle[^`]*`,/, 'notice: null,')],
  ['main.js', 'the fallback notice never reaches the status line',
    (s) => s.replace("if (notice) statusEl.dataset.state = 'warning';", '')],

  // Phase 2.2 — rendering integrity
  ['main.js', 'data-region is written from the wrong cell',
    (s) => s.replace('cell.dataset.region = regions[row][col];', 'cell.dataset.region = regions[col][row];')],
  ['main.js', 'the glyph <use> target is never updated',
    (s) => s.replace("if (target) cell.querySelector('use').setAttribute('href', target);", '')],
  ['main.js', 'cells do not start empty',
    (s) => s.replace('cell.dataset.state = STATE_NAMES[EMPTY];', 'cell.dataset.state = STATE_NAMES[MARK];')],
  ['index.html', 'a sprite symbol is renamed out from under main.js',
    (s) => s.replace('id="glyph-mark"', 'id="glyph-cross"')],
  ['index.html', 'the rules.js script tag goes missing',
    (s) => s.replace('  <script src="rules.js"></script>\n', '')],
  ['index.html', 'scripts load in the wrong order',
    (s) => s.replace(
      '  <script src="rules.js"></script>\n  <script src="puzzles.js"></script>\n  <script src="main.js"></script>',
      '  <script src="main.js"></script>\n  <script src="rules.js"></script>\n  <script src="puzzles.js"></script>')],
  // Moves the crown's base bar, which shifts the bounding box. Nudging a point
  // that is not an extreme leaves the box unchanged and proves nothing.
  ['index.html', 'the crown glyph drifts off-centre',
    (s) => s.replace('y="18.25"', 'y="20.25"')],

  // Phase 2.2 — the tap-target invariant
  ['style.css', 'page padding widens until 9x9 cells fall under 44px',
    (s) => s.replace('padding-left: max(0.25rem, env(safe-area-inset-left));', 'padding-left: max(1.5rem, env(safe-area-inset-left));')],
  ['style.css', 'the board no longer runs edge to edge',
    (s) => s.replace('--board-px: min(98vw, 68vh, 34rem);', '--board-px: min(88vw, 68vh, 34rem);')],

  // Phase 3 — the four constraints
  ['rules.js', 'the row constraint stops being checked',
    (s) => s.replace('flagSharedGroups(({ row }) => row, cellsInRow);', '')],
  ['rules.js', 'the column constraint stops being checked',
    (s) => s.replace('flagSharedGroups(({ col }) => col, cellsInColumn);', '')],
  ['rules.js', 'the region constraint stops being checked',
    (s) => s.replace('flagSharedGroups(({ row, col }) => regions[row][col], (id) => byRegion.get(id));', '')],
  ['rules.js', 'adjacency ignores diagonals',
    (s) => s.replace(
      'Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1',
      '(a.row === b.row || a.col === b.col) && Math.abs(a.row - b.row) + Math.abs(a.col - b.col) <= 1')],
  ['rules.js', 'adjacency reaches one cell too far',
    (s) => s.replace(
      'Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1',
      'Math.abs(a.row - b.row) <= 2 && Math.abs(a.col - b.col) <= 2')],
  ['rules.js', 'only the second crown of a clashing pair is flagged',
    (s) => s.replace('for (const { row, col } of group) cells.add(cellKey(row, col));',
      'cells.add(cellKey(group[1].row, group[1].col));')],
  ['rules.js', 'marks count as crowns',
    (s) => s.replace('if (states[row][col] === CROWN) crowns.push({ row, col });',
      'if (states[row][col] !== EMPTY) crowns.push({ row, col });')],
  ['rules.js', 'a win no longer requires a full board',
    (s) => s.replace('crownPositions(states).length === states.length &&', '')],
  ['rules.js', 'a win no longer requires a clean board',
    (s) => s.replace('findViolations(states, regions).cells.size === 0', 'true')],
  ['rules.js', 'findViolations mutates the board it is handed',
    (s) => s.replace('const crowns = crownPositions(states);',
      'const crowns = crownPositions(states); states[0][0] = CROWN;')],

  // Phase 3 — wiring the rules to the board
  ['main.js', 'violations are never cleared once set',
    (s) => s.replace("else delete cell.dataset.violation;", '')],
  ['main.js', 'violations never reach the DOM',
    (s) => s.replace("if (violations.cells.has(key)) cell.dataset.violation = 'cell';",
      "if (false) cell.dataset.violation = 'cell';")],
  ['main.js', 'the solved flag is never cleared',
    (s) => s.replace('else delete boardEl.dataset.solved;', '')],
  ['main.js', 'rule state is not refreshed after a gesture',
    (s) => s.replace(/\n  \/\/ Every gesture ends here[\s\S]*?refreshRuleState\(\);\n/, '\n')],
  ['style.css', 'the violation ring default loses its unit',
    (s) => s.replace('--violation-ring: 0px;', '--violation-ring: 0;')],
  ['style.css', 'flagged cells are no longer dimmed, so red vanishes on yellow',
    (s) => s.replace(/--violation-wash:\s*80%;/, '--violation-wash: 25%;')],
  ['style.css', 'the flagged glyph keeps its normal colour',
    (s) => s.replace(/\.cell\[data-violation="cell"\] \.glyph \{[^}]*\}/, '.cell[data-violation="cell"] .glyph { }')],

  // Phase 3 — whole row/column/region highlighting
  ['rules.js', 'the row scope shrinks to just the clashing crowns',
    (s) => s.replace('flagSharedGroups(({ row }) => row, cellsInRow);',
      'flagSharedGroups(({ row }) => row, () => []);')],
  ['rules.js', 'the column scope shrinks to just the clashing crowns',
    (s) => s.replace('flagSharedGroups(({ col }) => col, cellsInColumn);',
      'flagSharedGroups(({ col }) => col, () => []);')],
  ['rules.js', 'the region scope shrinks to just the clashing crowns',
    (s) => s.replace('flagSharedGroups(({ row, col }) => regions[row][col], (id) => byRegion.get(id));',
      'flagSharedGroups(({ row, col }) => regions[row][col], () => []);')],
  ['rules.js', 'a row highlight bleeds into the column as well',
    (s) => s.replace('flagSharedGroups(({ row }) => row, cellsInRow);',
      'flagSharedGroups(({ row }) => row, (row) => cellsInRow(row).concat(cellsInColumn(row)));')],
  ['rules.js', 'adjacency spreads a scope it should not have',
    (s) => s.replace('  for (const cell of cells) scope.add(cell);',
      '  for (const cell of cells) { scope.add(cell); const [r, c] = cell.split(\',\').map(Number); if (r + 1 < size) scope.add(cellKey(r + 1, c)); }')],
  ['rules.js', 'scope stops including the clashing crowns',
    (s) => s.replace('  for (const cell of cells) scope.add(cell);', '')],
  ['main.js', 'scope cells are never marked',
    (s) => s.replace("else if (violations.scope.has(key)) cell.dataset.violation = 'scope';", '')],
  ['main.js', 'clashing crowns are demoted to plain scope styling',
    (s) => s.replace("if (violations.cells.has(key)) cell.dataset.violation = 'cell';",
      "if (violations.cells.has(key)) cell.dataset.violation = 'scope';")],
  ['style.css', 'the scope tint is too faint to see on crimson',
    (s) => s.replace('--violation-tint-amount: 50%;', '--violation-tint-amount: 12%;')],
  ['style.css', 'the two tiers collapse into the same appearance',
    (s) => s.replace('--violation-tint: #3d0610;', '--violation-tint: #0d0d10;')
             .replace('--violation-tint-amount: 50%;', '--violation-tint-amount: 80%;')],
  ['style.css', 'scope cells lose their styling entirely',
    (s) => s.replace(/\.cell\[data-violation="scope"\] \{[^}]*\}/, '.cell[data-violation="scope"] { }')],
  ['style.css', 'a region rule reverts to the background shorthand, erasing the wash',
    (s) => s.replace('.cell[data-region="0"] { background-color: var(--region-0); }',
      '.cell[data-region="0"] { background: var(--region-0); }')],

  // Phase 4.1 — schema and validation
  ['puzzles.js', 'validation is skipped entirely',
    (s) => s.replace('function describePuzzleProblem(puzzle) {',
      'function describePuzzleProblem(puzzle) {\n  return null;')],
  ['puzzles.js', 'the id is no longer checked',
    (s) => s.replace(/if \(typeof id !== 'string' \|\| !id\.trim\(\)\) \{[\s\S]*?\n  \}/, '')],
  ['puzzles.js', 'the board-size bounds stop being enforced',
    (s) => s.replace(/if \(!Number\.isInteger\(size\) \|\| size < MIN_BOARD_SIZE[\s\S]*?\n  \}/, '')],
  ['puzzles.js', 'unused region ids are allowed through',
    (s) => s.replace(/if \(used\.size !== size\) \{[\s\S]*?\n  \}/, '')],
  ['puzzles.js', 'the solution shape is no longer checked',
    (s) => s.replace('if (solution !== undefined) {', 'if (false) {')],
  ['puzzles.js', 'row length is no longer checked',
    (s) => s.replace('if (!Array.isArray(cells) || cells.length !== size) {',
      'if (!Array.isArray(cells)) {')],
  ['puzzles.js', 'region ids may fall outside the palette',
    (s) => s.replace('if (!Number.isInteger(region) || region < 0 || region >= size) {',
      'if (false) {')],
  ['puzzles.js', 'duplicate puzzle ids are allowed',
    (s) => s.replace("if (typeof id === 'string' && seen.has(id)) return `duplicate puzzle id \"${id}\"`;", '')],
  ['puzzles.js', 'an empty puzzle set is allowed',
    (s) => s.replace("if (!Array.isArray(puzzles) || puzzles.length === 0) return 'no puzzles are defined';", '')],
  ['puzzles.js', 'a shipped puzzle loses its declared solution',
    (s) => s.replace('solution: [2, 0, 3, 1, 4],', '')],
  ['main.js', 'the set-level check is never run',
    (s) => s.replace('describePuzzleSetProblem(PUZZLES) || describePuzzleProblem(puzzle)',
      'describePuzzleProblem(puzzle)')],
  ['main.js', 'a failed puzzle renders anyway',
    (s) => s.replace('if (problem) {', 'if (false) {')],
];

const restore = () => {
  for (const f of FILES) fs.writeFileSync(path.join(ROOT, f), backup[f]);
};

let caught = 0;
const missed = [];

try {
  for (const [file, name, mutate] of mutations) {
    restore();
    const target = path.join(ROOT, file);
    const before = fs.readFileSync(target, 'utf8');
    const after = mutate(before);

    if (after === before) {
      console.log('  SKIP     ' + name + '  (pattern no longer matches — update it)');
      missed.push(name + ' (mutation did not apply)');
      continue;
    }

    fs.writeFileSync(target, after);

    let suiteFailed = false;
    try {
      execFileSync('node', [path.join(ROOT, 'tests', 'run.js')], { stdio: 'pipe' });
    } catch {
      suiteFailed = true;
    }

    if (suiteFailed) { console.log('  caught   ' + name); caught++; }
    else { console.log('  MISSED   ' + name); missed.push(name); }
  }
} finally {
  restore();
}

console.log(`\n${caught}/${mutations.length} defects caught`);
if (missed.length) {
  console.log('\nnot caught:');
  missed.forEach((m) => console.log('  - ' + m));
}
process.exit(missed.length ? 1 : 0);
