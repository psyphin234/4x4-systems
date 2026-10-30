# 4x4 Systems Explained

Static page for the PsyPhin site, started 2026-10-30: an **interactive, animated 3D drivetrain** showing how four kinds of 4x4 system (and lockers, an LSD, traction control and low range) share the drive on slippery ground. Same "deep space" look as the other tools (copied from `../Ropes_Recovery`: favicons, `logo.jpg`, `js/circuit.js`, and its `css/style.css` minus the ropes-only section). This page's own styles are the "4x4 Systems Explained" and "the 3D view" blocks at the end of style.css.

Repo `psyphin234/4x4-systems` (public), GitHub Pages from `main` / root, since 2026-10-30. Check builds with `gh api repos/psyphin234/4x4-systems/pages/builds/latest`.

**Address: https://4x4.psyphin.co.za/** since 2026-10-30: the Afrihost CNAME `4x4` → `psyphin234.github.io` (added by the owner), the custom domain set in the repo's Pages settings (GitHub committed the `CNAME` file) and Enforce HTTPS on. The canonical/OG tags already point there. The old test link https://psyphin.co.za/4x4-systems/ still served the page the same day. **Card on psyphin.co.za** (Tools, after Ropes and Shackles) since 2026-10-30, at the owner's request: button "Try the switches", image `assets/img/projects/4x4-systems.jpg` there: this page's 3D scene (part-time 4H, rear locker on, mud / tar / ice / pit under the wheels) rendered by `card.tmp.html?s=<state>` in headless Edge at an 800x700 window, 2x, reduced motion, labels hidden, cropped to 16:9 and scaled to 800x450. Edit the card in that repo's `projects.js`. **Finished (owner, 2026-10-30):** the `.construction` banner and `noindex` removed, `sitemap.xml` and `robots.txt` added, the card's tag green "Actively maintained" (amber "Under construction" before).

## Layout (owner, 2026-10-30)

**PC first**: the animation sits in the **centre** with the controls around it: the 4x4 system and "Under each wheel" (High / Low / Very low / None per wheel, laid out like the wheels) on the left, the slope as three buttons on the 3D picture itself, top right opposite the zoom buttons (under them when the picture is under 760 px wide; owner, 2026-10-30: moved there from the left panel to be more visible): Level 0°, Slope 15°, Steep slope 25° (`slopes` in data.js; owner, 2026-10-30: no slider), the dash switches (transfer lever, CDL, rear/front locker, traction control, low range ratio, 2.7 to 4.0, owner 2026-10-30) and the cautions on the right, the status above and the colour key below (the meters under it were removed, owner, 2026-10-30). Under 1100 px the columns stack (the picture first); phones work but aren't the target. The header is the compact `.brand-bar` (no hologram), so the bench shows near the top of the page.

## The systems and the ground (owner, 2026-10-30)

Four systems, each with its own lever positions (`systems` in data.js; `mode.centre` says what joins the front and rear outputs):
- **Traditional part-time 4x4**: 2H / 4H / 4L; chain drive, 2-4 collar, no centre diff.
- **Torsen / planetary full-time 4x4**: 4H / 4L + CDL switch; planetary centre diff, modelled as a Torsen (bias ratio).
- **Hybrid multi-mode, mechanical centre diff (like Super Select II)**: 2H / 4H / 4HLc / 4LLc; open bevel centre diff, locked in the Lc modes (no separate CDL switch).
- **Hybrid multi-mode, active wet clutch (TOD)**: 2H / 4A / 4H / 4L; in 4A the rear drives and the clutch feeds the front up to its limit; 4H/4L clamp it.

