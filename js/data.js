/* 4x4 Systems Explained: THE data file. Every figure the model uses lives here.

   The page is an illustration of how a drivetrain shares the engine's pull
   between the wheels; it is not a calculator for a real vehicle. So the grip and
   resistance figures below are ILLUSTRATIVE (round numbers chosen to show the
   behaviour), not measured values, and the page says so wherever they show.
   Forces are fractions of the vehicle's weight: 0.25 = a pull of a quarter of
   its weight. */
window.SYS_DATA = {
  // What each wheel can sit on (owner, 2026-10-30: keep it to three).
  // grip = friction coefficient under that tyre; roll = rolling resistance (the
  // push needed to keep rolling on the flat). Both illustrative. "air" carries
  // no load, so it has no grip at all.
  surfaces: [
    { id: "tar", name: "High traction", short: "Tar", grip: 0.80, roll: 0.015, color: "#3a4256", fleck: "#9aa3b6" },
    { id: "mud", name: "Low traction",  short: "Mud", grip: 0.30, roll: 0.10,  color: "#5a3f26", fleck: "#8a6541" },
    { id: "air", name: "No traction",   short: "In the air", grip: 0, roll: 0, color: "#05070f", fleck: "#05070f" }
  ],

  // The engine's pull at the wheels in first gear, high range, as a fraction of
  // the vehicle's weight (illustrative). Low range multiplies it by the ratio.
  engine: { pullHigh: 0.40 },

  // Low range ratio: the visitor's input. Check the figure in your own
  // vehicle's handbook; the default is only a starting point for the slider.
  lowRange: { min: 1.5, max: 4.0, step: 0.1, default: 2.5 },

  // Limited-slip rear diff: torque bias ratio (the strong side can take this
  // many times what the weak side holds). Illustrative; real LSDs differ widely.
  lsd: { bias: 2.5 },

  // Torsen centre diff: torque bias ratio between the axles. Illustrative.
  torsen: { bias: 3 },

  // Wet-clutch (TOD) transfer case in 4A: the most the clutch passes to the
  // front axle, as a fraction of the weight. Illustrative.
  clutch: { max: 0.25 },

  // The four kinds of system. Each mode is a position of the transfer lever or
  // dial: centre = what joins the front and rear outputs in that mode
  // ("rear" = front not driven, "locked", "open" (bevel diff), "torsen"
  // (torque-sensing planetary diff), "clutch" (wet clutch, on demand));
  // low = low range.
  systems: [
    { id: "part", name: "Traditional part-time 4x4", short: "Part-time",
      box: "chain", cdl: false,
      modes: [
        { id: "2H", label: "2H", centre: "rear" },
        { id: "4H", label: "4H", centre: "locked" },
        { id: "4L", label: "4L", centre: "locked", low: true }
      ],
      blurb: "No centre diff. 2H drives the rear only. 4H and 4L lock the front output to the rear through the chain, so front and rear must turn together." },
    { id: "torsen", name: "Torsen / planetary full-time 4x4", short: "Full-time",
      box: "planetary", cdl: true,
      modes: [
        { id: "4H", label: "4H", centre: "torsen" },
        { id: "4L", label: "4L", centre: "torsen", low: true }
      ],
      blurb: "Always in 4WD. A planetary centre diff lets front and rear turn at different speeds, so it's fine on tar; a Torsen one also biases drive towards the axle with grip, but only up to a ratio. The CDL locks it." },
    { id: "ss2", name: "Hybrid multi-mode (mechanical centre diff, like Super Select II)", short: "Multi-mode SSII",
      box: "bevel", cdl: false,
      modes: [
        { id: "2H", label: "2H", centre: "rear" },
        { id: "4H", label: "4H", centre: "open" },
        { id: "4HLc", label: "4HLc", centre: "locked" },
        { id: "4LLc", label: "4LLc", centre: "locked", low: true }
      ],
      blurb: "2WD or full-time 4WD on one lever. In 4H an open bevel centre diff lets it stay in 4WD on tar; 4HLc and 4LLc lock that diff for loose ground." },
    { id: "tod", name: "Hybrid multi-mode (active wet clutch / TOD)", short: "Multi-mode TOD",
      box: "clutch", cdl: false,
      modes: [
        { id: "2H", label: "2H", centre: "rear" },
        { id: "4A", label: "4A", centre: "clutch" },
        { id: "4H", label: "4H", centre: "locked" },
        { id: "4L", label: "4L", centre: "locked", low: true }
      ],
      blurb: "No centre diff: a computer-controlled wet multi-plate clutch feeds the front. In 4A it drives the rear and clamps the clutch as the rear starts to slip; 4H and 4L clamp it solid." }
  ],

  // "Try:" chips. Wheels: fl, fr, rl, rr (front/rear, left/right). slope in degrees.
  scenarios: [
    { id: "mud",   name: "Muddy track",          slope: 5,  wheels: { fl: "mud", fr: "mud", rl: "mud", rr: "mud" },
      note: "Low traction everywhere: driving more wheels is what counts." },
    { id: "split", name: "One rear wheel in mud", slope: 12, wheels: { fl: "tar", fr: "tar", rl: "mud", rr: "tar" },
      note: "An open diff gives both wheels only what the muddy one can hold." },
    { id: "lift",  name: "Rear wheel in the air", slope: 5, wheels: { fl: "mud", fr: "mud", rl: "air", rr: "mud" },
      note: "Watch the full-time systems: with the centre unlocked, the lifted wheel takes everything." },
    { id: "cross", name: "Cross-axle",            slope: 12, wheels: { fl: "air", fr: "tar", rl: "tar", rr: "air" },
      note: "Two wheels in the air, one on each axle, on opposite corners." },
    { id: "steep", name: "Steep climb",           slope: 27, wheels: { fl: "tar", fr: "tar", rl: "tar", rr: "tar" },
      note: "Plenty of grip, but the engine can't pull this in high range." },
    { id: "tar",   name: "Tar road",              slope: 2,  wheels: { fl: "tar", fr: "tar", rl: "tar", rr: "tar" },
      note: "Everything moves. The question here is what not to engage." }
  ],

  defaults: {
    system: "part", mode: "2H", cdl: false, rearLock: false, frontLock: false,
    rearLsd: false, trc: false, scenario: "mud", lowRatio: 2.5
  },

  // What the page can't tell you (shown in "What this page can't tell you").
  gaps: [
    "Grip and resistance figures are illustrative round numbers, not measurements. Real grip changes with tyres, pressures, load, wet and how the surface breaks up.",
    "The load is shared evenly by the wheels on the ground. On a real slope weight moves to the downhill axle, and suspension travel changes what each wheel carries.",
    "The centre diffs split 50:50 here, and the Torsen's bias ratio and the wet clutch's limit are round numbers. Real systems differ by make and model, and some split unevenly on purpose.",
    "Traction control is shown as able to hold a spinning wheel completely. Real systems differ in how hard and how long they can brake, and some switch off when a locker goes on.",
    "Throttle control, momentum and tyre pressures aren't modelled, and they often matter as much as the drivetrain.",
    "The 3D drawing shows how each kind of part works, not any maker's actual design. Which positions and switches your vehicle has, and when its electronics allow them (some lockers only engage in 4L, or below a speed), depends on the make and model: check your handbook."
  ]
};
