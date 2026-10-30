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

  test("defaults are a valid state", () => {
    eq(!!scenario(D.defaults.scenario), true, "default scenario");
    eq(C.system(D.defaults.system).ranges.includes(D.defaults.range), true, "default range");
  });

  // ------------------------------------------------------------ the splits
  const g = (a, b, c, d) => ({ fl: a, fr: b, rl: c, rr: d });
  test("open diff passes twice the weaker side", () => {
    const t = { type: "open", a: { type: "wheel", id: "fl", grip: 0.05 }, b: { type: "wheel", id: "fr", grip: 0.3 } };
    near(C.capacity(t), 0.1, 1e-9, "capacity");
    const out = {};
    near(C.distribute(t, 0.4, out), 0.1, 1e-9, "ground");
    eq(out.fl.slip, true, "weak side spins");
    eq(out.fr.slip, false, "strong side holds");
    near(out.fr.force, 0.05, 1e-9, "strong side gets what the weak side holds");
  });

  test("locked diff passes the sum; both spin when over it", () => {
    const t = { type: "locked", a: { type: "wheel", id: "fl", grip: 0 }, b: { type: "wheel", id: "fr", grip: 0.3 } };
    near(C.capacity(t), 0.3, 1e-9, "capacity");
    const out = {};
    C.distribute(t, 0.2, out);
    near(out.fr.force, 0.2, 1e-9, "all to the gripping side");
    eq(out.fr.slip, false, "no slip under capacity");
  });

  test("LSD: the strong side takes up to bias × the weak side", () => {
    const t = { type: "lsd", a: { type: "wheel", id: "rl", grip: 0.05 }, b: { type: "wheel", id: "rr", grip: 0.3 } };
    near(C.capacity(t), 0.05 * (1 + D.lsd.bias), 1e-9, "capacity");
    const out = {};
    C.distribute(t, 0.15, out);
    eq(out.rl.slip || out.rr.slip, false, "under capacity nothing spins");
    near(out.rl.force + out.rr.force, 0.15, 1e-9, "all of it reaches the ground");
    const air = { type: "lsd", a: { type: "wheel", id: "rl", grip: 0 }, b: { type: "wheel", id: "rr", grip: 0.3 } };
    eq(C.capacity(air), 0, "a lifted wheel leaves an LSD nothing to bias");
  });

  test("traction control brakes the weak side and drives the other", () => {
    const t = { type: "tc", a: { type: "wheel", id: "rl", grip: 0 }, b: { type: "wheel", id: "rr", grip: 0.3 } };
    const out = {};
    C.distribute(t, 0.2, out, false);
    eq(out.rl.braked, true, "lifted wheel braked");
    near(out.rr.force, 0.2, 1e-9, "drive goes across");
  });

  test("load is shared by the wheels on the ground", () => {
    const w = C.wheelGrip(g("air", "rock", "rock", "air"));
    near(w.fr.load, 0.5, 1e-9, "load");
    near(w.fr.grip, 0.35, 1e-9, "grip");
    eq(w.fl.grip, 0, "air has no grip");
  });

  // ------------------------------------------------------------ the scenarios behave as their notes say
  test("muddy track: 2H spins, 4H drives", () => {
    eq(status("mud"), "spin", "2H");
    eq(status("mud", { range: "4H" }), "move", "4H");
  });

  test("one wheel on ice: open full-time spins, CDL drives, part-time 4H drives", () => {
    eq(status("ice", { system: "full", range: "4H" }), "spin", "full-time open");
    eq(status("ice", { system: "full", range: "4H", cdl: true }), "move", "CDL");
    eq(status("ice", { range: "4H" }), "move", "part-time 4H");
    eq(status("ice"), "spin", "2H");
  });

  test("rear wheel in the air: open centre takes nothing, CDL fixes it", () => {
    eq(status("lift", { system: "full", range: "4H" }), "spin", "open centre");
    eq(status("lift", { system: "full", range: "4H", cdl: true }), "move", "CDL");
    eq(status("lift", { system: "awd", range: "4H", trc: true }), "move", "AWD with traction control");
  });

  test("cross-axle: CDL alone or a locker alone isn't enough on full-time", () => {
    const full = { system: "full", range: "4H" };
    eq(status("cross", full), "spin", "open");
    eq(status("cross", Object.assign({}, full, { cdl: true })), "spin", "CDL only");
    eq(status("cross", Object.assign({}, full, { rearLock: true })), "spin", "rear locker only");
    eq(status("cross", Object.assign({}, full, { cdl: true, rearLock: true })), "move", "CDL + rear locker");
    eq(status("cross", Object.assign({}, full, { trc: true })), "move", "traction control");
  });

  test("steep rock: high range bogs, low range climbs", () => {
    eq(status("rock", { range: "4H" }), "bog", "4H");
    eq(status("rock", { range: "4L" }), "move", "4L");
    eq(status("rock"), "spin", "2H");
  });

  test("low range adds pull, not grip", () => {
    const hi = C.solve(st("mud", { range: "4H" })), lo = C.solve(st("mud", { range: "4L" }));
    near(lo.pull, hi.pull * D.defaults.lowRatio, 1e-9, "pull");
    near(lo.grip, hi.grip, 1e-9, "grip unchanged");
  });

  test("normalise keeps switches within the system", () => {
    const s = C.normalise({ system: "full", range: "2H", rearLock: true, cdl: true });
    eq(s.range, "4H", "no 2H on full-time");
    const a = C.normalise({ system: "awd", range: "4L", rearLock: true, cdl: true });
    eq(a.range, "4H", "AWD range");
    eq(a.cdl || a.rearLock, false, "AWD has no CDL or lockers");
  });

  test("tar: locked centre warns of wind-up", () => {
    const r = C.solve(st("tar", { range: "4H" }));
    eq(r.status, "move", "moves");
    eq(r.warnings.some((w) => w.id === "windup"), true, "warning");
    eq(C.solve(st("tar", { system: "full", range: "4H" })).warnings.length, 0, "open centre is fine");
  });

  test("suggest finds the fewest presses", () => {
    const one = C.suggest(st("mud"));
    eq(one.every((o) => o.length === 1), true, "single presses for mud");
    eq(one.some((o) => o[0].id === "range-4H"), true, "4H suggested");
    eq(C.suggest(st("mud", { range: "4H" })).length, 0, "nothing when moving");
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
