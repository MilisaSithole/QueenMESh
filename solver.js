// A deliberately limited solver, for rating how hard a puzzle is.
//
// Runs in the browser (hints, Phase 6.3) and in Node (rating, tooling). The
// command line lives in tools/solver.js.
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

const TIER_NAMES = {
  1: 'easy',
  2: 'medium',
  3: 'hard',
  4: 'impossible',
};

/** Highest tier with rules of its own. Tier 4 is a stall, so it needs none. */
const IMPLEMENTED_UP_TO = 3;

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
  return { kind: 'place', row, col, reason: `${describe} has only one legal cell left` };
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

// ---------------------------------------------------------------------------
// Locked sets — Tiers 2 and 3
//
// Every row, every column and every region holds exactly one crown. So if the
// candidates of k groups are confined to exactly k lines of some other kind,
// those k lines are spoken for, and nobody else may use them.
//
// k = 1 is the familiar pointing case: a region whose candidates all sit in one
// row means that row's crown belongs to that region, so the rest of the row
// goes. k >= 2 is the genuinely multi-region case: two regions between them
// confined to two rows consume both rows, even though neither region alone
// pins either row.
//
// Worth stating because the plan gets it wrong: a *single* region confined to
// *two* rows rules out nothing at all. Its crown takes one of the two and
// leaves the other free for anyone. The rule needs k groups over k lines, not
// one group over several.
// ---------------------------------------------------------------------------

const AXES = {
  row: { label: 'row', of: ([row]) => row },
  column: { label: 'column', of: ([, col]) => col },
  region: { label: 'region', of: ([row, col], state) => state.regions[row][col] },
};

/**
 * Groups of one kind, as {id, cells}.
 *
 * No need to filter out groups that already hold a crown: placing one clears
 * every candidate in its row, column and region, so a satisfied group has an
 * empty candidate set, and callers skip empty ones anyway. A separate crown
 * check here would be a second way of saying the same thing, and the kind of
 * redundancy that quietly rots when only one of the two is maintained.
 */
function openGroups(state, axis) {
  const buckets = new Map();
  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      const id = AXES[axis].of([row, col], state);
      if (!buckets.has(id)) buckets.set(id, []);
      buckets.get(id).push([row, col]);
    }
  }
  return [...buckets.entries()].map(([id, cells]) => ({ id, cells }));
}

function* combinations(items, k) {
  if (k === 0) { yield []; return; }
  for (let i = 0; i <= items.length - k; i++) {
    for (const rest of combinations(items.slice(i + 1), k - 1)) {
      yield [items[i], ...rest];
    }
  }
}

/**
 * Find k groups on `axis` whose candidates span exactly k lines of `lineAxis`,
 * and eliminate everyone else from those lines.
 */
function lockedSets(state, axis, lineAxis, k) {
  const groups = openGroups(state, axis).filter((g) => candidatesIn(state, g.cells).length > 0);
  if (groups.length < k) return null;

  for (const chosen of combinations(groups, k)) {
    const lines = new Set();
    const owned = new Set();

    for (const group of chosen) {
      for (const cell of candidatesIn(state, group.cells)) {
        lines.add(AXES[lineAxis].of(cell, state));
        owned.add(cell.join(','));
      }
    }
    if (lines.size !== k) continue;

    const doomed = [];
    for (let row = 0; row < state.size; row++) {
      for (let col = 0; col < state.size; col++) {
        if (!state.candidate[row][col]) continue;
        if (!lines.has(AXES[lineAxis].of([row, col], state))) continue;
        if (owned.has(`${row},${col}`)) continue;
        doomed.push([row, col]);
      }
    }
    if (!doomed.length) continue;

    const names = chosen.map((g) => `${AXES[axis].label} ${g.id}`).join(' and ');
    const lineNames = [...lines].sort((a, b) => a - b).join(', ');
    return {
      kind: 'eliminate',
      cells: doomed,
      reason: `${names} must take ${AXES[lineAxis].label} ${lineNames}, so nothing else can`,
    };
  }
  return null;
}

/** Every ordered pair of different axes — six directions in total. */
const AXIS_PAIRS = [
  ['region', 'row'], ['region', 'column'],
  ['row', 'region'], ['column', 'region'],
  ['row', 'column'], ['column', 'row'],
];

const lockedSetRule = (k) => (state) => {
  for (const [axis, lineAxis] of AXIS_PAIRS) {
    const found = lockedSets(state, axis, lineAxis, k);
    if (found) return found;
  }
  return null;
};

/**
 * A cell that would starve some group if a crown were placed on it.
 *
 * If every remaining candidate of a row, column or region touches cell X, then
 * putting a crown on X would leave that group nowhere legal to go. So X is out.
 * Reads as a one-step contradiction, but it needs no trial: it is a direct
 * observation about a neighbourhood, which is why it sits with Tier 2 rather
 * than with the branching search of Tier 4.
 */
