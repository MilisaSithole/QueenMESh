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
const FILES = ['main.js', 'style.css', 'puzzles.js'];
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
