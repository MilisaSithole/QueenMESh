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
| `loading.test.js` | `?puzzle=` selection, and malformed puzzles failing visibly |
| `rendering.test.js` | Grid/DOM integrity, glyph wiring, the 44px tap-target arithmetic |
| `mutation-check.js` | Breaks the source on purpose and checks the suite notices |

Anything that iterates `PUZZLES` covers new puzzles automatically, so a board
added in Phase 4 is checked for uniqueness, contiguity and correct rendering
without touching the tests.

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
  custom property, but not that it looks right. The tap-target test recomputes
  the sizing arithmetic from CSS constants rather than measuring a real layout,
  and assumes a 412px viewport.
- Nothing here replaces device testing. Touch and S Pen behaviour, tap-target
  comfort, and anything visual still need the phone.
- `mutation-check.js` rewrites source files dozens of times in quick
  succession. Inside a synced folder (OneDrive, Dropbox) that can briefly leave
  the working tree inconsistent, so a suite run immediately afterwards may
  report spurious failures. Re-run it; if failures persist, they are real.
