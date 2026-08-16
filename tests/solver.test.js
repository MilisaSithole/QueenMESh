// Phase 5.1 — the tier-rating solver.
//
// Two things matter here, and only one of them is "does it solve puzzles".
//
// The first is *soundness*: every crown the solver commits to must be correct.
// A solver that places a wrong crown does not produce a slightly-off rating, it
// produces nonsense, and nothing downstream would notice.
//
// The second is *restraint*: a tier must only fire on deductions it is actually
// entitled to make. A solver that quietly reaches for something stronger rates
// everything Easy, which is worse than no rating because the number still looks
// authoritative.

const fs = require('fs');
const path = require('path');
const { suite, test, note, eq, ok } = require('./harness');
const { ROOT } = require('./dom-shim');
const {
  solve, rate, progressFrom, createState, place, eliminate, rules,
} = require('../tools/solver');

const PUZZLES = new Function(
  fs.readFileSync(path.join(ROOT, 'puzzles.js'), 'utf8') + '; return PUZZLES;'
)();

/**
 * A 4x4 built so Tier 1 alone can crack it: region 0 is a single cell, which
 * is forced immediately, and the eliminations cascade from there. Exists to
 * prove the machinery works, since no shipped board exercises it from empty.
 */
const tierOneFixture = {
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

const asPairs = (solution) => solution.map((col, row) => [row, col]);

suite('solver — Tier 1 works, on a board that Tier 1 can open');

test('the fixture is a legitimate puzzle in the first place', () => {
  // Otherwise the tests below prove nothing about a real board.
  const { size, regions, solution } = tierOneFixture;
  eq(new Set(solution).size, size, 'one crown per column');
  eq(new Set(solution.map((col, row) => regions[row][col])).size, size, 'one per region');
  const touching = solution.slice(0, -1).filter((col, row) => Math.abs(col - solution[row + 1]) < 2);
  eq(touching, [], 'no two crowns adjacent');
});

test('Tier 1 solves it from an empty board', () => {
  const result = solve(tierOneFixture, { maxTier: 1 });
  eq(result.solved, true, `only placed ${result.placed}/${tierOneFixture.size}`);
});

test('and places exactly the right crowns', () => {
  eq(solve(tierOneFixture, { maxTier: 1 }).crowns, tierOneFixture.solution);
});

test('it is rated easy, and the log explains every step', () => {
  const rating = rate(tierOneFixture);
  eq(rating.tier, 1);
  eq(rating.label, 'easy');
  eq(rating.log.length, tierOneFixture.size, 'one logged deduction per crown');
  ok(rating.log.every((step) => step.reason), 'every step needs a stated reason');
});

suite('solver — soundness: never place a wrong crown');

for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: every deduced crown matches the real solution`, () => {
    const pairs = asPairs(puzzle.solution);
    const wrong = [];

    // Seed increasing prefixes of the answer. Anything the solver then works
    // out for itself must agree with the solution — at every depth, not just
    // the one where it happens to finish.
    for (let given = 0; given <= puzzle.size; given++) {
      const result = progressFrom(puzzle, pairs.slice(0, given));
      result.crowns.forEach((col, row) => {
        if (col !== -1 && col !== puzzle.solution[row]) {
          wrong.push(`given ${given}: row ${row} got ${col}, expected ${puzzle.solution[row]}`);
        }
      });
      ok(!result.contradiction, `given ${given}: ${result.contradiction}`);
    }

    eq(wrong, []);
  });
}

test('the fixture is sound at every seeding depth too', () => {
  const pairs = asPairs(tierOneFixture.solution);
  for (let given = 0; given <= tierOneFixture.size; given++) {
    const result = progressFrom(tierOneFixture, pairs.slice(0, given));
    result.crowns.forEach((col, row) => {
      if (col !== -1) eq(col, tierOneFixture.solution[row], `given ${given}, row ${row}`);
    });
  }
});

suite('solver — restraint: Tier 1 cannot open a real board');

// Measured, not assumed. Tier 1 asks "does some row, column or region have
// exactly one legal cell left" — and on an untouched board nothing has been
// ruled out, so nothing is ever down to one. This pins the finding: if a later
// change makes Tier 1 open these boards, it has gained a power the tier
// definition does not grant it, and the whole rating scale shifts underneath.
for (const puzzle of PUZZLES) {
  test(`${puzzle.id}: Tier 1 alone deduces nothing from empty`, () => {
    const result = solve(puzzle, { maxTier: 1 });
    eq(result.placed, 0);
    eq(result.solved, false);
  });
}

test('Tier 1 needs most of the answer handed to it before it can finish', () => {
  const costs = PUZZLES.map((puzzle) => {
    const pairs = asPairs(puzzle.solution);
    for (let given = 0; given <= puzzle.size; given++) {
      if (progressFrom(puzzle, pairs.slice(0, given)).solved) {
        return { id: puzzle.id, given, size: puzzle.size };
      }
    }
    return { id: puzzle.id, given: Infinity, size: puzzle.size };
  });

  for (const c of costs) note(`${c.id}: finishes once handed ${c.given}/${c.size}`);
  ok(
    costs.every((c) => c.given > 0),
    'if any board needs zero seeds, Tier 1 has become stronger than its definition'
  );
});

suite('solver — each Tier 1 rule pulls its own weight');

// Driving the whole ladder cannot distinguish these: the three rules cover for
// one another, so disabling any single one still solves the fixture. Each is
// therefore cornered on a board where only it can fire.

const starter = PUZZLES[0];

test('the row rule fires when a row is down to one cell', () => {
  const state = createState(starter);
  for (const col of [0, 1, 3, 4]) eliminate(state, 0, col);

  eq(rules.onlyCellInRow(state), {
    row: 0, col: 2, reason: 'row 0 has only one legal cell left',
  });
  eq(rules.onlyCellInColumn(state), null, 'no column should be forced by this');
  eq(rules.onlyCellInRegion(state), null, 'no region should be forced by this');
});

test('the column rule fires when a column is down to one cell', () => {
  const state = createState(starter);
  for (const row of [0, 1, 3, 4]) eliminate(state, row, 0);

  eq(rules.onlyCellInColumn(state), {
    row: 2, col: 0, reason: 'column 0 has only one legal cell left',
  });
  eq(rules.onlyCellInRow(state), null);
  eq(rules.onlyCellInRegion(state), null);
});

test('the region rule fires when a region is down to one cell', () => {
  const state = createState(starter);
  // Region 2 of the starter board is (1,3) (1,4) (2,3) (3,3).
  for (const [row, col] of [[1, 3], [1, 4], [2, 3]]) eliminate(state, row, col);

  eq(rules.onlyCellInRegion(state), {
    row: 3, col: 3, reason: 'region 2 has only one legal cell left',
  });
  eq(rules.onlyCellInRow(state), null);
  eq(rules.onlyCellInColumn(state), null);
});

test('no rule fires for a group that already holds its crown', () => {
  const state = createState(starter);
  place(state, 0, 2);
  // Row 0 now has one crown and no candidates at all. Treating "no candidates"
  // as forced would try to place a second crown in a finished row.
  eq(rules.onlyCellInRow(state), null);
  eq(state.contradiction, null, 'a satisfied group is not a contradiction');
});

suite('solver — the harness itself');

test('a group with no legal cell left is reported as a contradiction', () => {
  const state = createState(starter);
  for (let col = 0; col < starter.size; col++) eliminate(state, 1, col);

  eq(rules.onlyCellInRow(state), null, 'nothing can be placed');
  ok(state.contradiction, 'the impossible row must be reported');
  ok(/row 1/.test(state.contradiction), state.contradiction);
});

test('an unsolved board is rated null, not zero', () => {
  // Reporting a tier for a board the ladder never cracked would put it in the
  // Easy bucket, which is the most damaging possible mislabel.
  for (const puzzle of PUZZLES) {
    const rating = rate(puzzle);
    eq(rating.solved, false, `${puzzle.id} should not be solvable at tier 1`);
    eq(rating.tier, null, `${puzzle.id} must have no tier, not tier ${rating.tier}`);
  }
  eq(rate(tierOneFixture).tier, 1, 'a board that does solve still gets its tier');
});

test('given crowns are respected and not double-counted', () => {
  const puzzle = PUZZLES[0];
  const result = progressFrom(puzzle, asPairs(puzzle.solution).slice(0, 2));
  eq(result.placed >= 2, true);
  eq(result.deduced, result.placed - 2, 'deduced excludes what was handed over');
});

test('a contradictory board is reported, not silently mis-solved', () => {
  // Two crowns in the same row, forced in as `given`, leaves other groups with
  // no legal cell — the solver must say so rather than carry on.
  const puzzle = PUZZLES[0];
  const result = solve(puzzle, { maxTier: 1, given: [[0, 0], [2, 2], [4, 4]] });
  ok(result.contradiction || !result.solved, 'an impossible board must not report success');
});

test('solving does not mutate the puzzle it is given', () => {
  const puzzle = PUZZLES[0];
  const before = JSON.stringify(puzzle);
  solve(puzzle, { maxTier: 1, given: asPairs(puzzle.solution).slice(0, 3) });
  rate(puzzle);
  eq(JSON.stringify(puzzle), before);
});

test('the same board rates the same way every time', () => {
  const first = rate(tierOneFixture);
  const second = rate(tierOneFixture);
  eq(first.tier, second.tier);
  eq(first.log.map((s) => `${s.row},${s.col}`), second.log.map((s) => `${s.row},${s.col}`));
});

test('placing a crown rules out its row, column, region and neighbours', () => {
  const puzzle = PUZZLES[0];
  const state = createState(puzzle);
  place(state, 2, 2);

  const still = [];
  for (let row = 0; row < puzzle.size; row++) {
    for (let col = 0; col < puzzle.size; col++) {
      if (!state.candidate[row][col]) continue;
      const sameRow = row === 2;
      const sameCol = col === 2;
      const sameRegion = puzzle.regions[row][col] === puzzle.regions[2][2];
      const adjacent = Math.abs(row - 2) <= 1 && Math.abs(col - 2) <= 1;
      if (sameRow || sameCol || sameRegion || adjacent) still.push(`${row},${col}`);
    }
  }
  eq(still, [], 'these cells should all have been eliminated');
});
