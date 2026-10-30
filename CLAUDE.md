# 4x4 Systems Explained

Static page for the PsyPhin site, started 2026-10-30: an **interactive, animated drivetrain** showing what 2H / 4H / 4L, the centre diff lock (CDL), front and rear lockers, an LSD and traction control each do on slippery ground. Same "deep space" look as the other tools (copied from `../Ropes_Recovery`: favicons, `logo.jpg`, `js/circuit.js`, and its `css/style.css` minus the ropes-only section). This page's own styles are the "4x4 Systems Explained" block at the end of style.css.

**Not live yet.** No repo, no `CNAME`, no psyphin.co.za card. The page carries `noindex` and the amber `.construction` banner. The intended address in the canonical/OG tags is `https://4x4.psyphin.co.za/` (a guess: confirm with the owner before creating the DNS record). Ask before pushing anything live.

## Layout (owner, 2026-10-30)

**PC first**: the animation sits in the **centre** with the controls around it: the vehicle and the ground on the left, the dash switches (transfer lever, CDL, rear/front locker, traction control, low range ratio) and the per-wheel surface boxes on the right, the status above and the meters below. Under 1100 px the columns stack (the picture first); phones work but aren't the target. The header is the compact `.brand-bar` (no hologram), so the bench shows near the top of the page.

**Look of the picture** (owner's reference images, 2026-10-30: `outline.jpeg`, a bare rolling chassis, and `images.jpeg`, a top view with a different surface under each wheel and the drivetrain glowing blue): a top view of a bare chassis (ladder frame, beam axles, coil springs, glowing engine / gearbox / transfer case), front at the top, and the ground split into four quarters, one per wheel. The reference images are press photos: **don't publish them** (gitignored); everything on the page is drawn on the canvas.

## Figures are illustrative

Unlike the other tools, this page is an **illustration, not a calculator**. The grip, rolling resistance, engine pull and LSD bias in `js/data.js` are round numbers chosen to show the behaviour, and the page says so (under the bench, on the canvas, and in "What this page can't tell you", built from `gaps` in data.js). There's no sources page yet. If the owner wants manufacturer sources (handbook wording on 4H on tar, locker use, etc.), add them under the usual source policy (see `../Ropes_Recovery/CLAUDE.md`).

## The model (`js/calc.js`, pure, tested)

Forces are fractions of the vehicle's weight. Wheels on the ground share the weight evenly; each grips at most `grip × load`. The drivetrain is a tree (centre → front/rear axle diff → wheels). What a split can pass on before a wheel spins: open 2 × the weaker side; locked the sum; LSD min(sum, weaker × (1 + bias)); traction control the sum (it brakes the spinning side); 2H everything to the rear. `solve()` gives `move` (needed ≤ grip and ≤ engine pull), `spin` (not enough grip), or `bog` (not enough engine pull: low range multiplies the pull, never the grip). `suggest()` finds the fewest switch presses that get it moving (single, then pairs). Shown as "Gets it moving" buttons, and the matching dash switches pulse.

## Structure

```
index.html       The page: bench (left panels, centre canvas, right dash), "How each one works" cards, explainers, disclaimer
js/data.js       Surfaces, engine pull, low range slider range, LSD bias, systems, scenarios ("The ground"), defaults, gaps
js/calc.js       The model: normalise, wheelGrip, needed, splits, capacity, distribute, solve, warnings, suggest
js/diagram.js    The canvas animation (draws only): quarters of ground, chassis, shafts with flowing light, diffs, wheels, flecks
js/app.js        State (localStorage key 4x4-systems-v1), building the controls, update()
js/circuit.js    The circuit board behind the page (identical on every PsyPhin site)
tests/           index.html + calc.test.js; run.ps1 runs them in headless Edge
```

## Preview and test

- Open `index.html` from disk.
- Tests: `powershell -ExecutionPolicy Bypass -File tests\run.ps1`.
- `shot.tmp.html?s=<state JSON>` presets localStorage and opens the page (handy for headless screenshots of a state; gitignored).
