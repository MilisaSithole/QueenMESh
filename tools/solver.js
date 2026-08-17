// Command line for solver.js — rates the shipped puzzles.
//
//   node tools/solver.js              rate every shipped puzzle
//   node tools/solver.js curated-7x7  rate one, with its deduction log

const fs = require('fs');
const path = require('path');
const { rate, difficultyOf, progressFrom, IMPLEMENTED_UP_TO } = require('../solver');

const ROOT = path.join(__dirname, '..');

function loadPuzzles() {
  const source = fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8');
  return new Function(source + '; return PUZZLES;')();
}

{
  const puzzles = loadPuzzles();
  const wanted = process.argv[2];
  const chosen = wanted ? puzzles.filter((p) => p.id === wanted) : puzzles;

  if (!chosen.length) {
    console.error(`no puzzle "${wanted}". Known: ${puzzles.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`tier ladder implemented up to ${IMPLEMENTED_UP_TO}\n`);
  console.log('id               size  placed  tier  measured    declared    tier-1 alone needs');
  for (const puzzle of chosen) {
    const r = rate(puzzle);
    const measured = difficultyOf(r);

    // How many crowns Tier 1 has to be *handed* before it can finish on its
    // own. A measure of how much of the solve that tier is not doing.
    let bootstrap = 'never finishes';
    for (let given = 0; given <= puzzle.size; given++) {
      const seeded = puzzle.solution.slice(0, given).map((col, row) => [row, col]);
      if (progressFrom(puzzle, seeded, { maxTier: 1 }).solved) {
        bootstrap = given === 0 ? 'nothing' : `${given} of ${puzzle.size} crowns`;
        break;
      }
    }

    const agrees = measured === puzzle.difficulty;
    console.log(
      r.id.padEnd(17),
      String(r.size).padEnd(5),
      `${r.placed}/${r.size}`.padEnd(7),
      String(r.tier ?? '-').padEnd(5),
      String(measured ?? 'unratable').padEnd(11),
      (puzzle.difficulty + (agrees ? '' : '  <-- MISMATCH')).padEnd(11),
      bootstrap + (r.contradiction ? `  (contradiction: ${r.contradiction})` : '')
    );
  }

  if (wanted) {
    const r = rate(chosen[0]);
    console.log('\ndeduction log:');
    if (!r.log.length) console.log('  (nothing fired — no forced cell anywhere on the empty board)');
    for (const step of r.log) {
      console.log(`  tier ${step.tier}  place (${step.row},${step.col})  — ${step.reason}`);
    }
  }
}
