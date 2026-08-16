# QueenMESh — Incremental Implementation Plan

## The rules, restated

An N×N grid (LinkedIn uses 7–10 depending on difficulty) is divided into N colored regions. The player places one crown/queen per row, per column, and per color region, with the added constraint that no two crowns may touch — including diagonally. A valid puzzle has exactly one solution reachable by pure logic (no guessing required), which is what makes generation the hardest part of this project, not the UI.

## Board size range: 6×6 to 9×9

**The shipping range is 6×6 (Easy) up to 9×9 (Impossible). 9×9 is a hard ceiling, and the constraint that sets it is the touch target, not the puzzle logic.**

The S25 Ultra is about 412 CSS px wide in portrait. Against the ~44px minimum tap target (Phase 2), that gives:

| Board | Cell size at 412px wide | Verdict |
| --- | --- | --- |
| 8×8 | ~51px | comfortable |
| 9×9 | **44.20px** (measured) | clears 44px by 0.2px — requires a near-edge-to-edge board |
| 10×10 | ~41px | **below the minimum — does not fit the primary device** |

So 10×10 is out on the primary platform, and 9×9 only works if the board runs nearly edge-to-edge on mobile rather than sitting inside generous page padding. That's a layout constraint to honour from Phase 1, not a Phase 8 adjustment.

**The 9×9 margin is 0.2px, so treat it as a hard budget.** The measured figure accounts for the page padding (0.25rem a side) and the board's own 3px frame eating into the track area, which the original estimate did not. Widening page padding to even 0.5rem, or thickening the frame, drops 9×9 below the minimum. `tests/rendering.test.js` recomputes this from the CSS constants so a regression fails there rather than on the phone — but the arithmetic assumes a 412px viewport, and a narrower phone would not fit 9×9 at all.

Two knock-on effects worth knowing up front:

- **The palette has to stretch to 9, and it is tuned for vividness over colorblind-safety.** Nine distinct fills already exceeds the 8 usable colors in the standard colorblind-safe categorical palette (Okabe-Ito), and the deliberate choice here is high-saturation jewel tones across the full hue wheel rather than a muted safe palette — the game should look striking. Two consequences follow. First, this makes the region-patterns toggle **load-bearing rather than optional**, since saturated hues are *less* separable under red-green color blindness, not more — which is why it ships as a real setting in Phase 6.5 rather than as a Phase 9 accessibility afterthought (see "Settings: theme and region patterns" below). Defining all 9 colors in Phase 1 and keeping a `data-region` attribute on every cell means those patterns attach purely in CSS, with no markup change. Second, the palette is ordered by interleaved hue rather than sequentially, so that any prefix of length N is spread around the wheel — otherwise a 5-region board would draw indices 0–4 and come out as five neighboring warm tones. Keep that property when adding or reordering colors.
- **Size is a *secondary* difficulty lever.** Per the technique-tier section below, difficulty comes from how deep the deduction runs, not from N. A small grid can be brutal and a large one trivial. Size rides along with the tier rating; it never substitutes for it.

## Settings: theme and region patterns

Two player-facing settings, both toggles, both persisted:

- **Theme — System / Light / Dark.** Three states, not two. "System" follows `prefers-color-scheme` and is the default, so the game matches the phone's own day/night behaviour without the player configuring anything; Light and Dark are explicit overrides that stick.
- **Region patterns — on / off.** Overlays a distinct texture (stripes, dots, crosshatch, etc.) on each region *in addition to* its colour, giving a redundant non-colour channel for telling regions apart.

**On naming the second one.** It's tempting to call it "colour-blind mode", but "region patterns" is the more honest label and the better UI string. The setting doesn't detect, simulate, or correct anything about the player's vision — it adds a second visual channel. That framing also makes it obviously useful to players who aren't colour-blind at all (a 9×9 with nine saturated fills is busy for anyone), which raises the odds it actually gets switched on. Keep "colour-blind" in the setting's *description* text for discoverability, not in its label.

**Defaults, and the honest trade-off.** Patterns default to **off**, because the saturated palette is a deliberate aesthetic choice and patterns dilute it. The cost of that default is real: a colour-blind player sees a hard-to-read board until they find the setting. Two cheap mitigations rather than pretending the cost away — put the settings control somewhere immediately visible rather than buried, and once persistence exists (Phase 7), remember the choice permanently so it's a one-time cost. Revisit this default if the game ever gets real players; "patterns on by default" is a defensible alternative.

**Why theme tokens must exist from Phase 1 even though the toggle ships in Phase 6.5.** This is the same argument the plan already makes for the viewport meta tag and for mobile-first layout: retrofitting theming after all the CSS is written is significantly more painful than authoring it that way from the start. Concretely, that means every colour lives as a CSS custom property on `:root` from Phase 1 — no hardcoded hex values scattered through rules — with a `[data-theme="light"]` block overriding the chrome tokens and a `prefers-color-scheme` media query supplying the "System" behaviour. Phase 6.5 then only has to flip an attribute on `<html>`; it never has to go hunting for stray colours. **The app is dark-only today, so authoring a light theme is genuinely net-new design work** — that work belongs in Phase 6.5, but the token structure that makes it a one-file change belongs in Phase 1.

**The gotcha: the contrast floor is theme-dependent.** The nine region fills were chosen against a measured contrast floor (4.86:1) versus the near-black used for grid lines and glyphs. If a light theme also lightens the grid lines and the crown/dot glyphs, that floor silently evaporates and the glyphs become unreadable on the brighter fills. The way to avoid the problem entirely: **keep the region fills, the grid lines, and the glyph colour identical across both themes, and let only the page chrome change** — background, text, panel surfaces, borders. The board is the game's visual identity and reads perfectly well on either chrome; holding it fixed means the measured contrast floor holds in both themes with no second round of colour tuning. Treat a change to grid-line or glyph colour in light mode as a decision that requires re-measuring all nine ratios, not a cosmetic tweak.

## Tech stack: is p5.js the right call?