**The ground is kept simple**: high traction (tar texture with lane lines), low traction (brown, a bit rocky: stony texture plus loose 3D rocks rolling back under the vehicle; grip 0.55, rolling resistance 0.08 since 2026-10-30, when the owner asked why the 25° slope could not be climbed on it at all: at 0.30 nothing could. Now level = 2H drives, 15° = needs 4WD, 25° = 4H has the grip but bogs, 4L climbs, and a wheel in the air there also needs a locker), very low traction (ice: pale blue, glossy, cracked; grip 0.10; added 2026-10-30), no traction (empty space: the tile drops into a lit pit). **No "The ground" presets on the page** (owner, 2026-10-30: "Under each wheel" is all it needs); `scenarios` in data.js stay as the starting state and the tests' set-ups. **Suspension**: on low traction each wheel rides up and down over the rocks as it drives (and chatters when spinning); a wheel with no traction hangs 7 cm down on its spring; the beam axle tilts between its two wheels and the coil springs squash and stretch (`suspension()`).

## The 3D view (`js/diagram3d.js`, three.js r149)

The owner asked for a 3D diagram, very detailed on the transfer case and diffs, colour-coded for active/passive drive. three.js **r149** is vendored as `js/vendor/three.min.js` (MIT, licence in `js/vendor/three-LICENSE.txt`): the last line of releases with a classic (non-module) build, so the page still opens from disk with no build step. Don't swap in a CDN module build: module scripts don't load from `file://`.

What's drawn: a bare rolling chassis, kept light (two see-through rails, a crossmember at each end; owner, 2026-10-30) (owner's reference images, 2026-10-30: `outline.jpeg`, a rolling chassis, and `images.jpeg`, a different surface under each wheel and the drivetrain glowing blue; they're press photos, **don't publish them**, gitignored). Ladder frame, coil springs and shocks, see-through engine/gearbox; a see-through transfer case with the high gear, low gear and countershaft, a sliding range collar, the chain to the front output and the system's centre unit (2-4 collar, planetary diff + CDL collar, bevel diff + lock collar, or wet clutch pack + electromagnet); prop shafts with UJs; axle diffs with ring and pinion, carrier, spider and side gears, the locker's dog collar and (rear) LSD clutch packs; see-through axle tubes with the half shafts inside; wheels with tread, rims, brake discs and callipers. The ground is four tiles; "no traction" drops the tile into a lit pit so the tyre hangs free.

**Colour code** (the legend under the view): active = cyan, brighter with more drive; passive = steel blue (turning, no drive); idle = dark grey (still, not connected); locked/engaged = gold; spinning wheel = red; clutch slipping = orange; traction-control brake = amber; gripping wheel's ring = green. Colours follow the model's speeds, not the animation, so they also show under reduced motion.

**Transfer case** (redone 2026-10-30, owner: too many gears, and each system should look like its own): a chain-drive case casting (two round lobes, main shaft on top, front output below, front bell, tail housing). All four share a planetary low range at the front (sun on the input, fixed ring, carrier out; range collar picks sun or carrier; drawn ratio 2.93:1) and the chain at the back; only the piece between differs: part-time 2-4 collar onto the sprocket; Torsen/planetary helical planetary centre diff (carrier from the shaft, sun to the sprocket, ring to the rear, CDL collar); SSII bevel centre diff (carrier from the shaft, back side gear to the sprocket, front one to the inner rear shaft, lock sleeve round the carrier); TOD wet clutch pack in a drum on the sprocket, electromagnet in front. The transfer case sits low (main shaft 0.56 m) and the wheelbase is longer at the back, so the rear prop runs at a gentle angle.

**Mechanics, as drawn** (rebuilt 2026-10-30 after the owner said the gears were wrong): bevel gears are real cones meeting at one apex (`coneGear`): spider and side gears 45 + 45 degrees, ring gear 76 (teeth on its face) and pinion 14 (4:1). The front ring gear is on the left and the rear one on the right, so both props turn the same way. Chain sprocket free on the main shaft. Every speed is worked back from the wheels through these ratios (`stepSpeeds`), so meshing teeth move together. In 2H the front driveline stands still (free-wheeling hubs). **Spin goes on an inner object, orientation on its holder** (`turns()`): with both on one object three.js turns it about the parent's axis (Euler XYZ), which made the half shafts swing round like blades. `film.tmp.html?s=<state>&v=<view>&n=&dt=` renders a filmstrip of frames for checking motion headless (`V.step(dt)`).

