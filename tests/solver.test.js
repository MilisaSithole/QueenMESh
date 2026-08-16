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
  solve, rate, progressFrom, createState, place, eliminate, rules, countSolutions,
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
      if (progressFrom(puzzle, pairs.slice(0, given), { maxTier: 1 }).solved) {
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
    kind: 'place', row: 0, col: 2, reason: 'row 0 has only one legal cell left',
  });
  eq(rules.onlyCellInColumn(state), null, 'no column should be forced by this');
  eq(rules.onlyCellInRegion(state), null, 'no region should be forced by this');
});

test('the column rule fires when a column is down to one cell', () => {
  const state = createState(starter);
  for (const row of [0, 1, 3, 4]) eliminate(state, row, 0);

  eq(rules.onlyCellInColumn(state), {
    kind: 'place', row: 2, col: 0, reason: 'column 0 has only one legal cell left',
  });
  eq(rules.onlyCellInRow(state), null);
  eq(rules.onlyCellInRegion(state), null);
});

test('the region rule fires when a region is down to one cell', () => {
  const state = createState(starter);
  // Region 2 of the starter board is (1,3) (1,4) (2,3) (3,3).
  for (const [row, col] of [[1, 3], [1, 4], [2, 3]]) eliminate(state, row, col);

  eq(rules.onlyCellInRegion(state), {
    kind: 'place', row: 3, col: 3, reason: 'region 2 has only one legal cell left',
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

suite('solver — Tier 2: locked lines and starved groups');

const sortCells = (cells) => cells.map(([r, c]) => `${r},${c}`).sort();

test('a region confined to one row claims that row', () => {
  const state = createState(starter);
  // Region 0 of the starter is (0,2) (0,3) (0,4) (1,1) (1,2). Drop its two
  // row-1 cells and it can only be in row 0.
  eliminate(state, 1, 1);
  eliminate(state, 1, 2);

  const found = rules.lockedSets(state, 'region', 'row', 1);
  ok(found, 'the rule should fire');
  eq(sortCells(found.cells), ['0,0', '0,1'], 'the rest of row 0 goes');
  ok(/region 0 must take row 0/.test(found.reason), found.reason);
});

test('a region spread over two rows claims nothing on its own', () => {
  // The unsound version of this rule — the one the plan describes — would fire
  // here. One region across two rows leaves the other row free for anyone.
  const state = createState(starter);
  eq(rules.lockedSets(state, 'region', 'row', 1), null);
});

test('a row confined to one region claims that region', () => {
  const state = createState(starter);
  // Row 0 is regions 1,1,0,0,0. Remove the region-0 cells and row 0 lies
  // entirely inside region 1.
  for (const col of [2, 3, 4]) eliminate(state, 0, col);

  const found = rules.lockedSets(state, 'row', 'region', 1);
  ok(found, 'the rule should fire');
  eq(sortCells(found.cells), ['1,0', '2,0'], 'region 1 loses its cells outside row 0');
});

test('a cell that would starve a group is eliminated', () => {
  const state = createState(starter);
  // Region 1 is (0,0) (0,1) (1,0) (2,0). Every one of those touches (1,1),
  // so a crown at (1,1) would leave region 1 nowhere legal.
  const found = rules.starvesAGroup(state);
  ok(found, 'the rule should fire on the untouched starter board');
  eq(found.cells.length, 1);
  ok(/nowhere to go/.test(found.reason), found.reason);
});

test('a group is never starved by one of its own cells', () => {
  // The unsound version treated a cell as adjacent to itself, so a group whose
  // candidates were one cell plus its neighbours would eliminate that very
  // cell — the one place its crown could legitimately go.
  const state = createState(starter);
  const found = rules.starvesAGroup(state);
  const [row, col] = found.cells[0];
  const regionOfVictim = starter.regions[row][col];

  // Whichever group justified the elimination, the victim must not belong to
  // a group whose entire candidate set it was part of.
  ok(
    !/region /.test(found.reason) || !found.reason.includes(`region ${regionOfVictim}`),
    `a cell was eliminated to protect its own region: ${found.reason}`
  );
});

suite('solver — Tier 3: multi-group locked sets');

test('two regions confined to two rows claim both rows', () => {
  const state = createState(starter);
  // Squeeze regions 0 and 1 into rows 0 and 1 between them.
  eliminate(state, 2, 0); // region 1's only row-2 cell

  const found = rules.lockedSets(state, 'region', 'row', 2);
  ok(found, 'two regions over two rows should claim them');
  ok(found.cells.length > 0);
  ok(/and/.test(found.reason), `reason should name both regions: ${found.reason}`);
});

test('k=2 does not fire when the two groups span three lines', () => {
  const state = createState(starter);
  // Untouched, regions 0 and 1 span rows 0,1,2 between them — three lines for
  // two regions claims nothing.
  const found = rules.lockedSets(state, 'region', 'row', 2);
  if (found) {
    ok(!/region 0 and region 1 must take row/.test(found.reason), found.reason);
  }
});

suite('solver — the ladder actually uses every rung');

// Testing the rules directly proves they work, not that they are wired in.
// Drop a whole tier from TIERS and every direct rule test still passes.

test('a real solve draws on Tier 1, Tier 2 and Tier 3', () => {
  const solvable = PUZZLES.map(rate).find((r) => r.solved);
  ok(solvable, 'no board is solvable by the ladder, so this cannot be checked');

  const tiersUsed = new Set(solvable.log.map((step) => step.tier));
  for (const tier of [1, 2, 3]) {
    ok(tiersUsed.has(tier), `${solvable.id} never used tier ${tier}: saw ${[...tiersUsed]}`);
  }
});

test('Tier 2 contributes both of its rules on real boards', () => {
  const reasons = PUZZLES.flatMap((p) => rate(p).log)
    .filter((step) => step.tier === 2)
    .map((step) => step.reason);

  ok(reasons.some((r) => /must take/.test(r)), 'no locked-set deduction fired anywhere');
  ok(reasons.some((r) => /nowhere to go/.test(r)), 'no starvation deduction fired anywhere');
});

test('Tier 3 contributes multi-group deductions on real boards', () => {
  const tierThree = PUZZLES.flatMap((p) => rate(p).log).filter((step) => step.tier === 3);
  ok(tierThree.length > 0, 'Tier 3 never fires, so it cannot be justifying any rating');
  ok(
    tierThree.some((step) => / and /.test(step.reason)),
    `Tier 3 should name several groups: ${tierThree.map((s) => s.reason)[0]}`
  );
});

suite('solver — the harness itself');

test('a group with no legal cell left is reported as a contradiction', () => {
  const state = createState(starter);
  for (let col = 0; col < starter.size; col++) eliminate(state, 1, col);

  eq(rules.onlyCellInRow(state), null, 'nothing can be placed');
  ok(state.contradiction, 'the impossible row must be reported');
  ok(/row 1/.test(state.contradiction), state.contradiction);
});

suite('solver — Tier 4 and brute force');

test('brute force finds exactly one solution for every shipped puzzle', () => {
  // Also the guard on countSolutions itself: drop the region constraint or the
  // adjacency constraint and these counts jump above one immediately.
  for (const puzzle of PUZZLES) {
    eq(countSolutions(puzzle), 1, `${puzzle.id}`);
  }
  eq(countSolutions(tierOneFixture), 1, 'fixture');
});

test('brute force counts more than one when a board really has more', () => {
  // Verified single-cell change: takes the starter from one solution to two.
  const loosened = {
    ...PUZZLES[0],
    regions: PUZZLES[0].regions.map((row, r) => (r === 0 ? [1, 0, 0, 0, 0] : [...row])),
  };
  ok(countSolutions(loosened) > 1, 'expected the loosened board to admit several');
});

test('a stalled board with a unique solution is Tier 4, not unrated', () => {
  const stalled = PUZZLES.map(rate).filter((r) => !r.solved);
  ok(stalled.length > 0, 'expected at least one board the ladder cannot finish');
  for (const rating of stalled) {
    eq(rating.tier, 4, `${rating.id} stalled, so it should be impossible`);
    eq(rating.label, 'impossible');
  }
});

test('a board with several solutions is unratable, not merely impossible', () => {
  // The distinction matters: "impossible" is a difficulty, and filing a broken
  // board under it would ship it to a player as a fiendish puzzle.
  const loosened = {
    ...PUZZLES[0],
    id: 'loosened',
    regions: PUZZLES[0].regions.map((row, r) => (r === 0 ? [1, 0, 0, 0, 0] : [...row])),
  };
  const rating = rate(loosened);
  eq(rating.tier, null);
  ok(/unratable/.test(rating.label), rating.label);
});

test('a solved board reports the rung it actually needed', () => {
  const solved = PUZZLES.map(rate).filter((r) => r.solved);
  for (const rating of solved) {
    ok(rating.tier >= 1 && rating.tier <= 3, `${rating.id} rated ${rating.tier}`);
    eq(rating.label, ['', 'easy', 'medium', 'hard'][rating.tier]);
  }
  eq(rate(tierOneFixture).tier, 1, 'the Tier 1 fixture still rates easy');
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
