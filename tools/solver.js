// A deliberately limited solver, for rating how hard a puzzle is.
//
//   node tools/solver.js              rate every shipped puzzle
//   node tools/solver.js curated-7x7  rate one, with its deduction log
//
// This is not the solver that checks uniqueness. That one is brute force —
// enumerate every arrangement and count. This one is the opposite: it may only
// apply a defined ladder of human deduction rules, in order, and it reports the
// highest rung it needed. Its value comes entirely from what it refuses to do.
//
// The refusal is the whole design. A solver that quietly falls back on search
// rates every puzzle Easy, and that is worse than having no rating at all,
// because the number still looks authoritative.
//
// Phase 5.1 implements Tier 1 only. Tiers 2 and 3 arrive in 5.2; Tier 4 needs
// no rules of its own, being defined as "the ladder stalled while a unique
// solution demonstrably exists".

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const TIER_NAMES = {
  1: 'easy',
  2: 'medium',
  3: 'hard',
  4: 'impossible',
};

/** Highest tier with rules implemented so far. Raised in Phase 5.2. */
const IMPLEMENTED_UP_TO = 1;

// ---------------------------------------------------------------------------
// Candidate model
//
// Everything above Tier 1 reasons about *where a crown could still go*, not
// just where one has been placed, so candidates are the primitive rather than
// placements. A cell is a candidate until something rules it out.
// ---------------------------------------------------------------------------

function createState(puzzle) {
  const { size, regions } = puzzle;
  return {
    size,
    regions,
    candidate: Array.from({ length: size }, () => new Array(size).fill(true)),
    crown: Array.from({ length: size }, () => new Array(size).fill(false)),
    placed: 0,
    contradiction: null,
  };
}

const cellsOfRow = (state, row) =>
  Array.from({ length: state.size }, (_, col) => [row, col]);

const cellsOfColumn = (state, col) =>
  Array.from({ length: state.size }, (_, row) => [row, col]);

function cellsOfRegion(state, id) {
  const cells = [];
  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      if (state.regions[row][col] === id) cells.push([row, col]);
    }
  }
  return cells;
}

const candidatesIn = (state, cells) => cells.filter(([r, c]) => state.candidate[r][c]);
const hasCrown = (state, cells) => cells.some(([r, c]) => state.crown[r][c]);

function eliminate(state, row, col) {
  if (!state.candidate[row][col]) return false;
  state.candidate[row][col] = false;
  return true;
}

/**
 * Place a crown and rule out everything it forbids.
 *
 * Propagation is not a deduction and carries no tier: it is the direct
 * consequence of the rules, the bookkeeping any player does automatically
 * after putting a crown down.
 */