function starvesAGroup(state) {
  // Strictly adjacent: a cell is NOT its own neighbour. Without that exclusion
  // the rule fires whenever a group's candidates are the cell plus its
  // neighbours, and eliminates the one cell that could legitimately have been
  // that group's crown — quietly unsound, and it takes several more deductions
  // before the damage surfaces as a bogus contradiction somewhere else.
  const touches = (a, b) =>
    !(a[0] === b[0] && a[1] === b[1]) &&
    Math.abs(a[0] - b[0]) <= 1 &&
    Math.abs(a[1] - b[1]) <= 1;

  for (const axis of ['row', 'column', 'region']) {
    for (const group of openGroups(state, axis)) {
      const options = candidatesIn(state, group.cells);
      if (!options.length) continue;

      for (let row = 0; row < state.size; row++) {
        for (let col = 0; col < state.size; col++) {
          if (!state.candidate[row][col]) continue;
          if (!options.every((cell) => touches(cell, [row, col]))) continue;
          return {
            kind: 'eliminate',
            cells: [[row, col]],
            reason: `a crown at (${row},${col}) would leave ${AXES[axis].label} ${group.id} nowhere to go`,
          };
        }
      }
    }
  }
  return null;
}

const TIERS = [
  { level: 1, rules: [onlyCellInRow, onlyCellInColumn, onlyCellInRegion] },
  { level: 2, rules: [lockedSetRule(1), starvesAGroup] },
  { level: 3, rules: [lockedSetRule(2), lockedSetRule(3)] },
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

    if (deduction.kind === 'place') {
      place(state, deduction.row, deduction.col);
      log.push({
        tier: tierUsed, kind: 'place',
        row: deduction.row, col: deduction.col, reason: deduction.reason,
      });
    } else {
      // A rule that "eliminates" nothing already ruled out would spin forever,
      // so only genuine removals count as progress.
      const removed = deduction.cells.filter(([r, c]) => eliminate(state, r, c));
      if (!removed.length) break;
      log.push({ tier: tierUsed, kind: 'eliminate', cells: removed, reason: deduction.reason });
    }

    highestTier = Math.max(highestTier, tierUsed);
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
 * The player-facing difficulty bucket for a rating.
 *
 * Not simply the tier name, for a reason Phase 5.2 measured: Tier 1 can never
 * open a board, so "solved using nothing above Tier 1" never happens and an
 * Easy bucket defined that way stays empty forever. Meanwhile Tier 3 swallows
 * most solvable boards, so using it as a single bucket lumps a board needing
 * one multi-region deduction together with one needing several.
 *
 * The split therefore uses *how much* Tier 3 reasoning a board demands, which
 * Phase 5.3 sampled before choosing the boundary. Across 27 solvable generated
 * boards: 7 needed no Tier 3 at all, 15 needed exactly one step, 5 needed two
 * or more. Those are the three bands below, and stalls are the fourth.
 */
function difficultyOf(rating) {
  if (!rating.solved) return rating.tier === 4 ? 'impossible' : null;
  if (rating.tier <= 2) return 'easy';
  return rating.log.filter((step) => step.tier === 3).length >= 2 ? 'hard' : 'medium';
}

/**
 * Count crown arrangements satisfying every rule. Brute force, deliberately —
 * this is the check the tiered solver is *not*, and Tier 4 is defined against
 * it.
 */
function countSolutions(puzzle, stopAt = Infinity) {
  const { size, regions } = puzzle;
  let found = 0;
  const cols = [];
  const usedCol = new Array(size).fill(false);
  const usedRegion = new Set();

  (function place(row) {
    if (found >= stopAt) return;
    if (row === size) { found++; return; }
    for (let col = 0; col < size; col++) {
      if (usedCol[col]) continue;
      if (row > 0 && Math.abs(col - cols[row - 1]) < 2) continue;
      const region = regions[row][col];
      if (usedRegion.has(region)) continue;

      usedCol[col] = true; usedRegion.add(region); cols.push(col);
      place(row + 1);
      cols.pop(); usedRegion.delete(region); usedCol[col] = false;
    }
  })(0);

  return found;
}

/**
 * Rate a puzzle by the highest tier its solve path required.
 *
 * A stall is Tier 4 — "only yields to trial and error" — but only once brute
 * force confirms a unique solution actually exists. Without that check a
 * broken board and a fiendish one are indistinguishable, and the broken one
 * would be filed as merely hard. `tier` stays null in that case, because no
 * difficulty is the honest answer for a puzzle that cannot be solved at all.
 */
function rate(puzzle) {
  const result = solve(puzzle, { maxTier: IMPLEMENTED_UP_TO });

  if (result.solved) {
    return {
      id: puzzle.id, size: puzzle.size, solved: true,
      tier: result.highestTier, label: TIER_NAMES[result.highestTier],
      placed: result.placed, contradiction: null, log: result.log,
    };
  }

  const solutions = countSolutions(puzzle, 2);
  const unique = solutions === 1;

  return {
    id: puzzle.id,
    size: puzzle.size,
    solved: false,
    tier: unique ? 4 : null,
    label: unique
      ? TIER_NAMES[4]
      : `unratable — ${solutions === 0 ? 'no solution' : 'more than one solution'}`,
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
function progressFrom(puzzle, given, { maxTier = IMPLEMENTED_UP_TO } = {}) {
  const result = solve(puzzle, { maxTier, given });
  return { ...result, deduced: result.placed - given.length };
}

// Loaded two ways: as a classic <script> in the browser, where these functions
// simply become globals, and as a CommonJS module by the Node tools and tests.
// The guard is what lets one file serve both without a build step.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createState, place, eliminate, solve, rate, progressFrom, countSolutions, difficultyOf,
    TIERS, TIER_NAMES, IMPLEMENTED_UP_TO,
    rules: {
      onlyCellInRow, onlyCellInColumn, onlyCellInRegion,
      lockedSets, lockedSetRule, starvesAGroup,
    },
   };
}
