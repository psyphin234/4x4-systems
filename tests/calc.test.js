/*
 * Tests for data.js and calc.js. Runs in the browser via tests/index.html
 * (open it, or run tests/run.ps1 for a headless run).
 */
(function () {
  "use strict";

  const D = window.SYS_DATA;
  const C = window.SYS_CALC;
  const results = [];
  window.addEventListener("error", (e) => {
    document.getElementById("summary").textContent = "FAILED: script error: " + e.message;
  });

  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, error: e.message });
    }
  }

  function eq(actual, expected, what) {
    if (actual !== expected) throw new Error(`${what || "value"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }

  function near(actual, expected, tol, what) {
    if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${what || "value"}: expected ${expected} ± ${tol}, got ${actual}`);
  }

  const scenario = (id) => D.scenarios.find((s) => s.id === id);
  function st(id, over) {
    const sc = scenario(id);
    return Object.assign({}, D.defaults, { surfaces: Object.assign({}, sc.wheels), slope: sc.slope }, over || {});
  }
  const status = (id, over) => C.solve(st(id, over)).status;

  // ------------------------------------------------------------ data integrity
  test("scenarios use known surfaces and every wheel", () => {
    D.scenarios.forEach((sc) => C.WHEELS.forEach((w) => {
      if (!D.surfaces.some((s) => s.id === sc.wheels[w])) throw new Error(sc.id + " " + w);
    }));
  });

  test("defaults are a valid state; every system has modes", () => {
    eq(!!scenario(D.defaults.scenario), true, "default scenario");
    eq(C.system(D.defaults.system).modes.some((m) => m.id === D.defaults.mode), true, "default mode");
    D.systems.forEach((sys) => eq(sys.modes.length >= 2, true, sys.id + " modes"));
  });

  // ------------------------------------------------------------ the splits
  const leaf = (id, grip) => ({ type: "wheel", id: id, grip: grip });
  test("open diff passes twice the weaker side", () => {
    const t = { type: "open", a: leaf("fl", 0.05), b: leaf("fr", 0.3) };
    near(C.capacity(t), 0.1, 1e-9, "capacity");
    const out = {};
    near(C.distribute(t, 0.4, out), 0.1, 1e-9, "ground");
    eq(out.fl.slip, true, "weak side spins");
    eq(out.fr.slip, false, "strong side holds");
    near(out.fr.force, 0.05, 1e-9, "strong side gets what the weak side holds");
  });

  test("locked diff passes the sum", () => {
    const t = { type: "locked", a: leaf("fl", 0), b: leaf("fr", 0.3) };
    near(C.capacity(t), 0.3, 1e-9, "capacity");
    const out = {};
    C.distribute(t, 0.2, out);
    near(out.fr.force, 0.2, 1e-9, "all to the gripping side");
    eq(out.fr.slip, false, "no slip under capacity");
  });

  test("LSD and Torsen: the strong side takes up to bias × the weak side", () => {
    const t = { type: "lsd", a: leaf("rl", 0.05), b: leaf("rr", 0.3) };
    near(C.capacity(t), 0.05 * (1 + D.lsd.bias), 1e-9, "LSD capacity");
    const out = {};
    C.distribute(t, 0.15, out);
    eq(out.rl.slip || out.rr.slip, false, "under capacity nothing spins");
    const ts = { type: "torsen", a: leaf("fl", 0.05), b: leaf("rl", 0.5) };
    near(C.capacity(ts), 0.05 * (1 + D.torsen.bias), 1e-9, "Torsen capacity");
    eq(C.capacity({ type: "torsen", a: leaf("fl", 0), b: leaf("rl", 0.3) }), 0, "nothing to bias against a lifted end");
  });

  test("wet clutch: rear first, the front tops up to the clutch's limit", () => {
    const t = { type: "clutch", a: leaf("fl", 0.4), b: leaf("rl", 0.1) };
    near(C.capacity(t), 0.1 + D.clutch.max, 1e-9, "capacity");
    let out = {};
    C.distribute(t, 0.08, out);
    eq(out.fl.force, 0, "front idle while the rear holds");
    eq(out._splits.centre === undefined, true, "split recorded by id only");
    out = {};
    C.distribute(Object.assign({ id: "centre" }, t), 0.2, out);
    near(out.fl.force, 0.1, 1e-9, "front takes the rest");
    eq(out._splits.centre.clutch, "slip", "clutch slipping");
  });

  test("traction control brakes the weak side and drives the other", () => {
    const t = { type: "tc", a: leaf("rl", 0), b: leaf("rr", 0.3) };
    const out = {};
    C.distribute(t, 0.2, out, false);
    eq(out.rl.braked, true, "lifted wheel braked");
    near(out.rr.force, 0.2, 1e-9, "drive goes across");
  });

  test("load is shared by the wheels on the ground", () => {
    const w = C.wheelGrip({ fl: "air", fr: "tar", rl: "tar", rr: "air" });
    near(w.fr.load, 0.5, 1e-9, "load");
    near(w.fr.grip, 0.4, 1e-9, "grip");
    eq(w.fl.grip, 0, "air has no grip");
  });

  // ------------------------------------------------------------ the systems behave as they should
  test("muddy track: 2H spins, every 4WD mode drives", () => {
    eq(status("mud"), "spin", "part-time 2H");
    eq(status("mud", { mode: "4H" }), "move", "part-time 4H");
    eq(status("mud", { system: "torsen", mode: "4H" }), "move", "Torsen");
    eq(status("mud", { system: "ss2", mode: "4H" }), "move", "SSII 4H");
    eq(status("mud", { system: "tod", mode: "4A" }), "move", "TOD 4A");
  });

  test("rear wheel in the air: unlocked centres take nothing; locked or clutch drives", () => {
    eq(status("lift", { system: "torsen", mode: "4H" }), "spin", "Torsen");
    eq(status("lift", { system: "torsen", mode: "4H", cdl: true }), "move", "Torsen + CDL");
    eq(status("lift", { system: "ss2", mode: "4H" }), "spin", "SSII 4H");
    eq(status("lift", { system: "ss2", mode: "4HLc" }), "move", "SSII 4HLc");
    eq(status("lift", { system: "tod", mode: "4A" }), "move", "TOD 4A");
    eq(status("lift", { mode: "4H" }), "move", "part-time 4H");
    eq(status("lift"), "spin", "2H");
  });

  test("cross-axle: a locked centre alone isn't enough", () => {
    eq(status("cross", { mode: "4H" }), "spin", "part-time 4H");
    eq(status("cross", { mode: "4H", rearLock: true }), "move", "4H + rear locker");
    eq(status("cross", { system: "torsen", mode: "4H", cdl: true }), "spin", "CDL only");
    eq(status("cross", { system: "torsen", mode: "4H", cdl: true, rearLock: true }), "move", "CDL + rear locker");
    eq(status("cross", { system: "torsen", mode: "4H", trc: true }), "move", "traction control");
  });

  test("steep climb: high range bogs, low range climbs", () => {
    eq(status("steep", { mode: "4H" }), "bog", "4H");
    eq(status("steep", { mode: "4L" }), "move", "4L");
    eq(status("steep", { system: "ss2", mode: "4LLc" }), "move", "SSII 4LLc");
  });

  test("low range adds pull, not grip", () => {
    const hi = C.solve(st("mud", { mode: "4H" })), lo = C.solve(st("mud", { mode: "4L" }));
    near(lo.pull, hi.pull * D.defaults.lowRatio, 1e-9, "pull");
    near(lo.grip, hi.grip, 1e-9, "grip unchanged");
  });

  test("switching systems keeps the nearest lever position", () => {
    eq(C.normalise({ system: "torsen", mode: "2H" }).mode, "4H", "no 2H on full-time");
    eq(C.normalise({ system: "ss2", mode: "4L" }).mode, "4LLc", "low stays low");
    eq(C.normalise({ system: "tod", mode: "4LLc" }).mode, "4L", "low stays low");
    eq(C.normalise({ system: "part", mode: "4A" }).mode, "4H", "4A to 4H");
    eq(C.normalise({ system: "part", mode: "2H", cdl: true }).cdl, false, "no CDL on part-time");
  });

  test("tar: a locked centre warns of wind-up; the open ones don't", () => {
    eq(C.solve(st("tar", { mode: "4H" })).warnings.some((w) => w.id === "windup"), true, "part-time 4H");
    eq(C.solve(st("tar", { system: "ss2", mode: "4H" })).warnings.length, 0, "SSII 4H");
    eq(C.solve(st("tar", { system: "tod", mode: "4A" })).warnings.length, 0, "TOD 4A");
    eq(C.solve(st("tar", { system: "torsen", mode: "4H" })).warnings.length, 0, "Torsen");
  });

  test("the three slope choices give the lessons they're there for", () => {
    const deg = (id) => D.slopes.find((x) => x.id === id).deg;
    const mud = { fl: "mud", fr: "mud", rl: "mud", rr: "mud" }, tar = { fl: "tar", fr: "tar", rl: "tar", rr: "tar" };
    const at = (surfaces, slope, over) => C.solve(Object.assign({}, D.defaults, { surfaces: surfaces, slope: slope }, over || {})).status;
    eq(at(mud, deg("level")), "move", "level mud: 2H will do");
    eq(at(mud, deg("slope")), "spin", "sloping mud: 2H spins");
    eq(at(mud, deg("slope"), { mode: "4H" }), "move", "sloping mud: 4H drives");
    eq(at(tar, deg("steep")) !== "move", true, "steep tar: 2H is stuck");
    eq(at(tar, deg("steep"), { mode: "4H" }), "bog", "steep tar: 4H bogs");
    eq(at(tar, deg("steep"), { mode: "4L" }), "move", "steep tar: 4L climbs");
    eq(D.lowRange.default >= D.lowRange.min && D.defaults.lowRatio >= D.lowRange.min, true, "default ratio in range");
  });

  test("suggest finds the fewest presses", () => {
    const one = C.suggest(st("mud"));
    eq(one.every((o) => o.length === 1), true, "single presses for mud");
    eq(one.some((o) => o[0].id === "mode-4H"), true, "4H suggested");
    eq(C.suggest(st("mud", { mode: "4H" })).length, 0, "nothing when moving");
  });

  // ------------------------------------------------------------ report
  const failed = results.filter((r) => !r.ok);
  const list = document.getElementById("results");
  results.forEach((r) => {
    const li = document.createElement("li");
    li.className = r.ok ? "ok" : "bad";
    li.textContent = (r.ok ? "PASS  " : "FAIL  ") + r.name + (r.ok ? "" : "  -> " + r.error);
    list.appendChild(li);
  });
  document.getElementById("summary").textContent = failed.length
    ? `FAILED: ${failed.length} of ${results.length} tests`
    : `ALL PASSED: ${results.length} tests`;
})();