**Engine and gearbox** (owner, 2026-10-30: less block-shaped): an inline-four with a tapered see-through block and head, pistons and rods driven by the crank (`moveEngine()`, firing order 1-4 / 2-3 pairs), a rounded rocker cover with ribs, sump, intake plenum and runners on the left, exhaust manifold and down pipe on the right, pulleys and belt at the front; the gearbox is a lathe-turned bellhousing and case with ribs and a gear lever. The crank sits on the gearbox's axis (main shaft height).

**The slope tilts the picture** (owner, 2026-10-30): the ground, rocks, dust and vehicle sit in one group (`world`) that tilts front-up by the slope, easing in. The whole-drivetrain camera stays level so the slope shows; zoomed in on a part, the camera tilts with the vehicle (blending in from 3.2 m to 2 m away), so the close-ups look the same on any slope instead of ending up behind a tyre. Camera targets are points on the vehicle and ride up with it.

Camera: drag to orbit, scroll to zoom, buttons for Whole drivetrain / Transfer case / Front diff / Rear diff (an Engine & gearbox button was added and removed again, owner, 2026-10-30) (views look in from the side, under the frame; the frame, springs and shocks fade when zoomed in). `#view-tcase`, `#view-front`, `#view-rear` in the URL open zoomed in. Labels are HTML tags projected onto the parts; the small part labels show only when zoomed in.

## Figures are illustrative

Unlike the other tools, this page is an **illustration, not a calculator**. The grip, rolling resistance, engine pull, LSD and Torsen bias ratios and the wet clutch's limit in `js/data.js` are round numbers chosen to show the behaviour, and the page says so (under the bench, and in "What this page can't tell you", built from `gaps` in data.js). There's no sources page yet. If the owner wants manufacturer sources, add them under the usual source policy (see `../Ropes_Recovery/CLAUDE.md`).

## The model (`js/calc.js`, pure, tested)

Forces are fractions of the vehicle's weight. Wheels on the ground share the weight evenly; each grips at most `grip × load`. The drivetrain is a tree (centre → front/rear axle diff → wheels). What a split can pass on before a wheel spins: open 2 × the weaker side; locked the sum; LSD/Torsen min(sum, weaker × (1 + bias)); traction control the sum (it brakes the spinning side; it also acts on open and Torsen centres); wet clutch the rear plus up to the clutch's limit to the front; 2H everything to the rear. `solve()` gives `move` (needed ≤ grip and ≤ engine pull), `spin` (not enough grip), or `bog` (not enough engine pull: low range multiplies the pull, never the grip). `suggest()` finds the fewest presses that get it moving (single, then pairs): "Gets it moving" buttons, and the matching dash switches pulse. `normalise()` keeps the nearest lever position when the system changes.

## Structure

```
index.html            The page: bench (left panels, centre 3D view, right dash), "How each one works" cards, explainers, disclaimer
js/data.js            Surfaces, engine pull, low range slider, LSD/Torsen bias, clutch limit, systems and their modes, scenarios, defaults, gaps
js/calc.js            The model: normalise, wheelGrip, needed, splits, capacity, distribute, solve, warnings, toggles, suggest
js/diagram3d.js       The 3D view (draws only): build*, paint (colour code), speeds, camera, labels, loop
js/vendor/three.min.js  three.js r149 (MIT)
js/app.js             State (localStorage key 4x4-systems-v2), building the controls, update()
js/circuit.js         The circuit board behind the page (identical on every PsyPhin site)
tests/                index.html + calc.test.js; run.ps1 runs them in headless Edge
```

## Preview and test

- Open `index.html` from disk.
- Tests: `powershell -ExecutionPolicy Bypass -File tests\run.ps1`.
- `shot.tmp.html?s=<state JSON>&v=<view>` presets localStorage and opens the page (gitignored). Headless Edge needs `--use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL, and runs few animation frames: add `--force-prefers-reduced-motion` so the zoom views jump straight there.
