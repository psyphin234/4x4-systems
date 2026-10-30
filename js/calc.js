/* The drivetrain model: pure functions, no DOM. Everything is a fraction of the
   vehicle's weight (see data.js).

   The drivetrain is a tree: the centre (transfer case) splits the pull between
   the front and rear axles, and each axle's diff splits it between its two
   wheels. Each wheel can push the ground with at most grip × the load on it.
   What each kind of split can pass on before a wheel spins:
   - open diff: the same torque to both sides, so 2 × what the weaker side holds;
   - locked (locker, CDL, part-time 4H/4L): both sides turn together, so the sum;
   - LSD: the stronger side takes up to `bias` × the weaker side's torque;
   - traction control: an open diff whose spinning side is braked, so the other
     side gets drive; at the ground that's the sum, like a locker;
   - 2H: everything to the rear axle. */
window.SYS_CALC = (function () {
  "use strict";

  const D = window.SYS_DATA;
  const EPS = 1e-9;
  const WHEELS = ["fl", "fr", "rl", "rr"];
  const surface = (id) => D.surfaces.find((s) => s.id === id) || D.surfaces[0];
  const system = (id) => D.systems.find((s) => s.id === id) || D.systems[0];

  // Keep a state within what its system has (e.g. no 2H on a full-time 4x4).
  function normalise(state) {
    const s = Object.assign({}, state);
    const sys = system(s.system);
    if (sys.ranges.indexOf(s.range) < 0) s.range = s.range === "2H" || !sys.ranges.includes("4L") ? sys.ranges[0] : "4L";
    if (!sys.cdl) s.cdl = false;
    if (!sys.lockers) { s.rearLock = false; s.frontLock = false; }
    return s;
  }

  // The load and grip under each wheel. The wheels on the ground share the
  // weight evenly (a simplification, listed in the gaps).
  function wheelGrip(surfaces) {
    const onGround = WHEELS.filter((w) => surface(surfaces[w]).id !== "air");
    const out = {};
    WHEELS.forEach((w) => {
      const sf = surface(surfaces[w]);
      const load = sf.id === "air" || !onGround.length ? 0 : 1 / onGround.length;
      out[w] = { surface: sf.id, load: load, grip: sf.grip * load };
    });
    return out;
  }

  // The push needed to keep moving up the slope: the slope itself plus the
  // average rolling resistance of the surfaces the wheels are on.
  function needed(surfaces, slopeDeg) {
    const a = (slopeDeg * Math.PI) / 180;
    const ground = WHEELS.map((w) => surface(surfaces[w])).filter((sf) => sf.id !== "air");
    const roll = ground.length ? ground.reduce((t, sf) => t + sf.roll, 0) / ground.length : 0;
    return Math.sin(a) + roll * Math.cos(a);
  }

  // What each split is, from the switches.
  function splits(state) {
    const s = normalise(state);
    let centre;
    if (s.system === "part") centre = s.range === "2H" ? "rear" : "locked";
    else if (s.cdl) centre = "locked";
    else centre = s.trc ? "tc" : "open";
    const rear = s.rearLock ? "locked" : s.trc ? "tc" : s.rearLsd ? "lsd" : "open";
    const front = s.frontLock ? "locked" : s.trc ? "tc" : "open";
    return { centre: centre, front: front, rear: rear };
  }

  function tree(state, grip) {
    const k = splits(state);
    const leaf = (w) => ({ type: "wheel", id: w, grip: grip[w].grip });
    return {
      type: k.centre, id: "centre",
      a: { type: k.front, id: "front", a: leaf("fl"), b: leaf("fr") },
      b: { type: k.rear, id: "rear", a: leaf("rl"), b: leaf("rr") }
    };
  }

  // The most a node can pass to the ground before a wheel spins.
  function capacity(n) {
    if (n.type === "wheel") return n.grip;
    if (n.type === "rear") return capacity(n.b);
    const ca = capacity(n.a), cb = capacity(n.b);
    if (n.type === "open") return 2 * Math.min(ca, cb);
    if (n.type === "lsd") return Math.min(ca + cb, Math.min(ca, cb) * (1 + D.lsd.bias));
    return ca + cb; // locked, tc
  }

  // Push F through node n; writes each wheel's demand, ground force, slip and
  // brake into out. braked: this branch is being held by traction control.
  function distribute(n, F, out, braked) {
    if (n.type === "wheel") {
      const force = Math.min(F, n.grip);
      out[n.id] = {
        demand: F, force: force,
        slip: F > n.grip + EPS,
        braked: !!braked && F >= n.grip - EPS
      };
      return force;
    }
    if (n.type === "rear") {
      distribute(n.a, 0, out, false);
      return distribute(n.b, F, out, false);
    }
    const ca = capacity(n.a), cb = capacity(n.b);
    const weakIsA = ca <= cb;
    const weak = weakIsA ? n.a : n.b, strong = weakIsA ? n.b : n.a;
    const cw = Math.min(ca, cb), cs = Math.max(ca, cb);
    let fw, fs, brakeWeak = false;
    if (n.type === "locked") {
      const total = ca + cb;
      fw = total > EPS ? (F * cw) / total : F / 2;
      fs = total > EPS ? (F * cs) / total : F / 2;
    } else if (F / 2 <= cw + EPS) {
      fw = fs = F / 2; // within what the weak side holds: an even split
    } else if (n.type === "open") {
      fw = F / 2; fs = cw; // the weak side spins; the strong side gets only what it holds
    } else if (n.type === "lsd") {
      if (F <= capacity(n) + EPS) { fw = cw; fs = F - cw; } // the bias carries the rest across
      else { fw = F / 2; fs = D.lsd.bias * cw <= cs ? D.lsd.bias * cw : F - cw; }
    } else { // tc: brake the weak side, the rest goes to the strong side
      fw = cw; fs = F - cw; brakeWeak = true;
    }
    if (weakIsA) {
      return distribute(weak, fw, out, braked || brakeWeak) + distribute(strong, fs, out, braked);
    }
    return distribute(strong, fs, out, braked) + distribute(weak, fw, out, braked || brakeWeak);
  }

  // The whole picture for one setting of the switches and terrain.
  // status: "move" (it drives on), "spin" (not enough grip: wheels spin), or
  // "bog" (not enough engine pull: it bogs down; low range is the answer).
  function solve(state) {
    const s = normalise(state);
    const grip = wheelGrip(s.surfaces);
    const t = tree(s, grip);
    const cap = capacity(t);
    const need = needed(s.surfaces, s.slope);
    const pull = D.engine.pullHigh * (s.range === "4L" ? s.lowRatio : 1);
    let status, F;
    if (need <= cap + EPS && need <= pull + EPS) { status = "move"; F = need; }
    else if (cap < pull && cap < need) { status = "spin"; F = pull; }
    else { status = "bog"; F = pull; }
    const wheels = {};
    const ground = distribute(t, F, wheels, false);
    const k = splits(s);
    WHEELS.forEach((w) => {
      Object.assign(wheels[w], grip[w]);
      wheels[w].driven = !(k.centre === "rear" && (w === "fl" || w === "fr"));
    });
    return {
      state: s, splits: k, status: status, need: need, grip: cap, pull: pull, ground: ground,
      totalGrip: WHEELS.reduce((t2, w) => t2 + grip[w].grip, 0),
      wheels: wheels,
      frontForce: wheels.fl.force + wheels.fr.force,
      rearForce: wheels.rl.force + wheels.rr.force,
      warnings: warnings(s, k)
    };
  }

  // Cautions about using a setting where it doesn't belong.
  function warnings(s, k) {
    const out = [];
    const onTar = WHEELS.some((w) => s.surfaces[w] === "tar");
    if (onTar && k.centre === "locked") {
      out.push({ id: "windup", text: s.system === "part"
        ? "4H/4L on tar: with no centre diff the front and rear can't turn at different speeds, so the drivetrain winds up in turns. Use 2H on hard grippy surfaces."
        : "CDL on tar: the front and rear shafts can't turn at different speeds, so the drivetrain winds up in turns. Unlock it on hard grippy surfaces." });
    }
    if (onTar && (k.front === "locked" || k.rear === "locked")) {
      out.push({ id: "locker", text: "Locker on tar: both wheels on the axle must turn together, so it fights the steering and scrubs the tyres in turns. Lockers are for slow going on loose ground." });
    }
    if (s.frontLock && k.centre === "rear") {
      out.push({ id: "front2h", text: "The front locker does nothing in 2H: the front axle isn't driven." });
    }
    return out;
  }

  // Switches the visitor can press, as small changes to the state.
  function toggles(state) {
    const s = normalise(state);
    const sys = system(s.system);
    const out = [];
    sys.ranges.forEach((r) => { if (r !== s.range) out.push({ id: "range-" + r, label: r, change: { range: r } }); });
    if (sys.cdl && !s.cdl) out.push({ id: "cdl", label: "CDL", change: { cdl: true } });
    if (sys.lockers && !s.rearLock) out.push({ id: "rearLock", label: "Rear locker", change: { rearLock: true } });
    if (sys.lockers && !s.frontLock) out.push({ id: "frontLock", label: "Front locker", change: { frontLock: true } });
    if (!s.trc) out.push({ id: "trc", label: "Traction control", change: { trc: true } });
    return out;
  }

  // The fewest presses that get it moving: single switches first, then pairs.
  // Returns a list of options, each a list of toggles; [] if nothing helps.
  function suggest(state) {
    const s = normalise(state);
    if (solve(s).status === "move") return [];
    const moves = (changes) => solve(Object.assign({}, s, ...changes.map((t) => t.change))).status === "move";
    const singles = toggles(s).filter((t) => moves([t])).map((t) => [t]);
    if (singles.length) return singles;
    const ts = toggles(s), pairs = [];
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        if (ts[i].id.startsWith("range-") && ts[j].id.startsWith("range-")) continue;
        if (moves([ts[i], ts[j]])) pairs.push([ts[i], ts[j]]);
      }
    }
    return pairs;
  }

  return {
    WHEELS, surface, system, normalise, wheelGrip, needed, splits, tree,
    capacity, distribute, solve, warnings, toggles, suggest
  };
})();