Short answer: it'll work, but it's not the best fit, and I'd lead with something else.

p5.js is built around a `draw()` loop that redraws the whole canvas every frame — great for animation, physics, particle systems, generative art. Queens is the opposite of that: a static board that changes state only on discrete clicks (empty → X → crown). You can absolutely build it in p5.js by calling `noLoop()` and manually calling `redraw()` on input, but at that point you're fighting the framework's default mental model rather than using it.

Here's how I'd actually rank the options for this specific game:

**1. Plain HTML/CSS Grid + vanilla JS (my pick for the MVP).** Each cell is a `<div>` in a CSS grid. Region color is a CSS class or inline style. Clicks are native DOM events — no manual hit-testing math to map pointer coordinates to grid cells, which p5.js and raw Canvas both require you to write by hand. You get hover states, focus outlines, and keyboard navigation almost for free, which matters if you want the game to be accessible (arrow keys + enter to place a crown is a nice touch LinkedIn's own version supports). Zero dependencies, zero build step — you can open `index.html` directly and it works, and it deploys to GitHub Pages with no configuration at all.

**2. SVG + vanilla JS.** Similar benefits to the DOM approach, plus crisp scaling at any size and easy CSS transitions for the "place crown" animation. Slightly more setup than plain divs for no real gain here, so I'd only reach for it if you want fancy vector icons for the crown/X marks.

**3. Svelte (or another compile-to-vanilla framework).** Worth it once the app grows past "one puzzle" — e.g. once you add a puzzle library, daily-puzzle rotation, stats/streaks, and settings. Svelte compiles away to small vanilla JS/CSS, still deploys as a static bundle to GitHub Pages, and gives you real component structure and state management without the runtime weight of React. I'd only introduce this in a later phase if the vanilla version starts feeling unwieldy.

**4. p5.js.** Reasonable if you specifically want canvas-based polish — a satisfying particle burst when the puzzle is solved, a hand-drawn aesthetic, drag-to-paint interactions — or if you're already comfortable in it and want to move fast. Just budget extra time for input handling (translating pointer events to grid cells yourself) and accessibility (canvas content is invisible to screen readers and keyboard nav by default).

**5. Phaser / PixiJS.** Overkill — these are built for sprite-based action games with physics and asset pipelines. Nothing here needs that.

**Hosting:** GitHub Pages is a good choice regardless of which of the above you pick, since all of them can ship as static HTML/CSS/JS with no server. It's free, has a custom-domain option, and deploys straight from a repo (either the `docs/` folder or a `gh-pages` branch, or via a GitHub Actions workflow if you add a build step for Svelte). Netlify, Vercel, and Cloudflare Pages are equally free and arguably a bit smoother for continuous deployment (auto-deploy previews on every push, no branch juggling) if you ever want that. itch.io is worth knowing about too — it's the go-to free host specifically for browser games and gives you a built-in audience of people looking for exactly this kind of puzzle game, plus optional pay-what-you-want monetization, though it's less natural if you want the repo itself to double as the live site.

**Recommendation:** build the MVP in vanilla HTML/CSS/JS on GitHub Pages. If it grows in scope, migrate the state/rendering logic into Svelte without touching the hosting setup. Reach for p5.js only for a later "juice" pass (win animation, confetti) layered on top, not as the foundation.

**Mobile note:** since you'll mainly be playing this on your phone, this recommendation gets stronger, not weaker. CSS Grid/Flexbox handles fluid resizing and pointer input natively; a canvas-based approach (p5.js or raw Canvas) means hand-rolling hit-testing and manual viewport scaling on top of everything else. Given that, responsiveness shouldn't be a late "Phase 8" bolt-on (as the original draft of this plan had it) — build every screen mobile-first from Phase 1 onward and treat desktop as the secondary layout, since that matches how you'll actually be using it.

**Stylus note (Galaxy S25 Ultra / S Pen):** this is where the earlier decision to build on the **Pointer Events API** (`pointerdown`/`pointerup`, not separate `click` and `touchstart` handlers) pays off directly. Pointer Events already unify mouse, touch, *and* pen into one event model — the S Pen shows up as `event.pointerType === 'pen'`, and everything built for touch (tap-to-cycle state, `touch-action: manipulation`, 44px targets) works with the S Pen with no extra code. The one thing worth knowing: S Pen supports true hover (it can report position before making contact with the glass), which is something finger touch can never do — that's a nice opportunity to give the S Pen a desktop-like ":hover" preview (e.g. highlighting a cell before you commit a tap) as a stylus-specific enhancement later, not a requirement for launch. Palm rejection while holding the pen naturally is handled by Samsung's OS/browser stack, not something you need to build, but it's still worth explicitly testing rather than assuming.

## Incremental build plan

Each phase below should leave you with something that runs in the browser and can be committed/pushed. Don't start a phase until the previous one is playable, and don't consider a phase "done" until its testing checklist passes.

**Phase 0 — Scaffolding & deploy pipeline (~30 min)**
Create the repo, a bare `index.html` + `style.css` + `main.js`, and push it live on GitHub Pages immediately — even with just "Hello Queens" on the page. Getting the deploy loop working first means every later phase is one commit away from being shareable/testable on a real URL instead of just locally.

*Test before moving on:*
- Open the GitHub Pages URL on a desktop browser and confirm the placeholder page renders.
- Open the same URL on the S25 Ultra and confirm it loads — no 404, no mixed-content warnings.
- Edit the placeholder text, push, hard-refresh (bypass cache) on both devices, and confirm the change actually appears — this proves the deploy pipeline itself works before you start depending on it every phase.

**Phase 1 — Static board rendering (mobile-first)**
Hardcode a single small puzzle (say 5×5) as a 2D array of region IDs. Render it as a CSS grid of cells, each colored by its region, sized with relative units (`vmin`/`%`, not fixed pixels) so the whole board scales to fit a phone screen in portrait orientation without scrolling. Set the `viewport` meta tag (`width=device-width, initial-scale=1`) from this phase, not later — retrofitting it after other CSS is written is more painful than starting with it. No interactivity yet — just get the visual grid right, including a border style that makes region boundaries clearly readable (this is the #1 usability detail in the real game).

**5×5 is a scaffolding size, not a shipping size.** It's chosen here only because it's small enough to eyeball the render and hand-solve while testing; the real range is 6×6–9×9 (see "Board size range" below). The practical consequence for this phase is that **nothing may hardcode 5** — the render loop, the CSS grid template, the palette lookup, and the sizing math all read N off the puzzle data. Get that right here and Phase 4 dropping in a 9×9 is a data change, not a code change. Likewise the palette should define all 9 region colors now, even though only 5 are used, so larger boards don't force a palette redesign later.

The same "author it now, expose it later" logic applies to theming: **every color belongs in a CSS custom property on `:root` from this phase**, with no hardcoded hex values scattered through individual rules. The Light/Dark/System toggle doesn't ship until Phase 6.5, but structuring the colors as tokens now is what reduces that phase to adding one override block instead of auditing the whole stylesheet. See "Settings: theme and region patterns" above.

The hardcoded puzzle must be a *genuine* puzzle with a unique solution, not a decorative arrangement of colors — Phase 3's test checklist solves it to verify win detection, so an unsolvable or multi-solution board leaves Phase 3 with nothing to validate against.

*Sub-phases (one commit each):*
- **Phase 1.1 — Puzzle data shape, grid render, palette.** The N-driven scaffolding: puzzle object shaped to anticipate the Phase 4 JSON schema, cells rendered into a CSS grid with `data-row`/`data-col`/`data-region` (which is also what lets Phase 2 use event delegation instead of N² listeners), region colors applied, board sized responsively and kept square. Cell separation is a plain uniform hairline at this point.
- **Phase 1.2 — Region-boundary borders and responsive hardening.** Replace the uniform grid lines with thick borders drawn *only* on edges where a cell's neighbour belongs to a different region, plus the outer frame. This is where the fiddly bugs live — the classic one being adjacent cells each drawing their own edge, giving doubled thickness on some boundaries and single on others — so it's worth isolating in its own diff. Followed by the zoom/orientation/overflow hardening pass.

*Test before moving on:*
- Resize the desktop browser window through several widths and confirm the grid stays square and legible.
- View on the S25 Ultra in both portrait and landscape — the board should fit without horizontal scrolling or overflow.
- Zoom the browser's text/accessibility size up and confirm the layout doesn't break.
- Check the region colors are visually distinguishable from each other at a glance.

**Phase 2 — Tap/click/pen interaction & cell states**
Add per-cell state: empty → X → crown → empty, cycling on tap (this matches LinkedIn's actual interaction model — a first tap marks an X as a note-to-self, a second tap promotes it to a crown). Note the consequence: placing a crown always costs two taps. That's the intended model, not a bug. Dragging across cells paints X marks in bulk rather than cycling them — see "Drag to mark" below. Build this on Pointer Events (`pointerdown`/`pointerup`) rather than separate mouse, touch, and pen handlers, so mouse, finger, and S Pen all drive the exact same code path. Wire up rendering so state changes are reflected immediately. **No rule-checking yet, so any configuration is currently "allowed"** — five crowns in one row will sit there unchallenged until Phase 3. Worth stating plainly so the end state of this phase doesn't read as broken.

*Design decisions settled up front:*

- **The mark is an X, not a dot.** It matches LinkedIn, conventionally reads as "excluded", and stays legible at 45px on a 9×9. A dot is too easily misread as a small crown at a glance.
- **The crown is inline SVG, not the Unicode ♛.** Android emoji-ifies several Unicode chess glyphs, so ♛ would render as a colour emoji on the phone and a flat black glyph on desktop. Given Android is the primary platform, that mismatch is disqualifying — and an emoji crown would also ignore the measured glyph-contrast floor the palette was tuned around. Inline SVG renders identically everywhere and scales cleanly.
- **Both glyphs need `pointer-events: none`** so input always resolves to the cell underneath rather than the glyph sitting on it.
- **The state array outlives this phase.** Keep it a plain 2D array of small ints parallel to `regions`, separate from the puzzle data (state resets; the puzzle doesn't). Phase 3 validates it, Phase 6's undo/redo clones it, and Phase 7 serialises it to `localStorage` — so cheap-to-copy and cheap-to-stringify matters more than an expressive representation.
- **Update the changed cell, don't re-render the board.** A full re-render per tap works but discards hover/focus state and leaves Phase 6's animations nothing stable to animate.

*Drag to mark:* marking cells one tap at a time is tedious, since ruling out a row or a diagonal is the most common thing a player does. So a **drag paints X marks in bulk** — press on a cell, drag across others, release. Rules that make it safe and predictable:

- **Direction is decided once, from the cell the gesture started on.** Starting on an empty cell marks; starting on a marked cell erases. One stroke therefore never both adds and removes marks, which is what makes it feel like a brush rather than a toggle.
- **Crowns are never painted over, in either direction.** A drag is a bulk annotation gesture, and letting it wipe deliberately placed crowns would make it dangerous on a board with work invested in it. A drag that *starts* on a crown paints nothing at all — that gesture is almost certainly a mis-drag.
- **Nothing is applied on `pointerdown`.** Whether a gesture is a tap or a drag is only known when it ends, so acting early would make every drag also cycle its first cell.

*Pointer Events subtleties worth getting right the first time:*

- A gesture that never leaves its starting cell is a **tap** and cycles that cell; one that leaves it is a **drag** and paints. Note this supersedes a plain "press and release on the same cell" rule — under drag semantics, leaving the cell and coming back must *not* also cycle it on release.
- **Hit-test by coordinate (`document.elementFromPoint`), not `event.target`.** Touch implicitly captures the pointer to whatever element received `pointerdown`, so during a touch drag every `pointermove` reports the *starting* cell and nothing else. Reading `event.target` gives a drag that works with a mouse and silently does nothing on the phone.
- Use `setPointerCapture` so a gesture survives the pointer leaving the board mid-drag.
- Track the active `pointerId` and ignore others, so a second finger cannot interleave with a gesture in progress.
- Handle `pointercancel` — the OS steals gestures for palm rejection and system swipes, and a cancelled gesture must not leave a half-applied state or fire a tap on the following `pointerup`.
- Do **not** also listen for `click`. Pointer events already cover it; listening to both fires every interaction twice.
- Use delegated listeners on the board container, reading `data-row`/`data-col` off the cell — those attributes have been on every cell since Phase 1.1 precisely for this.

*Three mobile defences, all of which are easy to forget:*

- **`touch-action: none` on the board — not `manipulation`.** Drag-to-mark needs the `pointermove` stream, and any value that still permits panning lets the browser claim the gesture and scroll the page instead. The board is sized to fit the viewport so nothing there needed to scroll, and this suppresses double-tap-to-zoom too.
- `user-select: none`, so a drag doesn't select content and a long press doesn't raise the Android text-selection popup.
- `-webkit-tap-highlight-color: transparent`, since Android paints a grey flash box on tap that looks bad over the saturated fills.

*One CSS trap specific to this phase:* the board's grid tracks must be `minmax(0, 1fr)`, not `1fr`. A bare `1fr` means `minmax(auto, 1fr)`, so a track's minimum is its content size — the moment a cell gains a glyph, its row refuses to shrink and steals height from the empty rows, leaving a visibly uneven grid. The bug only appears once glyphs exist, which is why it belongs in this phase's notes rather than Phase 1's.

*Tap targets:* at least ~44×44px (Apple/Google's minimum recommended touch target). The binding case is the *largest* board on the *narrowest* screen, not the smallest board — a 9×9 on a 412px-wide phone leaves only ~45px per cell, so this must be verified at 9×9 rather than at the 5×5 scaffolding size, where it passes trivially and tells you nothing. Since the puzzle picker isn't until Phase 4, Phase 2.2 adds a **dev-only 9×9** (a genuine unique-solution board, selectable by URL parameter) purely so this check can actually be run. Deferring it to Phase 4 would mean discovering a fundamental ergonomics problem on the primary device only after two more phases had been built on top of it.

*Deliberately out of scope:* S Pen hover previews stay a Phase 8 enhancement, and keyboard navigation stays in Phase 9. The delegated-listener design keeps both cheap to add later.

*Sub-phases (one commit each):*

- **Phase 2.1 — State model, cycling, glyphs, and the full gesture model.** State array, the three-way cycle, X and crown SVGs, and the tap-versus-drag pointer state machine. The three mobile defences land here too rather than in 2.2 as originally planned: drag-to-mark simply does not function without `touch-action: none` and `user-select: none`, so withholding them would have shipped a feature that only worked on desktop. `pointercancel` handling comes along for the same reason — it is part of the gesture machine, not a hardening pass on top of it.
- **Phase 2.2 — The dev 9×9 and the tap-target gate.** Adds the dev-only 9×9 and its URL-parameter switch, then runs the real-device verification: 44px tap targets at 9×9, rapid-tap correctness, palm rejection, and drag accuracy at the smallest cell size. Smaller than originally scoped, because 2.1 absorbed the gesture work — but this is where every real-device gate is closed, and drag-to-mark at 45px cells is a genuine open question that only hardware can answer.

*Test before moving on:*

- Desktop with a mouse: click through empty → X → crown → empty on every cell, including edges and corners.
- Confirm the crown and X render identically on desktop and on the S25 Ultra — no emoji substitution, no size or weight mismatch.
- S25 Ultra with a finger: tap through the same cycle; confirm no double-tap-zoom triggers and no accidental page scroll near the board edges.
- S25 Ultra with the S Pen specifically: repeat the full cycle using only the stylus, not your finger — this is the first phase where pen input matters, so confirm it explicitly rather than assuming Pointer Events "just work."
- Rest your palm on the screen in a natural writing grip while using the S Pen and confirm no stray taps register.
- Drag across several empty cells and confirm every cell touched — *including the one the drag started on* — ends up marked, and that the cell you released on is marked rather than cycled to a crown.
- Drag starting from an already-marked cell and confirm it erases along the whole path rather than toggling cell by cell.
- Place a crown, then drag straight through it, and confirm the crown survives and the cells either side are marked. Then start a drag *on* the crown and confirm nothing is painted at all.
- Press, drag off the cell, drag back, and release — confirm the cell stays marked and is *not* also cycled to a crown, since that gesture was a drag and not a tap.
- Drag with a finger on the S25 Ultra and confirm the page does not scroll under the gesture. Then repeat with the S Pen.
- Long-press a cell on the phone and confirm no text-selection popup or grey tap-highlight box appears.
- Confirm every row and column is exactly the same size once glyphs are on the board — an uneven grid means the tracks regressed from `minmax(0, 1fr)` back to `1fr`.
- Rapidly tap the same cell several times with each input method and confirm the state cycles cleanly with no double-registered or skipped states.
- Load the dev 9×9 on the S25 Ultra in portrait and confirm every cell is comfortably tappable with both finger and S Pen — this is the check the 5×5 cannot give you.

**Phase 3 — Rule validation & win detection**
Implement the four constraints as pure functions operating on the board state: one crown per row, one per column, one per region, no two crowns adjacent (including diagonally). On every crown placement, check for rule violations and highlight the offending cells in red (this is the real-time feedback that makes the game feel responsive). Add win detection: puzzle is solved when N crowns are placed and all constraints hold.

*Test before moving on:*
- Manually build a few known-invalid boards (two crowns sharing a row, a column, a region, or diagonally touching) and confirm each is flagged correctly.
- Solve the Phase-1 puzzle correctly and confirm the win state fires exactly once N crowns are placed validly — not earlier, not requiring an extra action.
- Try to trigger a win with too few crowns or an invalid layout and confirm it correctly does *not* fire.
- Repeat the invalid/valid checks using the S Pen on the S25 Ultra, not just a mouse — this is the phase where a missed or doubled tap would actually produce a wrong rule-violation flag, so it's worth re-verifying input reliability here specifically.

**Phase 4 — Puzzle data format & multiple puzzles**
Formalize the puzzle representation (grid size + region-ID-per-cell array), move the hardcoded puzzle from Phase 1 into that format, and add 4–5 more puzzles at increasing difficulty. Add a simple puzzle picker/next-puzzle button. At this point you have a genuinely playable game with curated content — a good milestone to share for feedback.

Two carry-overs from earlier phases land here. The Phase 1.1 puzzle object was already shaped to this schema, so moving it should be a file move rather than a rewrite — if it isn't, that's a sign the schema drifted and is worth reconciling now. And the **dev-only 9×9 added in Phase 2.2** for the tap-target check gets promoted into the real puzzle set (or replaced by a better-authored one) and its URL-parameter escape hatch removed in favour of the actual picker.

*Decisions settled up front:*

- **Puzzle data stays a JS object literal in `puzzles.js`, not a `.json` file** — despite the original wording of this phase. `fetch()` is blocked under `file://`, so real JSON would mean the game could no longer be run by opening `index.html`, which is the zero-setup property the tech-stack section chose vanilla JS to get. The file is already shaped exactly like the JSON schema, so nothing is lost but the extension: Phase 5's generator emits this format directly, and Phase 5.5's Python side can read it with a trivial parse if it ever needs to.
- **Uniqueness is verified offline, not at load.** The runtime keeps the cheap structural checks (`describeProblem`) that catch a malformed board. Confirming a puzzle has exactly one solution means enumerating every valid crown arrangement — 47,622 of them at 9×9 — which is wasted work on every page load for data that never changes. The test suite already does this for every entry in `PUZZLES`, so a bad board fails before it can ship rather than being caught by the player's browser.
- **"Hand-authored" is optimistic, and this phase quietly borrows Phase 5's hardest machinery.** Phase 2.2 established that growing regions at random essentially never yields a unique solution above 5×5. Every board added here needs the grow-then-refine loop described in Phase 5. The honest description is generated-then-curated: the generator proposes, a human keeps the ones that look and feel right.
- **Difficulty labels in this phase are guesses.** The technique-tier solver that measures difficulty properly is Phase 5, so anything labelled here is by feel and should be expected to get re-bucketed later. Pulling tier scoring forward would roughly double this phase; better to let Phase 5 correct the labels than to block on them.

*Sub-phases (one commit each):*

- **Phase 4.1 — Schema, loader, loud failure.** Formalise the format and document it in one place, migrate both existing puzzles onto it, and strengthen validation so a malformed board fails visibly. Should be small if the schema has not drifted — and if it has, that discovery is the point.
- **Phase 4.2 — The puzzle set.** Generate, verify and curate 4–5 boards spanning the size range, using the grow-then-refine loop. No new UI. Everything in the test suite that iterates `PUZZLES` covers these automatically, so each new board arrives with uniqueness, contiguity and rendering already checked.
- **Phase 4.3 — Picker and reset.** The first real UI chrome beyond the board, which means it inherits the whole Phase 2 burden: pointer-event handling, ~44px targets, and no reliance on `:hover`. Switching puzzles must fully reset board state — crowns, marks, violation flags and the solved state — and `?puzzle=` retires here in favour of the picker.

*Test before moving on:*
- Load each hand-authored puzzle individually and confirm correct rendering (grid size, region colors) and that you can actually solve it.
- Switch between puzzles via the picker and confirm the board fully resets — no leftover crowns or X marks from the previous puzzle.
- Deliberately break a puzzle (typo a region ID) and confirm it fails loudly/visibly rather than silently rendering a broken board — catching data bugs here saves time once Phase 5's generator is producing puzzles automatically.
- Switch puzzles mid-solve, with crowns placed *and a violation showing*, and confirm the new board arrives completely clean — the violation flags and solved state are separate from cell state and are the easy ones to forget to reset.
- Run the picker through the Phase-2 input check (mouse, finger, S Pen), since it is the first control outside the board and inherits none of the board's testing by default.

**Phase 5 — Puzzle generator**
This is the hard, interesting part, and worth its own phase rather than bolting it onto Phase 4. Approach: (a) generate a random valid solution — N crown positions satisfying row/column/region/adjacency constraints — by backtracking; (b) grow color regions outward from each crown via randomized flood-fill until every cell is assigned a region; (c) get the puzzle to a *unique* solution — see the warning below, because the obvious way does not work; (d) score difficulty using the technique-tier method below, so puzzles can be sorted into buckets rather than hand-labeled by feel.

**Steps (a), (b) and (c) already exist**, in `tools/generate-puzzle.js`. Phase 4.2 could not author boards without them, so it built them early — which makes this phase considerably smaller than it first looks, and centres it almost entirely on (d). Extend that tool rather than starting a second generator beside it.

**Step (d) is a different kind of problem from (c), and the difference is the point.** The uniqueness checker is brute force: enumerate every arrangement and count. The tier solver is the opposite — a deliberately *limited* solver, permitted only a defined ladder of human deduction rules, applied in order, recording the highest rung it needed. Its value comes entirely from what it refuses to do. A solver that quietly falls back on search rates every puzzle Easy and is worse than no solver at all, because the rating looks authoritative.

**Step (c) cannot be "discard and retry", and this is measured, not theoretical.** Authoring the dev 9×9 in Phase 2.2 tried exactly that: grow regions at random, keep the layout only if it admits a single solution. At 9×9 there are **47,622** crown arrangements satisfying row/column/adjacency, and **143,000 random layouts produced zero unique puzzles**. Rejection sampling is hopeless at this size — it works at 5×5 (14 arrangements) purely because the search space is tiny, which makes small-board success actively misleading.

What does work is **grow, then refine**: count the solutions; if there is more than one, pick an unwanted solution, find a row where it disagrees with the intended one, and reassign that cell to a neighbouring region so the unwanted solution now double-books a region. Accept the move only if it reduces the solution count and leaves every region contiguous and still holding exactly one intended crown; repeat. That found a unique 9×9 in **8** grown layouts. The working implementation is in the Phase 2.2 history and is worth porting rather than rediscovering.

Two consequences for this phase: budget for the refinement loop rather than assuming a rejection filter, and expect region *balance* to need its own pass — refined layouts skew toward one large region, so generating several and keeping the most even is worth the extra cycles.

### Deciding difficulty (Easy / Medium / Hard / Impossible)

The robust way to do this — the same approach Sudoku generators use — is to rate a puzzle by *which logical techniques are required to solve it*, not by grid size or by guesswork. Grid size alone is a weak signal: a small grid can be brutal, and a large one can be trivial if it's very constrained. The real driver of perceived difficulty is how deep the deduction has to go before a cell is forced.

Build a second solver alongside the brute-force one used for uniqueness-checking above — a "human-style" solver that only applies a defined ladder of deduction rules, in order, and records the highest rule it ever needed to fire:

- **Tier 1 (Easy).** Purely mechanical eliminations: a region, row, or column has only one legal cell left once adjacency and other placed crowns are accounted for. If the whole puzzle falls out using nothing but repeated Tier-1 passes, it's Easy.

  **Measured in Phase 5.1: Tier 1 cannot open a board at all, and "Easy" as defined here is an empty bucket.** The rule asks whether some group is down to a single legal cell — but on an untouched board nothing has been ruled out, so no group is ever down to one, and the tier has nothing to bite on. It is a *closing* rule, not an opening one. Handing it prefixes of the answer shows how little of the solve it does: the current boards need **2 of 5, 4 of 6, 5 of 7, 5 of 8 and 6 of 9** crowns given before Tier 1 can finish on its own. Every shipped board therefore rates "beyond Tier 1", and none of them is Easy by this definition.

  What actually opens a Queens board is region-confinement reasoning — the rule this plan files under Tier 2. So the ladder as written has its bootstrap on the second rung. **Phase 5.2 must recalibrate the boundaries once Tier 2 exists**, and the honest options are to move single-line confinement (a region occupying exactly one row or column) down into Tier 1, or to accept that the scale effectively starts at Tier 2 and rename the buckets. Deciding that before seeing Tier 2 run on real boards would be guessing; the measurement above is the input to that decision.
- **Tier 2 (Medium).** Requires noticing that a region is entirely confined to one or two rows/columns, which then rules out those rows/columns for every *other* region (the Queens equivalent of Sudoku's "pointing pairs"). Puzzles that need at least one Tier-2 deduction, but nothing beyond it, are Medium.
- **Tier 3 (Hard).** Requires chaining several Tier-1/Tier-2 deductions together, or noticing multi-region interactions where two or three regions mutually constrain each other's rows/columns before anything is forced. Needing Tier-3 reasoning anywhere in the solve path makes it Hard.
- **Tier 4 (Impossible).** The human-style solver gets stuck — no remaining logical rule fires — even though the brute-force solver confirms a unique solution still exists. Reaching the solution requires trial branching: tentatively place a crown, propagate, and see if it leads to a contradiction elsewhere. Puzzles that only yield to this kind of search-and-backtrack get labeled Impossible.

Practically: generate a batch of candidate puzzles, run each through the tiered solver, bucket by the highest tier reached, and keep a handful in reserve for each of the four difficulty levels. A secondary, optional signal worth logging once you have real players: actual solve time and mistake count per puzzle, which lets you sanity-check the tier labels against how people actually experience them and re-bucket anything that's mislabeled.

Grid size is still worth varying as a coarse secondary lever — Easy at 6×6 up to Impossible at 9×9, per the "Board size range" section above (10×10 is ruled out by touch-target width on the primary device) — but it should ride along with the technique-tier rating rather than substitute for it.

*Sub-phases (one commit each):*

- **Phase 5.1 — Tier 1 and the rating harness.** The candidate-set model every later tier builds on, forced-cell propagation, and the scaffolding that runs a board up the ladder and reports the highest tier reached. Useful on its own: it says which boards are genuinely Easy, as opposed to merely small.
- **Phase 5.2 — Tiers 2 and 3.** The real deduction rules — region-confinement ("pointing pairs") and the chained, multi-region interactions above it. Tier 4 needs no code of its own: it is defined by the solver stalling while brute force still reports a unique solution, so it falls out as soon as 1–3 are trustworthy. Expect Tier 3's boundary to need tightening once real puzzles are run through it; the plan's description of it is the vaguest of the four.
- **Phase 5.3 — Batch generation, bucketing and re-labelling.** Generate 20–50 boards, sort them into the four buckets, keep a reserve of each, and **correct the five provisional difficulty labels from Phase 4.2**, which were assigned by grid size and flagged at the time as guesses.

*A caveat on the checklist below:* it asks whether the tier ratings line up with your own sense of how hard the Phase 4 boards were. That comparison only means something once those boards have actually been played — an unplayed board has no intuition to check the solver against, and agreeing with a number you have no independent feel for is not evidence of anything.

*Test before moving on:*
- Generate a batch (20–50) of puzzles and confirm the uniqueness check actually discards puzzles with zero or multiple solutions rather than silently accepting them.
- Manually play through several generated puzzles yourself, on the real site — an automated uniqueness check doesn't guarantee a puzzle "feels" fair or that region shapes aren't degenerate (e.g., a single isolated cell).
- Visually spot-check region shapes for a dozen or so generated puzzles, since flood-fill generation can occasionally produce disconnected or oddly-shaped regions.
- Run the tiered solver against the Phase-4 hand-authored puzzles (where you already know the intended difficulty) and confirm the ratings line up with your own sense of how hard they were.
- Confirm at least one generated puzzle lands in each of the four buckets — if "Impossible" never comes up after many attempts, the tiering thresholds likely need adjusting.

**Phase 5.5 — RL-ready environment (AlphaZero playground)**
This is an optional track that runs in parallel to the phases after it, not before them. **Its real prerequisites are Phase 3 (rules) and Phase 4 (puzzle schema) — not Phase 5, as this section originally said.** The generator is not needed: what the environment has to agree with the web game on is the rules and the puzzle format, and both of those exist as soon as Phase 4 lands. Phase 5 only matters if you want a large training corpus rather than a handful of fixture puzzles, which is a scaling concern rather than a blocker.

Two things make the port cheaper than it looks. `rules.js` was deliberately written pure, DOM-free and with the cell-state constants alongside the constraints, precisely so it could be hand-translated with nothing browser-shaped to unpick. And puzzle data lives in a JS object literal shaped exactly like the JSON schema, so the Python side can read the same file with a trivial parse and stay in lockstep with whatever the site is serving.

The web game and the RL environment never need to talk to each other at runtime; they only need to agree on the same puzzle schema and the same rules, since all training happens locally on your machine rather than against the live site. That's also why no network API is needed here — "API" in this section means a clean importable interface, not an HTTP endpoint.

One framing note worth having going in: AlphaZero itself is built for adversarial two-player self-play. Queens is single-player, so the honest description is "AlphaZero-*style*" — closer to how the same policy-network + value-network + MCTS recipe has been adapted to single-agent combinatorial puzzles (Rubik's Cube-solving systems like DeepCube are the closest precedent). A policy network proposes the next cell to place a crown in, a value network estimates how solvable the resulting position still is, and MCTS uses both to search a few moves ahead before committing. Knowing this up front avoids designing the environment around the wrong shape of algorithm later.

Concretely, this phase adds:

- A standalone Python package (e.g. `env/queenmesh_env/`) with zero dependency on the browser/JS code — the only thing it shares with the web game is the Phase-4 puzzle schema, so a given puzzle is identical on both sides.
- `rules.py` — a direct Python port of the Phase 3 constraint checks (row / column / region / adjacency). The logic is simple enough to hand-translate; keep it pure and side-effect-free so it's cheap to call thousands of times inside an MCTS inner loop and trivial to unit test.
- `env.py` — a Gymnasium-style environment class, so it speaks a convention that existing RL tooling already understands:
  - `reset() -> observation`
  - `legal_actions() -> list[(row, col)]`
  - `step(action) -> (observation, reward, done, info)`
  - `clone() -> QueensEnv` — the one method plain Gym envs don't usually need but MCTS absolutely does, since search explores many hypothetical rollouts without mutating the real game state.
  - `encode() -> np.ndarray` — the board as a fixed-shape tensor for the network (e.g. one channel per region ID, one for placed crowns, one for X-marked cells).
  - `render()` — an ASCII dump for debugging a training run from the terminal.
- A design decision to make early: puzzle size varies by difficulty (6×6 up to 9×9 per the Phase 5 tiers), but a neural net wants a fixed input shape. The low-effort standard answer is to pad every board up to the largest size — 9×9, per the "Board size range" section — and add a mask channel marking real vs. padding cells, so one network can train across all difficulties instead of needing one per size.

Documentation for this layer should be written alongside the code, not bolted on afterward:
- Docstrings on every public method in `env.py` stating the observation shape, the action space, and reward semantics — this is what actually gets read when you come back to this months later.
- A short `docs/rl_environment.md` (or README section) with a five-line quickstart: load a puzzle, instantiate `QueensEnv`, take one random legal action, print the result. One working example is usually enough to unblock plugging in a new algorithm without re-reading the whole module.
- An `examples/` folder with two scripts: a random-action baseline (sanity-checks that the env terminates and rewards behave), and an MCTS/self-play stub that sketches where the policy/value network plugs in without fully implementing it — so starting the real algorithm later is filling in a function body, not designing an interface from scratch.
- A parity test that runs a handful of fixture puzzles through both the JS rules (Phase 3) and `rules.py`, asserting they agree on every legal/illegal move. This matters more than it sounds — any silent divergence means the agent would be training against a subtly different game than the one on the site.

*Test before moving on:*
- Run the parity test suite (Python `rules.py` vs. JS rules) across all fixture puzzles and confirm 100% agreement on legal/illegal moves before trusting any training run.
- Run the random-action baseline script end to end and confirm it terminates (no infinite loop) and reports a sane win/loss rate.
- From a Python REPL, manually call each `env.py` method against one known puzzle and check the outputs against what you'd expect by hand (e.g., `legal_actions()` should shrink exactly as predicted after placing a couple of crowns).

**Phase 6 — Quality-of-life polish**
Timer, mistake counter, undo/redo, a "clear board" button, a hint system (highlight one deducible cell), a subtle win animation, and a difficulty selector (Easy / Medium / Hard / Impossible) that pulls from the difficulty-tagged puzzle pool built in Phase 5. This is also where a p5.js or CSS-animation layer for the win state fits nicely if you want that visual flourish.

*Test before moving on:*
- Timer starts, pauses/resumes, and resets correctly across a full attempt, including backgrounding and returning to the tab.
- Mistake counter increments only on genuine rule violations — not on X-marking, undo, or clearing.
- Undo/redo behaves correctly through a full solve, including at the very start (nothing to undo) and right after a win.
- Request a hint on an unstarted puzzle and confirm it returns a genuinely deducible cell, not a random or unsolvable one.
- Difficulty selector: confirm each of the four options loads a puzzle from the correct tier, not just a random one.
- Re-run the Phase-2 style input check (mouse, finger, S Pen) specifically against the new buttons (clear, undo, hint, difficulty) — new UI controls need the same tap-target and reliability check the board cells got, and it's easy to forget on newly-added buttons.

**Phase 6.5 — Settings panel (theme & region patterns)**
Add the settings surface and the two toggles described in "Settings: theme and region patterns" above. Three pieces of work, in rough order of effort:

- **The light theme.** The app is dark-only up to this point, so this is the real work of the phase: author the `[data-theme="light"]` token block and the `prefers-color-scheme` query behind the "System" option. Per the section above, change only the page chrome — background, text, panel surfaces, borders — and leave the region fills, grid lines, and glyph colour fixed across both themes so the measured contrast floor carries over untouched.
- **The pattern overlay.** Nine distinct textures keyed off the `data-region` attribute already present on every cell since Phase 1.1, so this attaches in CSS with no markup change. Patterns must survive on top of a crown or X glyph without making either ambiguous — that's the detail most likely to need iteration.
- **The panel itself.** A small settings control, reachable in one tap from the board and not buried behind a menu-within-a-menu (per the discoverability mitigation above). Applying a setting flips an attribute on `<html>`; nothing needs a re-render.

Settings persistence rides along with Phase 7's `localStorage` work — if you build 6.5 first, hold the values in memory and wire storage in Phase 7; if you build Phase 7 first, persist settings in the same pass.

*Test before moving on:*

- Toggle through System / Light / Dark and confirm each applies immediately, with no flash of the wrong theme on switching.
- With the setting on "System", change the phone's own light/dark mode and confirm the game follows it live, without a reload.
- Set an explicit Light or Dark override, then change the system theme, and confirm the override *wins* rather than being silently overridden.
- Turn region patterns on with a 9×9 loaded — the size where colour alone is weakest — and confirm all nine regions are distinguishable with the display forced to greyscale.
- With patterns on, place a crown and an X on several differently-patterned regions and confirm both glyphs stay unambiguous against the texture.
- Check the crown/X glyph contrast in *both* themes on all nine region colours; if grid-line or glyph colours ended up differing between themes after all, re-measure the nine ratios rather than trusting the Phase 1 numbers.
- Re-run the Phase-2 input check (mouse, finger, S Pen) against the new settings controls, per the same reasoning as Phase 6's buttons.

**Phase 7 — Daily puzzle & persistence**
Use the current date to deterministically pick/seed a puzzle (same approach as Wordle) so everyone gets the same puzzle on the same day. Use `localStorage` to persist today's progress across page reloads and to track streaks/stats, since there's no backend. This is also where the Phase 6.5 settings (theme choice, region patterns on/off) get persisted — a preference that resets on every visit is worse than no preference at all, and it's the mitigation the patterns-default-off decision depends on.

*Test before moving on:*
- Set a non-default theme and turn patterns on, reload, and confirm both survive — then confirm they still survive after a full browser restart, not just an in-tab reload.
- Reload the page several times and confirm today's puzzle stays the same each time.
- Change your system/dev-tools clock forward a day and confirm a different puzzle loads.
- Close the tab mid-solve, reopen, and confirm placed crowns and X marks are restored correctly from `localStorage`.
- Clear `localStorage` manually and confirm the app degrades gracefully (starts fresh) rather than erroring.
- Specifically test persistence on the S25 Ultra's browser after backgrounding the tab for a while — some Android browsers reclaim memory aggressively, and it's worth confirming your saved progress survives that rather than assuming desktop behavior carries over.

**Phase 8 — Mobile & stylus hardening + PWA pass**
Since responsive, pointer-first layout was built in from Phase 1 rather than left until now, this phase is a hardening pass rather than a rebuild: test thoroughly on your actual S25 Ultra (not just a resized desktop browser window — real touch/pen behavior and real viewport quirks differ), check safe-area insets on the notch/curved edges (`env(safe-area-inset-*)` in CSS) so the board isn't clipped, and confirm nothing relies on `:hover` alone for information the player needs (finger touch has no hover; the S Pen does, so any hover-dependent affordance should degrade gracefully for finger users rather than assuming pen). Since this is your primary platform, it's also worth adding a `manifest.json` and a couple of icon sizes so you can "Add to Home Screen" and get an app-like icon/launch experience instead of a browser tab — a small addition that goes a long way for something you'll open daily.

*Test before moving on:*
- Full playthrough on the S25 Ultra in portrait, finger only.
- Full playthrough on the S25 Ultra in portrait, S Pen only.
- Full playthrough on the S25 Ultra in landscape, both input methods.
- Check the board near the top/bottom/curved edges of the screen for any clipping from safe-area insets.
- Add to Home Screen, launch from the icon, and confirm it opens in standalone/app mode rather than showing a browser URL bar.
- Try to use every feature (not just the board — buttons, difficulty selector, hints) using only tap/pen contact, no mouse, to confirm nothing silently depends on `:hover`.

**Phase 9 — Share results & final deploy polish**
Add a Wordle-style shareable result string (emoji grid or time-to-solve), double check the GitHub Pages deploy is stable, add a basic README, and do a pass on accessibility (keyboard navigation, ARIA labels on cells). The colour-coding side of accessibility is already handled by the Phase 6.5 region-patterns toggle, so what's left here is *verifying* it end to end — that cells announce their region by name and not by colour alone, that the pattern setting is reachable and announced by a screen reader like any other control, and that keyboard navigation reaches it.

*Test before moving on:*
- Generate a share string after a real solve and paste it into Notes/Messages to confirm formatting survives mobile copy-paste (no broken emoji, no stray whitespace).
- Keyboard-only navigation pass on desktop, and a screen-reader pass (TalkBack) on the S25 Ultra, confirming cells announce useful labels.
- Final live-site smoke test: open the actual GitHub Pages URL fresh (not localhost) on both desktop and the S25 Ultra, with the S Pen, and play one full puzzle start to finish.

## Suggested first commit

Phases 0–3 are a good "walking skeleton" to build in one sitting: a single playable puzzle with full rule-checking and win detection, deployed live, and already validated with mouse, finger, and S Pen input. Everything after that (more puzzles, generation, polish, persistence) is additive and can be picked up in any order based on what you're most excited to build next.
