/* The drivetrain model: pure functions, no DOM. Everything is a fraction of the
   vehicle's weight (see data.js).

   The drivetrain is a tree: the centre (transfer case) splits the pull between
   the front and rear axles, and each axle's diff splits it between its two
   wheels. Each wheel can push the ground with at most grip × the load on it.
   What each kind of split can pass on before a wheel spins:
   - open diff: the same torque to both sides, so 2 × what the weaker side holds;
   - locked (locker, CDL, part-time 4H/4L, 4HLc): both sides turn together, so the sum;
   - LSD / Torsen: the stronger side takes up to `bias` × the weaker side's torque;
     a clutch LSD's preload also gives it at least the weaker side's plus the
     preload, so a wheel in the air still leaves the other some drive (a Torsen
     has no preload: with an end in the air it passes nothing);
   - traction control: an open diff whose spinning side is braked, so the other
     side gets drive. It only brakes once the wheel spins, and lets go again, so
     the other side gets only `trc.share` of the extra a locker would give it;
     and the engine has to pull against the brake too (the brake loss, added to
     the pull needed);
   - wet clutch (4A): the rear is driven, and the clutch passes up to its limit
     to the front once the rear needs help;
   - 2H: everything to the rear axle. */
window.SYS_CALC = (function () {
  "use strict";

  const D = window.SYS_DATA;
  const EPS = 1e-9;
  const WHEELS = ["fl", "fr", "rl", "rr"];
  const surface = (id) => D.surfaces.find((s) => s.id === id) || D.surfaces[0];
  const system = (id) => D.systems.find((s) => s.id === id) || D.systems[0];
  const mode = (s) => system(s.system).modes.find((m) => m.id === s.mode) || system(s.system).modes[0];

  // Keep a state within what its system has. Switching systems keeps the
  // nearest lever position: low range stays low, 2WD stays 2WD where there is one.
  function normalise(state) {
    const s = Object.assign({}, state);
    const sys = system(s.system);
    s.system = sys.id;
    if (!sys.modes.some((m) => m.id === s.mode)) {
      const wasLow = /L/.test(String(s.mode).slice(1));
      const was2 = s.mode === "2H";
      const pick = (was2 && sys.modes.find((m) => m.centre === "rear")) ||
        (wasLow && sys.modes.find((m) => m.low)) ||
        sys.modes.find((m) => m.centre !== "rear" && !m.low) || sys.modes[0];
      s.mode = pick.id;
    }
    if (!sys.cdl) s.cdl = false;
    fixSurfaces(s);
    return s;
  }

  // Unknown surfaces (from an older saved state) fall back to tar.
  function fixSurfaces(s) {
    const sf = Object.assign({}, s.surfaces || {});
    WHEELS.forEach((w) => { if (!D.surfaces.some((x) => x.id === sf[w])) sf[w] = "tar"; });
    s.surfaces = sf;
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

  // What each split is, from the lever and the switches.
  function splits(state) {
    const s = normalise(state);
    let centre = mode(s).centre;
    if (s.cdl && centre === "torsen") centre = "locked";
    if (s.trc && (centre === "open" || centre === "torsen")) centre = "tc";
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

  const bias = (type) => (type === "torsen" ? D.torsen.bias : D.lsd.bias);

  // The most the stronger side of an LSD or Torsen can take, given what the
  // weaker side holds (before the stronger side's own grip runs out).
  function strongLimit(type, weak) {
    const byBias = bias(type) * weak;
    return type === "lsd" ? Math.max(byBias, weak + D.lsd.preload) : byBias;
  }

  // What traction control gets to the stronger side: what the weaker side
  // holds (as an open diff) plus trc.share of the rest a locker would add.
  const tcLimit = (weak, strong) => weak + D.trc.share * Math.max(0, strong - weak);

  // The most a node can pass to the ground before a wheel spins.
  function capacity(n) {
    if (n.type === "wheel") return n.grip;
    if (n.type === "rear") return capacity(n.b);
    const ca = capacity(n.a), cb = capacity(n.b);
    if (n.type === "open") return 2 * Math.min(ca, cb);
    if (n.type === "lsd" || n.type === "torsen") {
      const weak = Math.min(ca, cb);
      return weak + Math.min(Math.max(ca, cb), strongLimit(n.type, weak));
    }
    if (n.type === "clutch") return cb + Math.min(ca, D.clutch.max); // a = front, b = rear (driven)
    if (n.type === "tc") return tcLimit(Math.min(ca, cb), Math.max(ca, cb)) + Math.min(ca, cb);
    return ca + cb; // locked
  }

  // Push F through node n; writes each wheel's demand, ground force, slip and
  // brake into out, each split's own story into out._splits, and the pull the
  // traction control brakes take into out._brake.
  // braked: this branch is being held by traction control.
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
    out._splits = out._splits || {};
    if (n.type === "rear") {
      distribute(n.a, 0, out, false);
      out._splits[n.id] = { a: 0, b: F };
      return distribute(n.b, F, out, false);
    }
    const ca = capacity(n.a), cb = capacity(n.b);
    if (n.type === "clutch") {
      // The rear is driven; the clutch tops it up from the front, up to its limit.
      const fa = Math.min(Math.max(F - cb, 0), D.clutch.max);
      out._splits[n.id] = { a: fa, b: F - fa, clutch: fa < EPS ? "open" : fa >= D.clutch.max - EPS ? "max" : "slip" };
      return distribute(n.a, fa, out, braked) + distribute(n.b, F - fa, out, braked);
    }
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
    } else if (n.type === "lsd" || n.type === "torsen") {
      const lim = strongLimit(n.type, cw);
      if (F <= capacity(n) + EPS) { fw = cw; fs = F - cw; } // the bias (or preload) carries the rest across
      else { fw = F / 2; fs = lim < cs ? lim : F - cw; }
    } else { // tc: brake the weak side, the rest goes to the strong side, up to what TRC manages
      fs = Math.min(F - cw, tcLimit(cw, cs)); fw = F - fs; brakeWeak = true;
      // the open diff gives the weak side the same torque as the strong; the
      // ground takes what it holds and the brake the rest
      out._brake = (out._brake || 0) + Math.max(0, fs - cw);
    }
    out._splits[n.id] = weakIsA ? { a: fw, b: fs } : { a: fs, b: fw };
    if (weakIsA) {
      return distribute(weak, fw, out, braked || brakeWeak) + distribute(strong, fs, out, braked);
    }
    return distribute(strong, fs, out, braked) + distribute(weak, fw, out, braked || brakeWeak);
  }

  // The diff demo: one diff ("open", "lsd" or "locked") between two wheels on
  // the given surfaces, pushing what one axle needs (D.diffDemo). Torque
  // shares are of the torque reaching the ground (50:50 when there's none);
  // speeds are relative to the vehicle rolling along (1 each): stuck, a
  // slipping wheel on an open diff or LSD takes all the turning (2, the other 0).
  function diffDemo(type, left, right) {
    const dd = D.diffDemo;
    const wheel = (id, sf) => ({ type: "wheel", id: id, grip: surface(sf).grip * dd.load });
    const n = { type: type, id: "diff", a: wheel("l", left), b: wheel("r", right) };
    const cap = capacity(n);
    const out = {};
    const ground = distribute(n, dd.need, out);
    const moves = cap >= dd.need - EPS;
    const tl = out.l.force, tr = out.r.force, tt = tl + tr;
    const slip = { l: !moves && out.l.slip, r: !moves && out.r.slip };
    let speed;
    if (moves || type === "locked" || (slip.l && slip.r)) speed = { l: 1, r: 1 };
    else speed = { l: slip.l ? 2 : 0, r: slip.r ? 2 : 0 };
    const share = (a, b) => (a + b > EPS ? a / (a + b) : 0.5);
    return {
      type: type, left: left, right: right, need: dd.need, capacity: cap, ground: ground, moves: moves,
      torque: { l: tl, r: tr }, torqueShare: { l: share(tl, tr), r: share(tr, tl) },
      speed: speed, speedShare: { l: share(speed.l, speed.r), r: share(speed.r, speed.l) },
      slip: slip, surfaces: { l: left, r: right }
    };
  }

  // The whole picture for one setting of the switches and terrain.
  // status: "move" (it drives on), "spin" (not enough grip: wheels spin), or
  // "bog" (not enough engine pull: it bogs down; low range is the answer).
  function solve(state) {
    const s = normalise(state);
    const m = mode(s);
    const grip = wheelGrip(s.surfaces);
    const t = tree(s, grip);
    const cap = capacity(t);
    const need = needed(s.surfaces, s.slope);
    const pull = D.engine.pullHigh * (m.low ? s.lowRatio : 1);
    // what traction control's brakes take while pushing what's needed
    const trial = {};
    distribute(t, Math.min(need, cap), trial, false);
    const brake = trial._brake || 0;
    let status, F;
    if (need <= cap + EPS && need + brake <= pull + EPS) { status = "move"; F = need; }
    else if (cap < pull && cap < need) { status = "spin"; F = pull; }
    else { status = "bog"; F = pull; }
    const wheels = {};
    const ground = distribute(t, F, wheels, false);
    const centre = wheels._splits.centre;
    delete wheels._splits;
    delete wheels._brake;
    const k = splits(s);
    WHEELS.forEach((w) => {
      Object.assign(wheels[w], grip[w]);
      wheels[w].driven = !(k.centre === "rear" && (w === "fl" || w === "fr"));
    });
    return {
      state: s, mode: m, low: !!m.low, splits: k, status: status, need: need, grip: cap, pull: pull, ground: ground, brake: brake,
      totalGrip: WHEELS.reduce((t2, w) => t2 + grip[w].grip, 0),
      wheels: wheels,
      frontForce: wheels.fl.force + wheels.fr.force,
      rearForce: wheels.rl.force + wheels.rr.force,
      clutch: centre.clutch || null,
      warnings: warnings(s, k)
    };
  }

  // Cautions about using a setting where it doesn't belong.
  function warnings(s, k) {
    const out = [];
    const onTar = WHEELS.some((w) => s.surfaces[w] === "tar");
    if (onTar && k.centre === "locked") {
      out.push({ id: "windup", text: (s.cdl ? "CDL" : mode(s).label) +
        " on tar: the front and rear can't turn at different speeds, so the drivetrain winds up in turns. " +
        (s.system === "part" ? "Use 2H on hard grippy surfaces." : s.system === "torsen" ? "Unlock the CDL on hard grippy surfaces." :
          s.system === "ss2" ? "Use 2H or 4H on hard grippy surfaces." : "Use 2H or 4A on hard grippy surfaces.") });
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
    sys.modes.forEach((m) => { if (m.id !== s.mode) out.push({ id: "mode-" + m.id, label: m.label, change: { mode: m.id } }); });
    if (sys.cdl && !s.cdl) out.push({ id: "cdl", label: "CDL", change: { cdl: true } });
    if (!s.rearLock) out.push({ id: "rearLock", label: "Rear locker", change: { rearLock: true } });
    if (!s.frontLock) out.push({ id: "frontLock", label: "Front locker", change: { frontLock: true } });
    if (!s.trc) out.push({ id: "trc", label: "Traction control", change: { trc: true } });
    return out;
  }

  // The fewest presses that get it moving: single switches first, then pairs.
  // Returns a list of options, each a list of toggles; [] if nothing helps.
  function suggest(state) {
    const s = normalise(state);
    if (solve(s).status === "move") return [];
    const moves = (changes) => solve(Object.assign({}, s, ...changes.map((t) => t.change))).status === "move";
    const ts = toggles(s);
    const singles = ts.filter((t) => moves([t])).map((t) => [t]);
    if (singles.length) return singles;
    const pairs = [];
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        if (ts[i].id.startsWith("mode-") && ts[j].id.startsWith("mode-")) continue;
        if (moves([ts[i], ts[j]])) pairs.push([ts[i], ts[j]]);
      }
    }
    return pairs;
  }

  return {
    WHEELS, surface, system, mode, normalise, wheelGrip, needed, splits, tree,
    capacity, distribute, solve, warnings, toggles, suggest, diffDemo
  };
})();
