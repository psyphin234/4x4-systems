/* 4x4 Systems Explained: THE data file. Every figure the model uses lives here.

   The page is an illustration of how a drivetrain shares the engine's pull
   between the wheels; it is not a calculator for a real vehicle. So the grip and
   resistance figures below are ILLUSTRATIVE (round numbers chosen to show the
   behaviour), not measured values, and the page says so wherever they show.
   Forces are fractions of the vehicle's weight: 0.25 = a pull of a quarter of
   its weight. */
window.SYS_DATA = {
  // What each wheel can sit on. grip = friction coefficient under that tyre;
  // roll = rolling resistance (the push needed to keep rolling on the flat).
  // Both illustrative. "air" carries no load, so it has no grip at all.
  surfaces: [
    { id: "tar",    name: "Tar",          grip: 0.80, roll: 0.015, color: "#3a4256", fleck: "#6b7488" },
    { id: "gravel", name: "Gravel",       grip: 0.60, roll: 0.03,  color: "#7a6a52", fleck: "#b8a27c" },
    { id: "rock",   name: "Rock",         grip: 0.70, roll: 0.03,  color: "#5d6270", fleck: "#9aa0ae" },
    { id: "sand",   name: "Soft sand",    grip: 0.45, roll: 0.15,  color: "#c8a35a", fleck: "#ecd08e" },
    { id: "mud",    name: "Mud",          grip: 0.30, roll: 0.10,  color: "#5a3f26", fleck: "#8a6541" },
    { id: "grass",  name: "Wet grass",    grip: 0.25, roll: 0.04,  color: "#2f6b3a", fleck: "#5fa86a" },
    { id: "ice",    name: "Ice",          grip: 0.10, roll: 0.02,  color: "#9fc6e0", fleck: "#e6f4ff" },
    { id: "air",    name: "In the air",   grip: 0,    roll: 0,     color: "#05070f", fleck: "#05070f" }
  ],

  // The engine's pull at the wheels in first gear, high range, as a fraction of
  // the vehicle's weight (illustrative). Low range multiplies it by the ratio.
  engine: { pullHigh: 0.40 },

  // Low range ratio: the visitor's input. Check the figure in your own
  // vehicle's handbook; the default is only a starting point for the slider.
  lowRange: { min: 1.5, max: 4.0, step: 0.1, default: 2.5 },

  // Limited-slip diff: torque bias ratio (the strong side can take this many
  // times what the weak side holds). Illustrative; real LSDs differ widely.
  lsd: { bias: 2.5 },

  // The kinds of system. ranges = the transfer lever's positions.
  systems: [
    { id: "part", name: "Part-time 4x4", short: "Part-time",
      ranges: ["2H", "4H", "4L"], cdl: false, lockers: true,
      blurb: "No centre diff. 2H drives the rear only; 4H and 4L lock the front and rear shafts together." },
    { id: "full", name: "Full-time 4x4", short: "Full-time",
      ranges: ["4H", "4L"], cdl: true, lockers: true,
      blurb: "An open centre diff lets the front and rear shafts turn at different speeds, so it can stay in 4WD on tar. The CDL locks it." },
    { id: "awd", name: "AWD (no low range)", short: "AWD",
      ranges: ["4H"], cdl: false, lockers: false,
      blurb: "Always drives all four wheels through an open centre, with no low range and no lockers. Leans on traction control." }
  ],

  // "Try:" chips. Wheels: fl, fr, rl, rr (front/rear, left/right). slope in degrees.
  scenarios: [
    { id: "mud",   name: "Muddy track",       slope: 5,  wheels: { fl: "mud",    fr: "mud",    rl: "mud",    rr: "mud" },
      note: "Even, low grip everywhere: driving more wheels is what counts." },
    { id: "ice",   name: "One wheel on ice",  slope: 8,  wheels: { fl: "gravel", fr: "gravel", rl: "ice",    rr: "gravel" },
      note: "An open diff sends both wheels the torque the icy one can hold." },
    { id: "lift",  name: "Rear wheel in the air", slope: 10, wheels: { fl: "gravel", fr: "gravel", rl: "air", rr: "gravel" },
      note: "Watch a full-time 4x4 with an open centre: the lifted wheel takes everything." },
    { id: "cross", name: "Cross-axle ditch",  slope: 12, wheels: { fl: "air",    fr: "rock",   rl: "rock",   rr: "air" },
      note: "Two wheels in the air, one on each axle, on opposite corners." },
    { id: "rock",  name: "Steep rocky climb", slope: 27, wheels: { fl: "rock",   fr: "rock",   rl: "rock",   rr: "rock" },
      note: "Plenty of grip, but the engine can't pull this in high range." },
    { id: "sand",  name: "Soft sand dune",    slope: 10, wheels: { fl: "sand",   fr: "sand",   rl: "sand",   rr: "sand" },
      note: "Sand drags at the tyres, so even a gentle dune needs a big pull." },
    { id: "grass", name: "Wet grass climb",   slope: 11, wheels: { fl: "grass",  fr: "grass",  rl: "grass",  rr: "grass" },
      note: "Slippery but even." },
    { id: "tar",   name: "Tar road",          slope: 2,  wheels: { fl: "tar",    fr: "tar",    rl: "tar",    rr: "tar" },
      note: "Everything moves. The question here is what not to engage." }
  ],

  defaults: {
    system: "part", range: "2H", cdl: false, rearLock: false, frontLock: false,
    rearLsd: false, trc: false, scenario: "mud", lowRatio: 2.5
  },

  // What the page can't tell you (shown in "What this page can't tell you").
  gaps: [
    "Grip and resistance figures are illustrative round numbers, not measurements. Real grip changes with tyres, pressures, load, wet and how the surface breaks up.",
    "The load is shared evenly by the wheels on the ground. On a real slope weight moves to the downhill axle, and suspension travel changes what each wheel carries.",
    "The centre diff splits 50:50 here. Many full-time and AWD systems split unevenly or use a clutch coupling instead.",
    "Traction control is shown as able to hold a spinning wheel completely. Real systems differ in how hard and how long they can brake, and some switch off when a locker goes on.",
    "Throttle control, momentum and tyre pressures aren't modelled, and they often matter as much as the drivetrain.",
    "Which switches a real vehicle has, and when its electronics allow them (some lockers only engage in 4L, or below a speed), depends on the make and model: check your handbook."
  ]
};
