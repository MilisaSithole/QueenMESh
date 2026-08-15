# Tests

```
node tests/run.js             # run everything
node tests/mutation-check.js  # verify the tests can actually fail
```

No dependencies and no build step, matching the game itself — both commands
work on a clean checkout with nothing but Node installed.

## What's here

| File | Covers |
| --- | --- |
| `harness.js` | Test registry, assertions, pass/fail counting |
| `dom-shim.js` | A hand-rolled DOM just large enough to run the real `main.js` |
| `gestures.test.js` | The tap-versus-drag pointer state machine (Phase 2.1) |
| `boundaries.test.js` | Region-boundary edge classes and corner joins (Phase 1.2) |
| `puzzles.test.js` | Puzzle solvability and structure, palette guarantees, CSS traps |
| `mutation-check.js` | Breaks the source on purpose and checks the suite notices |

## Two principles worth keeping

**Run the real code, not a copy of it.** `dom-shim.js` exists so the tests can
drive the actual `main.js` rather than a reimplementation of its logic. A
reimplementation cheerfully agrees with itself while the shipped file is
broken.

**Every test must be able to fail.** During Phase 1.2 a boundary test passed
against genuinely broken code — it checked whether the boundary network was
connected, but the network is a closed loop, so a notch at one corner still
joined up the long way round. `mutation-check.js` is the guard against
repeating that: it introduces 16 known defects and confirms each one is caught.
Some tests also carry their own negative control inline, asserting that the
defective approach they replaced *does* still measure as broken.

When you add a test, add a matching mutation. If a mutation isn't caught,
that's a coverage hole to fill before trusting the suite.

## Known limits

- CSS is checked by pattern matching, not rendering. There is no layout engine
  here, so these tests can confirm a rule exists and is wired to the right
  custom property, but not that it looks right.
- Nothing here replaces device testing. Touch and S Pen behaviour, tap-target
  comfort, and anything visual still need the phone.