function place(state, row, col) {
  state.crown[row][col] = true;
  state.candidate[row][col] = false;
  state.placed++;

  for (let i = 0; i < state.size; i++) {
    if (i !== col) eliminate(state, row, i);
    if (i !== row) eliminate(state, i, col);
  }

  const region = state.regions[row][col];
  for (const [r, c] of cellsOfRegion(state, region)) {
    if (r !== row || c !== col) eliminate(state, r, c);
  }

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= state.size || c < 0 || c >= state.size) continue;
      if (r === row && c === col) continue;
      eliminate(state, r, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Tier 1 — forced cells
//
// The most mechanical deduction there is: a row, column or region with exactly
// one place left for its crown. No lookahead, no interaction between groups.
// A puzzle that falls out under nothing but these is Easy by definition.
// ---------------------------------------------------------------------------

function forcedInGroup(state, cells, describe) {
  if (hasCrown(state, cells)) return null;
  const options = candidatesIn(state, cells);

  if (options.length === 0) {
    state.contradiction = `${describe} has no legal cell left`;
    return null;
  }
  if (options.length > 1) return null;

  const [row, col] = options[0];
  return { row, col, reason: `${describe} has only one legal cell left` };
}

function onlyCellInRow(state) {
  for (let row = 0; row < state.size; row++) {
    const found = forcedInGroup(state, cellsOfRow(state, row), `row ${row}`);
    if (found) return found;
  }
  return null;
}

function onlyCellInColumn(state) {
  for (let col = 0; col < state.size; col++) {
    const found = forcedInGroup(state, cellsOfColumn(state, col), `column ${col}`);
    if (found) return found;
  }
  return null;
}

function onlyCellInRegion(state) {
  for (let id = 0; id < state.size; id++) {
    const found = forcedInGroup(state, cellsOfRegion(state, id), `region ${id}`);
    if (found) return found;
  }
  return null;
}

const TIERS = [
  { level: 1, rules: [onlyCellInRow, onlyCellInColumn, onlyCellInRegion] },
];

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * Solve as far as the permitted rules allow.
 *
 * After every single deduction the search restarts at Tier 1, so a harder rule
 * is only ever credited when nothing simpler fires. That keeps the reported
 * tier close to the easiest available path rather than whichever rule happened
 * to be tried first.
 *
 * Worth being honest about: this is greedy, not provably minimal. Taking a
 * Tier-2 step early could in principle avoid needing Tier 3 later, and this
 * will not find that. It matches how a person actually solves — reach for the
 * simplest thing that works — which is the property the rating is meant to
 * capture anyway.
 */
function solve(puzzle, { maxTier = IMPLEMENTED_UP_TO, given = [] } = {}) {
  const state = createState(puzzle);
  const log = [];
  let highestTier = 0;

  // Crowns the solver is handed rather than deducing. Phase 6's hint system
  // needs exactly this — "given the board as it stands, what is deducible?" —
  // and it is also the only way to exercise the ladder on a board Tier 1
  // cannot open by itself.
  for (const [row, col] of given) place(state, row, col);

  while (state.placed < state.size && !state.contradiction) {
    let deduction = null;
    let tierUsed = 0;

    for (const tier of TIERS) {
      if (tier.level > maxTier) break;
      for (const rule of tier.rules) {
        deduction = rule(state);
        if (state.contradiction) break;
        if (deduction) { tierUsed = tier.level; break; }
      }
      if (deduction || state.contradiction) break;
    }

    if (state.contradiction || !deduction) break;

    place(state, deduction.row, deduction.col);
    highestTier = Math.max(highestTier, tierUsed);
    log.push({ tier: tierUsed, row: deduction.row, col: deduction.col, reason: deduction.reason });
  }

  return {
    solved: state.placed === state.size && !state.contradiction,
    placed: state.placed,
    highestTier,
    contradiction: state.contradiction,
    log,
    /** solution-shaped: crowns[row] = col, or -1 where nothing was placed. */
    crowns: state.crown.map((row) => row.findIndex(Boolean)),
  };
}

/**
 * Rate a puzzle by the highest tier its solve path required.
 *
 * `tier` is null when the ladder stalls. That is not yet the same as Tier 4 —
 * with only Tier 1 implemented, a stall means "needs something above Tier 1",
 * which could be any of 2, 3 or 4. Reporting null rather than guessing 4 keeps
 * the difference visible until 5.2 fills the ladder in.
 */
function rate(puzzle) {
  const result = solve(puzzle, { maxTier: IMPLEMENTED_UP_TO });
  return {
    id: puzzle.id,
    size: puzzle.size,
    solved: result.solved,
    tier: result.solved ? result.highestTier : null,
    label: result.solved ? TIER_NAMES[result.highestTier] : `beyond tier ${IMPLEMENTED_UP_TO}`,
    placed: result.placed,
    contradiction: result.contradiction,
    log: result.log,
  };
}

/**
 * How far the ladder gets from a partially filled board.
 *
 * Reports how many crowns the given ones unlocked, which is the measure of
 * whether a tier is doing any work at all — a rule that only ever fires when
 * handed the answer is not a rule.
 */
function progressFrom(puzzle, given) {
  const result = solve(puzzle, { maxTier: IMPLEMENTED_UP_TO, given });
  return { ...result, deduced: result.placed - given.length };
}

function loadPuzzles() {
  const source = fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8');
  return new Function(source + '; return PUZZLES;')();
}

module.exports = {
  createState, place, eliminate, solve, rate, progressFrom,
  TIERS, TIER_NAMES, IMPLEMENTED_UP_TO,
  // Exported individually so each can be tested in isolation. Run together
  // they cover for each other: disable the row rule and the region rule
  // quietly finishes the job, so a suite that only drives the whole ladder
  // cannot tell which rules are actually pulling their weight.
  rules: { onlyCellInRow, onlyCellInColumn, onlyCellInRegion },
};

if (require.main === module) {
  const puzzles = loadPuzzles();
  const wanted = process.argv[2];
  const chosen = wanted ? puzzles.filter((p) => p.id === wanted) : puzzles;

  if (!chosen.length) {
    console.error(`no puzzle "${wanted}". Known: ${puzzles.map((p) => p.id).join(', ')}`);
    process.exit(1);
  }

  console.log(`tier ladder implemented up to ${IMPLEMENTED_UP_TO}\n`);
  console.log('id               size  placed  rating           tier-1 bootstrap');
  for (const puzzle of chosen) {
    const r = rate(puzzle);

    // How many crowns Tier 1 has to be *handed* before it can finish the board
    // on its own. A measure of how much of the solve the tier is not doing.
    let bootstrap = 'never finishes';
    for (let given = 0; given <= puzzle.size; given++) {
      const seeded = puzzle.solution.slice(0, given).map((col, row) => [row, col]);
      if (progressFrom(puzzle, seeded).solved) {
        bootstrap = given === 0 ? 'none needed' : `${given} of ${puzzle.size} crowns`;
        break;
      }
    }

    console.log(
      r.id.padEnd(17),
      String(r.size).padEnd(5),
      `${r.placed}/${r.size}`.padEnd(7),
      r.label.padEnd(16),
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
