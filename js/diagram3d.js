/* The live drivetrain in 3D (three.js r149, js/vendor/three.min.js): a bare
   rolling chassis on four tiles of ground, with see-through housings so the
   gears inside the transfer case and the axle diffs show. It only draws;
   app.js owns the state and passes the model's result (calc.js solve()) to
   show().

   Colour code, on every shaft, gear and wheel:
   - ACTIVE  (cyan, brighter = more torque): carrying drive;
   - PASSIVE (steel blue): turning, but carrying no drive;
   - IDLE    (dark grey): standing still, not connected;
   - LOCKED  (gold): a lock or clutch that's engaged;
   - SLIP    (red): a wheel spinning, (orange) a clutch slipping under load;
   - BRAKE   (amber): traction control holding a wheel.
   Drag to turn the view, scroll to zoom; focus() flies to a part. Clicking a
   tile of ground calls onWheelClick(wheel). Under prefers-reduced-motion
   nothing turns; the colours still show. Paused offscreen and in a background tab. */
window.SYS_DIAGRAM = (function () {
  "use strict";

  const T = window.THREE;
  const C = window.SYS_CALC;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------------------------------------------------------------- layout (metres)
  const R = 0.42;                      // wheel radius
  const AY = R;                        // axle height
  const WX = 0.95;                     // wheel track (half)
  const FZ = 1.45, RZ = -1.45;         // axle positions
  const FD = new T.Vector3(0.18, AY, FZ), RD = new T.Vector3(0, AY, RZ); // diff centres
  const MY = 0.66;                     // transfer case main shaft height
  const TCZ = -0.45;                   // transfer case centre
  const FOUT = new T.Vector3(0.28, 0.40, -0.62); // front output sprocket
  const CHAIN_Z = -0.62;
  const WHEEL_POS = { fl: [-WX, FZ], fr: [WX, FZ], rl: [-WX, RZ], rr: [WX, RZ] };

  const COL = {
    active: 0x4cc9ff, passive: 0x6b7ea8, idle: 0x323a52, lock: 0xffc857,
    slip: 0xff5d73, heat: 0xff8a3c, brake: 0xffb347, grip: 0x3ef08a, lsd: 0xb49bff
  };

  // ---------------------------------------------------------------- state
  let renderer, scene, camera, rig, box, canvas, labelLayer;
  let result = null, onWheelClick = null;
  let raf = 0, running = false, visible = true, last = 0, time = 0;
  const parts = {};        // name -> list of materials coloured together
  const spin = {};         // name -> { obj, axis } turned each frame by speed
  const angle = {};        // name -> accumulated angle
  const speed = {};        // name -> shown angular speed (eases to target)
  const labels = [];
  const tiles = {};
  const shown = { v: 0, wheel: { fl: 0, fr: 0, rl: 0, rr: 0 }, collar: {} };
  let groundOffset = 0;
  let chain = null, particles = null, flecks = [];
  let hover = null;

  // ---------------------------------------------------------------- materials
  function flowMat() {
    return new T.MeshStandardMaterial({ color: COL.idle, metalness: 0.55, roughness: 0.35, emissive: 0x000000 });
  }

  function reg(name, mat) { (parts[name] = parts[name] || []).push(mat); return mat; }

  // Colour a part by what it's doing. t: 0..1, how much drive it carries.
  function paint(name, state, t) {
    (parts[name] || []).forEach((m) => {
      let c = COL.idle, e = 0x000000, ei = 0;
      if (state === "active") { c = COL.active; e = COL.active; ei = 0.35 + 1.1 * Math.min(1, t || 0); }
      else if (state === "passive") { c = COL.passive; e = 0x1b2a4a; ei = 0.4; }
      else if (state === "lock") { c = COL.lock; e = COL.lock; ei = 0.8; }
      else if (state === "slip") { c = COL.slip; e = COL.slip; ei = 0.6 + 0.4 * Math.abs(Math.sin(time * 9)); }
      else if (state === "heat") { c = COL.heat; e = COL.heat; ei = 0.7 + 0.3 * Math.abs(Math.sin(time * 7)); }
      else if (state === "brake") { c = COL.brake; e = COL.brake; ei = 0.7 + 0.3 * Math.abs(Math.sin(time * 8)); }
      else if (state === "grip") { c = COL.grip; e = COL.grip; ei = 0.9; }
      else if (state === "lsd") { c = COL.lsd; e = COL.lsd; ei = 0.5; }
      m.color.setHex(c);
      m.emissive.setHex(e);
      m.emissiveIntensity = ei;
    });
  }

  const steel = new T.MeshStandardMaterial({ color: 0x3b4560, metalness: 0.75, roughness: 0.38, transparent: true });
  // The frame, springs and shocks fade when zoomed in, so they don't hide the gears.
  const chassisMats = [steel];
  const rubber = new T.MeshStandardMaterial({ color: 0x15181f, metalness: 0.05, roughness: 0.92 });
  const rimMat = new T.MeshStandardMaterial({ color: 0x9aa6c2, metalness: 0.85, roughness: 0.25 });

  // A see-through housing with glowing edges, like a cutaway drawing.
  function glass(geo, tint, opacity) {
    const g = new T.Group();
    const m = new T.MeshPhysicalMaterial({
      color: tint || 0x9fd8ff, transparent: true, opacity: opacity || 0.12, roughness: 0.1, metalness: 0.1,
      depthWrite: false, side: T.DoubleSide, emissive: 0x0b3a66, emissiveIntensity: 0.25
    });
    g.add(new T.Mesh(geo, m));
    const edges = new T.LineSegments(new T.EdgesGeometry(geo, 25),
      new T.LineBasicMaterial({ color: 0x4cc9ff, transparent: true, opacity: 0.45 }));
    g.add(edges);
    return g;
  }

  // ---------------------------------------------------------------- geometry helpers
  // A shaft between two points.
  function rod(a, b, r, mat) {
    const dir = new T.Vector3().subVectors(b, a);
    const m = new T.Mesh(new T.CylinderGeometry(r, r, dir.length(), 14), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
    m.castShadow = true;
    return m;
  }

  // A spur or bevel gear: a disc with teeth round the rim, turning about its
  // local Y axis. bevel: teeth leaning in, like a ring gear or spider gear.
  function gear(radius, width, teeth, mat, bevel) {
    const g = new T.Group();
    const body = new T.Mesh(new T.CylinderGeometry(radius * (bevel ? 0.92 : 0.96), radius, width, 28), mat);
    g.add(body);
    const tw = (2 * Math.PI * radius) / teeth * 0.5;
    const toothGeo = new T.BoxGeometry(tw, width * (bevel ? 0.9 : 1), radius * 0.16);
    const inst = new T.InstancedMesh(toothGeo, mat, teeth);
    const o = new T.Object3D();
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      o.position.set(Math.cos(a) * radius * 1.05, 0, Math.sin(a) * radius * 1.05);
      o.rotation.set(0, -a + Math.PI / 2, bevel ? 0.35 : 0);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
    }
    g.add(inst);
    g.add(new T.Mesh(new T.CylinderGeometry(radius * 0.25, radius * 0.25, width * 1.4, 12), mat)); // hub
    return g;
  }

  // Point a group's local Y axis along a world axis ("x" or "z").
  function along(obj, axis) {
    if (axis === "x") obj.rotation.z = Math.PI / 2;
    if (axis === "z") obj.rotation.x = Math.PI / 2;
    return obj;
  }

  // Register something that turns about its own Y axis at the speed of `name`.
  function turns(name, obj, factor) {
    const holder = new T.Group();
    holder.add(obj);
    (spin[name] = spin[name] || []).push({ obj: obj, factor: factor || 1 });
    return holder;
  }

  function label(text, pos, cls) {
    const el = document.createElement("div");
    el.className = "tag3d" + (cls ? " " + cls : "");
    el.textContent = text;
    labelLayer.appendChild(el);
    const l = { el: el, pos: pos.clone() };
    labels.push(l);
    return l;
  }

  // ---------------------------------------------------------------- the chassis
  function buildChassis() {
    // ladder frame
    [-0.55, 0.55].forEach((x) => {
      const rail = new T.Mesh(new T.BoxGeometry(0.08, 0.16, 4.2), steel);
      rail.position.set(x, 0.95, -0.05);
      rail.castShadow = true;
      rig.add(rail);
    });
    [1.9, 0.05, -1.0, -2.1].forEach((z) => {
      const cm = new T.Mesh(new T.BoxGeometry(1.1, 0.07, 0.07), steel);
      cm.position.set(0, 0.95, z);
      cm.castShadow = true;
      rig.add(cm);
    });
    // coil springs and shocks at each wheel
    const helix = new T.Curve();
    helix.getPoint = function (t) {
      const a = t * Math.PI * 2 * 5.5;
      return new T.Vector3(Math.cos(a) * 0.075, 0.5 + t * 0.37, Math.sin(a) * 0.075);
    };
    const springGeo = new T.TubeGeometry(helix, 160, 0.012, 6, false);
    const springMat = new T.MeshStandardMaterial({ color: 0xc8d2ea, metalness: 0.7, roughness: 0.3, transparent: true });
    const shockMat = new T.MeshStandardMaterial({ color: 0xffc857, metalness: 0.4, roughness: 0.4, transparent: true });
    chassisMats.push(springMat, shockMat);
    [[-0.55, FZ], [0.55, FZ], [-0.55, RZ], [0.55, RZ]].forEach(([x, z]) => {
      const sp = new T.Mesh(springGeo, springMat);
      sp.position.set(x, 0, z);
      sp.castShadow = true;
      rig.add(sp);
      const shock = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.42, 10), shockMat);
      shock.position.set(x + (x < 0 ? 0.13 : -0.13), 0.7, z + 0.12);
      shock.rotation.z = x < 0 ? -0.25 : 0.25;
      rig.add(shock);
    });
  }

  // ---------------------------------------------------------------- engine, gearbox
  function buildEngine() {
    const eng = new T.Group();
    const block = glass(new T.BoxGeometry(0.62, 0.52, 0.86), 0x4cc9ff, 0.2);
    eng.add(block);
    const coreMat = reg("engine", flowMat());
    for (let i = 0; i < 4; i++) {
      const cyl = new T.Mesh(new T.CylinderGeometry(0.075, 0.075, 0.3, 16), coreMat);
      cyl.position.set(0, 0.04, -0.3 + i * 0.2);
      eng.add(cyl);
    }
    const crank = turns("input", along(new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.9, 10), coreMat), "z"), 1);
    crank.position.y = -0.18;
    eng.add(crank);
    eng.position.set(0, 0.88, 0.75);
    rig.add(eng);
    label("ENGINE", new T.Vector3(0, 1.25, 0.75));

    const gb = glass(new T.CylinderGeometry(0.2, 0.15, 0.48, 20), 0x4cc9ff, 0.16);
    along(gb, "z");
    gb.position.set(0, MY, 0.08);
    rig.add(gb);
    const gbShaft = turns("input", along(new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 0.6, 10), reg("input", flowMat())), "z"));
    gbShaft.position.set(0, MY, 0.05);
    rig.add(gbShaft);
    label("GEARBOX", new T.Vector3(0, 0.95, 0.1), "tag3d--small");
  }

  // ---------------------------------------------------------------- transfer case
  let tcGroups = {};
  function buildTransferCase() {
    const tc = new T.Group();
    rig.add(tc);
    const housing = glass(new T.BoxGeometry(0.82, 0.64, 0.6), 0x9fd8ff, 0.1);
    housing.position.set(0.1, 0.57, TCZ - 0.05);
    tc.add(housing);
    tcLabel = label("TRANSFER CASE", new T.Vector3(0.15, 0.2, TCZ + 0.1), "tag3d--tc");

    // main shaft: input part (to the range collar) and output part (to the rear)
    const inMat = reg("input", flowMat());
    const s1 = turns("input", along(new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.2, 10), inMat), "z"));
    s1.position.set(0, MY, -0.25);
    tc.add(s1);
    const mainMat = reg("main", flowMat());
    const s2 = turns("main", along(new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.55, 10), mainMat), "z"));
    s2.position.set(0, MY, -0.62);
    tc.add(s2);

    // range set: high gear on the input, low gear on the main shaft, a countershaft below
    const hiGear = turns("input", along(gear(0.085, 0.04, 16, reg("rangeHi", flowMat())), "z"));
    hiGear.position.set(0, MY, -0.27);
    tc.add(hiGear);
    const loGear = turns("main", along(gear(0.13, 0.04, 24, reg("rangeLo", flowMat())), "z"));
    loGear.position.set(0, MY, -0.43);
    tc.add(loGear);
    const cMat = reg("counter", flowMat());
    const cs = new T.Group();
    cs.add(along(gear(0.13, 0.04, 24, cMat), "z"));
    const cs2 = along(gear(0.085, 0.04, 16, cMat), "z");
    cs2.position.z = -0.16;
    cs.add(cs2);
    const csShaft = along(new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.24, 10), cMat), "z");
    csShaft.position.z = -0.08;
    cs.add(csShaft);
    const csHolder = turns("counter", cs);
    csHolder.position.set(0, MY - 0.215, -0.27);
    tc.add(csHolder);
    // range collar: slides to the high gear (H) or the low gear (L)
    const collar = along(new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.04, 20), reg("rangeCollar", flowMat())), "z");
    collar.position.set(0, MY, -0.35);
    tc.add(collar);
    tcGroups.rangeCollar = collar;
    label("HI / LO RANGE", new T.Vector3(-0.32, 0.86, -0.35), "tag3d--small");

    // chain to the front output
    const dMat = reg("chain", flowMat());
    const ds = turns("chainDrive", along(gear(0.1, 0.035, 20, dMat), "z"));
    ds.position.set(0, MY, CHAIN_Z);
    tc.add(ds);
    const fs = turns("front", along(gear(0.1, 0.035, 20, dMat), "z"));
    fs.position.copy(FOUT);
    tc.add(fs);
    chain = buildChain(dMat);
    tc.add(chain.group);
    const fShaft = turns("front", along(new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.5, 10), reg("frontOut", flowMat())), "z"));
    fShaft.position.set(FOUT.x, FOUT.y, FOUT.z + 0.25);
    tc.add(fShaft);

    // the centre units; only the one for the chosen system shows
    tcGroups.chain = buildPartTimeCentre(tc);
    tcGroups.planetary = buildPlanetary(tc);
    tcGroups.bevel = buildBevelCentre(tc);
    tcGroups.clutch = buildClutch(tc);
  }
  let tcLabel = null;

  // The chain: links running round both sprockets.
  function buildChain(mat) {
    const g = new T.Group();
    const A = new T.Vector2(0, MY), B = new T.Vector2(FOUT.x, FOUT.y), r = 0.108;
    const d = new T.Vector2().subVectors(B, A), len = d.length(), u = d.clone().normalize();
    const n = new T.Vector2(-u.y, u.x);
    const L = 2 * len + 2 * Math.PI * r;
    const N = 44;
    const links = [];
    const geo = new T.BoxGeometry(0.03, 0.012, 0.03);
    for (let i = 0; i < N; i++) { const m = new T.Mesh(geo, mat); g.add(m); links.push(m); }
    function at(s) {
      s = ((s % L) + L) % L;
      const baseA = Math.atan2(n.y, n.x);
      if (s < len) return A.clone().addScaledVector(n, r).addScaledVector(u, s);
      s -= len;
      if (s < Math.PI * r) { const a = baseA - s / r; return new T.Vector2(B.x + Math.cos(a) * r, B.y + Math.sin(a) * r); }
      s -= Math.PI * r;
      if (s < len) return B.clone().addScaledVector(n, -r).addScaledVector(u, -s);
      s -= len;
      const a = baseA + Math.PI - s / r;
      return new T.Vector2(A.x + Math.cos(a) * r, A.y + Math.sin(a) * r);
    }
    return {
      group: g,
      move(offset) {
        for (let i = 0; i < N; i++) {
          const p = at(offset + (i / N) * L), q = at(offset + (i / N) * L + 0.01);
          links[i].position.set(p.x, p.y, CHAIN_Z);
          links[i].rotation.z = Math.atan2(q.y - p.y, q.x - p.x);
        }
      }
    };
  }

  // Part-time: a 2-4 collar locks the chain's drive sprocket to the main shaft.
  function buildPartTimeCentre(tc) {
    const g = new T.Group();
    const c = along(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.04, 20), reg("centreLock", flowMat())), "z");
    c.position.set(0, MY, -0.55);
    g.add(c);
    tcGroups.centreCollar = c;
    tc.add(g);
    return g;
  }

  // Full-time: a planetary centre diff (carrier from the input, sun to the
  // front chain, ring to the rear), with the CDL collar.
  function buildPlanetary(tc) {
    const g = new T.Group();
    g.position.set(0, MY, -0.53);
    const ringMat = reg("main", flowMat());
    g.add(new T.Mesh(new T.TorusGeometry(0.145, 0.022, 10, 40), ringMat)); // ring gear (round, so it needn't turn)
    const sun = turns("chainDrive", along(gear(0.045, 0.05, 12, reg("chain", flowMat())), "z"));
    g.add(sun);
    const planetMat = reg("planets", flowMat());
    const carrier = new T.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = turns("planetSpin", along(gear(0.042, 0.045, 12, planetMat), "z"));
      p.position.set(Math.cos(a) * 0.092, Math.sin(a) * 0.092, 0);
      carrier.add(p);
    }
    const plate = new T.Mesh(new T.RingGeometry(0.03, 0.12, 30), planetMat);
    plate.position.z = 0.03;
    carrier.add(plate);
    const carrierHolder = new T.Group();
    carrierHolder.add(carrier);
    (spin.carrierZ = spin.carrierZ || []).push({ obj: carrier, factor: 1, axisZ: true });
    g.add(carrierHolder);
    const cdl = along(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.035, 20), reg("centreLock", flowMat())), "z");
    cdl.position.z = 0.07;
    g.add(cdl);
    tcGroups.cdlCollar = cdl;
    tc.add(g);
    return g;
  }

  // Multi-mode (SSII): an open bevel centre diff on the main shaft, locked in 4HLc/4LLc.
  function buildBevelCentre(tc) {
    const g = new T.Group();
    g.position.set(0, MY, -0.52);
    const mat = reg("planets", flowMat());
    const carrier = new T.Group();
    const cage = new T.Mesh(new T.TorusGeometry(0.1, 0.012, 8, 30), mat);
    cage.rotation.y = Math.PI / 2;
    carrier.add(cage);
    carrier.add(new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.2, 8), mat)); // cross pin (along Y)
    [-1, 1].forEach((s) => {
      const sp = turns("planetSpin", gear(0.04, 0.03, 10, mat, true));
      sp.position.y = s * 0.065;
      if (s < 0) sp.rotation.x = Math.PI;
      carrier.add(sp);
    });
    (spin.carrierZ = spin.carrierZ || []).push({ obj: carrier, factor: 1, axisZ: true });
    g.add(carrier);
    const sideF = turns("chainDrive", along(gear(0.05, 0.03, 12, reg("chain", flowMat()), true), "z"));
    sideF.position.z = -0.06;
    g.add(sideF);
    const sideR = turns("main", along(gear(0.05, 0.03, 12, reg("main", flowMat()), true), "z"));
    sideR.position.z = 0.06;
    g.add(sideR);
    const lc = along(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.03, 20), reg("centreLock", flowMat())), "z");
    lc.position.z = 0.1;
    g.add(lc);
    tcGroups.bevelCollar = lc;
    tc.add(g);
    return g;
  }

  // Multi-mode (TOD): a wet multi-plate clutch between the main shaft and the chain.
  function buildClutch(tc) {
    const g = new T.Group();
    g.position.set(0, MY, -0.52);
    const plates = [];
    for (let i = 0; i < 8; i++) {
      const outer = i % 2 === 0;
      const m = reg(outer ? "clutchOuter" : "clutchInner", flowMat());
      const p = along(new T.Mesh(new T.CylinderGeometry(outer ? 0.13 : 0.115, outer ? 0.13 : 0.115, 0.008, 28), m), "z");
      g.add(p);
      plates.push(p);
    }
    // the electromagnet that clamps the pack, behind it
    const coil = new T.Mesh(new T.TorusGeometry(0.085, 0.022, 8, 36), new T.MeshStandardMaterial({ color: 0xb87333, metalness: 0.7, roughness: 0.35 }));
    coil.position.z = 0.075;
    g.add(coil);
    tcGroups.plates = plates;
    tc.add(g);
    return g;
  }

  // ---------------------------------------------------------------- props and axles
  function buildDriveline() {
    // rear prop: rear output to the rear diff's pinion
    const rp = rod(new T.Vector3(0, MY, -0.9), new T.Vector3(0, AY + 0.02, RZ + 0.2), 0.035, reg("rearProp", flowMat()));
    rig.add(rp);
    // front prop: front output to the front diff's pinion
    const fp = rod(new T.Vector3(FOUT.x, FOUT.y, FOUT.z + 0.5), new T.Vector3(FD.x, AY + 0.02, FZ - 0.2), 0.032, reg("frontProp", flowMat()));
    rig.add(fp);
    // universal joints
    [[0, MY, -0.9], [0, AY + 0.02, RZ + 0.2], [FOUT.x, FOUT.y, FOUT.z + 0.5], [FD.x, AY + 0.02, FZ - 0.2]].forEach((p, i) => {
      const uj = new T.Mesh(new T.SphereGeometry(0.05, 12, 10), reg(i < 2 ? "rearProp" : "frontProp", flowMat()));
      uj.position.set(p[0], p[1], p[2]);
      rig.add(uj);
    });
    buildAxle("front", FD, 1);
    buildAxle("rear", RD, -1);
  }

  // An axle: banjo housing, ring and pinion, carrier with spider gears, the
  // locker's dog collar (and an LSD clutch pack on the rear), half shafts, tubes.
  const axleBits = {};
  function buildAxle(name, D, dirToProp) {
    const g = new T.Group();
    g.position.copy(D);
    rig.add(g);
    const housing = glass(new T.SphereGeometry(0.22, 24, 16), 0x9fd8ff, 0.1);
    g.add(housing);
    // tubes (left and right), see-through so the half shafts show
    const tubeMat = new T.MeshStandardMaterial({ color: 0x3b4560, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.32, depthWrite: false });
    [-1, 1].forEach((s) => {
      const a = s * 0.2, b = s * (WX - 0.17) - D.x; // from the housing to the hub, in the axle's own space
      const tube = along(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, Math.abs(b - a), 16), tubeMat), "x");
      tube.position.x = (a + b) / 2;
      g.add(tube);
    });
    // pinion
    const pin = turns(name + "Prop", along(gear(0.05, 0.08, 10, reg(name + "Prop", flowMat()), true), "z"));
    pin.position.set(0.05, 0, -dirToProp * 0.13); // on the side the prop shaft comes from
    g.add(pin);
    // ring gear and carrier turn together about X
    const carrier = new T.Group();
    const ringMat = reg(name + "Ring", flowMat());
    const ring = along(gear(0.16, 0.035, 34, ringMat, true), "x");
    ring.position.x = 0.07; // on the far side, so the spider gears and the locker show from the default view
    carrier.add(ring);
    const pinMat = reg(name + "Spider", flowMat());
    carrier.add(new T.Mesh(new T.CylinderGeometry(0.011, 0.011, 0.17, 8), pinMat)); // cross pin along Y
    const spiders = [];
    [-1, 1].forEach((s) => {
      const sp = gear(0.04, 0.03, 10, pinMat, true);
      const h = new T.Group();
      h.add(sp);
      h.position.y = s * 0.06;
      if (s < 0) h.rotation.x = Math.PI;
      carrier.add(h);
      spiders.push(sp);
    });
    const carrierHolder = new T.Group();
    carrierHolder.add(carrier);
    g.add(carrierHolder);
    // side gears and half shafts, one per wheel
    const sides = {};
    const left = name === "front" ? "fl" : "rl", right = name === "front" ? "fr" : "rr";
    [[left, -1], [right, 1]].forEach(([w, s]) => {
      const sg = along(gear(0.045, 0.03, 12, reg("half-" + w, flowMat()), true), "x");
      if (s < 0) sg.rotation.z = -Math.PI / 2;
      const sgh = turns("wheel-" + w, sg, -s);
      sgh.position.x = s * 0.065;
      g.add(sgh);
      const a = s * 0.08, b = s * WX - D.x;
      const shaft = along(new T.Mesh(new T.CylinderGeometry(0.022, 0.022, Math.abs(b - a), 10), reg("half-" + w, flowMat())), "x");
      const sh = turns("wheel-" + w, shaft, -1);
      sh.position.x = (a + b) / 2;
      g.add(sh);
      sides[w] = sgh;
    });
    // locker: a dog collar on the right side gear, slides in when locked
    const collar = along(new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.035, 20), reg(name + "Lock", flowMat())), "x");
    collar.position.x = -0.16;
    g.add(collar);
    // LSD clutch packs (rear only)
    const lsd = new T.Group();
    if (name === "rear") {
      [-1, 1].forEach((s) => {
        for (let i = 0; i < 3; i++) {
          const d = along(new T.Mesh(new T.CylinderGeometry(0.055, 0.055, 0.006, 20), reg("rearLsd", flowMat())), "x");
          d.position.x = s * (0.095 + i * 0.012);
          lsd.add(d);
        }
      });
      g.add(lsd);
    }
    axleBits[name] = { carrier: carrier, spiders: spiders, collar: collar, lsd: lsd, sides: sides };
    axleBits[name].label = label(name.toUpperCase() + " DIFF", new T.Vector3(D.x, D.y + 0.32, D.z));
  }

  // ---------------------------------------------------------------- wheels
  const wheelBits = {};
  function buildWheels() {
    C.WHEELS.forEach((w) => {
      const [x, z] = WHEEL_POS[w];
      const side = x < 0 ? -1 : 1;
      const outer = new T.Group();
      outer.position.set(x, AY, z);
      rig.add(outer);
      const spinner = new T.Group();
      outer.add(spinner);
      const tyre = along(new T.Mesh(new T.CylinderGeometry(R, R, 0.3, 40), rubber), "x");
      tyre.castShadow = true;
      spinner.add(tyre);
      // tread blocks
      const lug = new T.BoxGeometry(0.13, 0.05, 0.07);
      const inst = new T.InstancedMesh(lug, rubber, 56);
      const o = new T.Object3D();
      for (let i = 0; i < 56; i++) {
        const a = (i / 28) * Math.PI;
        const off = i % 2 ? 0.075 : -0.075;
        o.position.set(off, Math.cos(a) * (R + 0.012), Math.sin(a) * (R + 0.012));
        o.rotation.set(a, 0, 0);
        o.updateMatrix();
        inst.setMatrixAt(i, o.matrix);
      }
      inst.castShadow = true;
      spinner.add(inst);
      // rim and spokes on the outside face
      const rim = along(new T.Mesh(new T.CylinderGeometry(0.25, 0.25, 0.305, 30), rimMat), "x");
      spinner.add(rim);
      for (let i = 0; i < 6; i++) {
        const sp = new T.Mesh(new T.BoxGeometry(0.02, 0.44, 0.05), rimMat);
        sp.position.x = side * 0.16;
        sp.rotation.x = (i / 6) * Math.PI;
        spinner.add(sp);
      }
      // the wheel's state ring, on the outside of the tyre
      const ringMat = flowMat();
      const ring = new T.Mesh(new T.TorusGeometry(R + 0.005, 0.014, 8, 60), ringMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = side * 0.16;
      outer.add(ring);
      // brake disc and caliper on the inside
      const disc = along(new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.02, 30), new T.MeshStandardMaterial({ color: 0x8a93a8, metalness: 0.8, roughness: 0.3 })), "x");
      disc.position.x = -side * 0.19;
      spinner.add(disc);
      const calMat = flowMat();
      const caliper = new T.Mesh(new T.BoxGeometry(0.06, 0.1, 0.12), calMat);
      caliper.position.set(-side * 0.19, 0.12, 0.08);
      outer.add(caliper);
      (spin["wheel-" + w] = spin["wheel-" + w] || []).push({ obj: spinner, factor: side, wheel: true });
      wheelBits[w] = { ringMat: ringMat, calMat: calMat, outer: outer,
        label: label("", new T.Vector3(x + side * 0.45, AY + 0.55, z), "tag3d--wheel") };
    });
  }

  // ---------------------------------------------------------------- ground
  function texture(kind) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 512;
    const g = c.getContext("2d");
    const rnd = (() => { let s = kind === "tar" ? 7 : 13; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    if (kind === "tar") {
      g.fillStyle = "#2a2f3b"; g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 2600; i++) { g.fillStyle = "rgba(" + (120 + rnd() * 80 | 0) + "," + (125 + rnd() * 80 | 0) + "," + (140 + rnd() * 80 | 0) + "," + (0.15 + rnd() * 0.3) + ")"; g.fillRect(rnd() * 256, rnd() * 512, 1.6, 1.6); }
      g.fillStyle = "rgba(240, 236, 220, 0.75)";
      for (let y = 0; y < 512; y += 128) g.fillRect(20, y + 20, 8, 70);
    } else if (kind === "mud") {
      g.fillStyle = "#4a321d"; g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 500; i++) {
        const k = rnd();
        g.fillStyle = "rgba(" + (70 + k * 50 | 0) + "," + (48 + k * 32 | 0) + "," + (28 + k * 18 | 0) + "," + (0.3 + rnd() * 0.4) + ")";
        g.beginPath(); g.ellipse(rnd() * 256, rnd() * 512, 3 + rnd() * 14, 2 + rnd() * 6, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = "rgba(20, 12, 6, 0.45)";
      g.fillRect(96, 0, 64, 512); // rut
      g.fillStyle = "rgba(170, 200, 230, 0.12)";
      for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(rnd() * 256, rnd() * 512, 10 + rnd() * 20, 3 + rnd() * 5, 0, 0, Math.PI * 2); g.fill(); } // wet sheen
    } else {
      g.fillStyle = "#03050c"; g.fillRect(0, 0, 256, 512);
      g.strokeStyle = "rgba(76, 201, 255, 0.35)"; g.lineWidth = 2;
      for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
      for (let y = 0; y <= 512; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
    }
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  const TEX = {};
  function buildGround() {
    ["tar", "mud", "air"].forEach((k) => { TEX[k] = texture(k); });
    C.WHEELS.forEach((w) => {
      const [x, z] = WHEEL_POS[w];
      const mat = new T.MeshStandardMaterial({ map: TEX.tar, roughness: 0.9, metalness: 0.0 });
      const tile = new T.Mesh(new T.PlaneGeometry(2.4, 3.0), mat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(x < 0 ? -1.2 : 1.2, 0, z < 0 ? -1.5 : 1.5);
      tile.receiveShadow = true;
      tile.userData.wheel = w;
      scene.add(tile);
      // the edge of the tile, lit when hovered
      const edge = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(2.38, 2.98)),
        new T.LineBasicMaterial({ color: 0x4cc9ff, transparent: true, opacity: 0.0 }));
      edge.rotation.x = -Math.PI / 2;
      edge.position.copy(tile.position).setY(0.005);
      scene.add(edge);
      tiles[w] = { mesh: tile, mat: mat, edge: edge, kind: "tar", maps: {} };
    });
    // a faint floor beyond the tiles
    const grid = new T.GridHelper(14, 28, 0x1d3b6b, 0x0f2142);
    grid.position.y = -0.01;
    scene.add(grid);
  }

  function setTile(w, kind) {
    const t = tiles[w];
    if (t.kind === kind) return;
    t.kind = kind;
    t.mat.map = TEX[kind].clone();
    t.mat.map.needsUpdate = true;
    t.mat.roughness = kind === "mud" ? 0.55 : 0.9;
    t.mat.emissive = new T.Color(kind === "air" ? 0x0a2a55 : 0x000000);
    t.mat.emissiveIntensity = kind === "air" ? 0.4 : 0;
    // a wheel in the air: the tile drops away into a pit, so the tyre hangs free
    t.mesh.position.y = kind === "air" ? -0.55 : 0;
    t.mat.needsUpdate = true;
  }

  // ---------------------------------------------------------------- particles
  function buildParticles() {
    const N = 500;
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute("color", new T.BufferAttribute(new Float32Array(N * 3), 3));
    const mat = new T.PointsMaterial({ size: 0.045, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false });
    particles = new T.Points(geo, mat);
    particles.frustumCulled = false;
    scene.add(particles);
    for (let i = 0; i < N; i++) flecks.push({ life: 0, p: new T.Vector3(0, -10, 0), v: new T.Vector3(), c: new T.Color() });
  }

  function emit(w, dt) {
    const kind = tiles[w].kind;
    if (kind === "air" || reduceMotion) return;
    const [x, z] = WHEEL_POS[w];
    const n = Math.min(8, Math.round(dt * 220));
    for (let i = 0; i < n; i++) {
      const f = flecks.find((q) => q.life <= 0);
      if (!f) return;
      f.life = 0.6 + Math.random() * 0.5;
      f.p.set(x + (Math.random() - 0.5) * 0.25, 0.04, z - R * 0.6);
      f.v.set((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 1.6, -(1.2 + Math.random() * 2.2));
      f.c.setHex(kind === "mud" ? (Math.random() < 0.5 ? 0x7a5532 : 0x5a3f26) : 0x9aa3b6);
    }
  }

  function stepParticles(dt) {
    const pos = particles.geometry.attributes.position.array;
    const col = particles.geometry.attributes.color.array;
    flecks.forEach((f, i) => {
      if (f.life > 0) {
        f.life -= dt;
        f.v.y -= 6 * dt;
        f.p.addScaledVector(f.v, dt);
        if (f.p.y < 0) { f.p.y = 0; f.v.set(0, 0, 0); }
        if (f.life <= 0) f.p.set(0, -10, 0);
      }
      pos[i * 3] = f.p.x; pos[i * 3 + 1] = f.p.y; pos[i * 3 + 2] = f.p.z;
      col[i * 3] = f.c.r; col[i * 3 + 1] = f.c.g; col[i * 3 + 2] = f.c.b;
    });
    particles.geometry.attributes.position.needsUpdate = true;
    particles.geometry.attributes.color.needsUpdate = true;
  }

  // ---------------------------------------------------------------- camera
  const VIEWS = {
    all:   { target: [0.05, 0.35, -0.1],    pos: [-4.3, 3.7, 2.7] },
    tcase: { target: [0.1, 0.56, -0.5],     pos: [-1.55, 0.78, -0.05] },
    front: { target: [FD.x, AY, FZ],        pos: [-0.75, 0.74, 0.62] },
    rear:  { target: [RD.x, AY, RZ],        pos: [-0.9, 0.74, -0.62] }
  };
  const cam = { target: new T.Vector3(), sph: new T.Spherical(), goal: null, from: null, t: 1 };

  function sphFrom(pos, target) {
    return new T.Spherical().setFromVector3(new T.Vector3().subVectors(pos, target));
  }

  function focus(name) {
    const v = VIEWS[name] || VIEWS.all;
    cam.from = { target: cam.target.clone(), sph: cam.sph.clone() };
    const target = new T.Vector3().fromArray(v.target);
    cam.goal = { target: target, sph: sphFrom(new T.Vector3().fromArray(v.pos), target) };
    cam.t = reduceMotion ? 1 : 0;
    if (reduceMotion) { cam.target.copy(target); cam.sph.copy(cam.goal.sph); cam.goal = null; if (result) frame(0); return; }
    kick();
  }

  function fadeChassis() {
    const o = cam.sph.radius < 2.6 ? 0.14 : 1;
    chassisMats.forEach((m) => { m.opacity = o; m.depthWrite = o === 1; });
  }

  function stepCamera(dt) {
    if (cam.goal) {
      cam.t = Math.min(1, cam.t + dt / 0.9);
      const e = cam.t * cam.t * (3 - 2 * cam.t);
      cam.target.lerpVectors(cam.from.target, cam.goal.target, e);
      cam.sph.radius = cam.from.sph.radius + (cam.goal.sph.radius - cam.from.sph.radius) * e;
      cam.sph.phi = cam.from.sph.phi + (cam.goal.sph.phi - cam.from.sph.phi) * e;
      let dth = cam.goal.sph.theta - cam.from.sph.theta;
      if (dth > Math.PI) dth -= 2 * Math.PI;
      if (dth < -Math.PI) dth += 2 * Math.PI;
      cam.sph.theta = cam.from.sph.theta + dth * e;
      if (cam.t >= 1) cam.goal = null;
    }
    fadeChassis();
    camera.position.setFromSpherical(cam.sph).add(cam.target);
    camera.lookAt(cam.target);
  }

  function setUpOrbit() {
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        drag.x = e.clientX; drag.y = e.clientY;
        cam.goal = null;
        cam.sph.theta -= dx * 0.008;
        cam.sph.phi = Math.min(1.45, Math.max(0.15, cam.sph.phi - dy * 0.008));
        kick();
      } else {
        const w = pick(e);
        if (w !== hover) { hover = w; canvas.style.cursor = w ? "pointer" : "grab"; kick(); }
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) { const w = pick(e); if (w && onWheelClick) onWheelClick(w); }
      drag = null;
    });
    canvas.addEventListener("pointerleave", () => { hover = null; kick(); });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      cam.goal = null;
      cam.sph.radius = Math.min(10, Math.max(0.8, cam.sph.radius * (1 + Math.sign(e.deltaY) * 0.1)));
      kick();
    }, { passive: false });
  }

  const ray = new T.Raycaster(), mouse = new T.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(C.WHEELS.map((w) => tiles[w].mesh), false)[0];
    return hit ? hit.object.userData.wheel : null;
  }

  // ---------------------------------------------------------------- per-frame state
  // Target speeds (rad/s for wheels) and the colour of every part, from the result.
  function wheelState(w) {
    const r = result.wheels[w];
    if (r.braked) return "brake";
    if (r.slip) return "spin";
    if (r.surface === "air") return "air";
    if (!r.driven || r.force < 1e-6) return "idle";
    return "grip";
  }

  function targetSpeeds() {
    const low = result.low, ratio = result.state.lowRatio;
    const v = result.status === "move" ? (low ? 1.5 / ratio : 1.5) : 0;
    const spinV = low ? 8 / Math.sqrt(ratio) : 8;
    const out = { v: v, wheel: {} };
    C.WHEELS.forEach((w) => {
      const st = wheelState(w);
      let s;
      if (result.status === "move") s = st === "brake" ? v * 0.3 : v;
      else if (st === "spin") s = spinV;
      else if (st === "brake") s = 0.3;
      else s = 0;
      out.wheel[w] = s / R;
    });
    raw = Object.assign({}, out.wheel); // before reduced motion stops them: the colours use these
    if (reduceMotion) out.v = 0;
    return out;
  }

  let raw = { fl: 0, fr: 0, rl: 0, rr: 0 }; // the model's wheel speeds
  const capAngular = (x) => Math.max(-28, Math.min(28, x));

  function stepSpeeds(dt) {
    const tg = targetSpeeds();
    const k = Math.min(1, dt * 3);
    shown.v += (tg.v - shown.v) * k;
    C.WHEELS.forEach((w) => { shown.wheel[w] += ((reduceMotion ? 0 : tg.wheel[w]) - shown.wheel[w]) * k; });
    const ww = shown.wheel;
    const s = result.splits;
    const front = (ww.fl + ww.fr) / 2, rear = (ww.rl + ww.rr) / 2;
    const FINAL = 2.4; // drawn ratio between the prop shafts and the wheels
    const frontConnected = s.centre !== "rear";
    const sp = {};
    C.WHEELS.forEach((w) => { sp["wheel-" + w] = ww[w]; });
    sp.frontProp = capAngular(front * FINAL);
    sp.rearProp = capAngular(rear * FINAL);
    sp.front = sp.frontProp;
    sp.main = sp.rearProp;
    sp.chainDrive = frontConnected ? sp.frontProp : 0;
    const centreOut = s.centre === "rear" || s.centre === "clutch" ? sp.main : (sp.frontProp + sp.main) / 2;
    sp.carrierZ = centreOut;
    sp.planetSpin = capAngular((sp.frontProp - sp.main) * 1.5);
    sp.input = capAngular(centreOut * (result.low ? result.state.lowRatio : 1));
    sp.counter = capAngular(-sp.input * 0.65);
    sp.frontCarrier = front; sp.rearCarrier = rear;
    sp.frontSpiders = capAngular((ww.fr - ww.fl) * 1.2);
    sp.rearSpiders = capAngular((ww.rr - ww.rl) * 1.2);
    return sp;
  }

  function applyRotation(sp, dt) {
    Object.keys(spin).forEach((name) => {
      const w = sp[name];
      if (w === undefined) return;
      angle[name] = (angle[name] || 0) + w * dt;
      spin[name].forEach((s) => {
        if (s.wheel) s.obj.rotation.x = angle[name]; // rolling forward (+z) turns about +x
        else if (s.axisZ) s.obj.rotation.z = angle[name] * s.factor;
        else s.obj.rotation.y = angle[name] * s.factor;
      });
    });
    ["front", "rear"].forEach((a) => {
      angle[a + "C"] = (angle[a + "C"] || 0) + sp[a + "Carrier"] * dt;
      angle[a + "S"] = (angle[a + "S"] || 0) + sp[a + "Spiders"] * dt;
      axleBits[a].carrier.rotation.x = angle[a + "C"];
      axleBits[a].spiders.forEach((g) => { g.rotation.y = angle[a + "S"]; });
    });
    if (chain) { angle.chain = (angle.chain || 0) + sp.chainDrive * 0.108 * dt; chain.move(angle.chain); }
  }

  // Ease a collar (or anything) towards a position along one axis.
  function slide(obj, axis, goal, dt) {
    obj.position[axis] += (goal - obj.position[axis]) * Math.min(1, dt * 8);
  }

  const T01 = (f) => Math.min(1, f / 0.4);

  function paintAll(dt) {
    const r = result, s = r.splits, m = r.mode;
    const sys = r.state.system;
    const moving = r.status === "move";
    const total = r.frontForce + r.rearForce;
    const frontOn = s.centre !== "rear" && r.frontForce > 1e-6;
    const turning = (x) => Math.abs(x) > 0.05;

    paint("engine", total > 1e-6 ? "active" : "passive", T01(total));
    paint("input", total > 1e-6 ? "active" : "passive", T01(total));
    paint("main", r.rearForce > 1e-6 ? "active" : (turning(raw.rl + raw.rr) ? "passive" : "idle"), T01(r.rearForce));
    // range set: the high gear drives in H; in L the drive goes through the countershaft
    const driving = total > 1e-6 ? "active" : "passive";
    paint("rangeHi", r.low ? "passive" : driving, T01(total));
    paint("counter", r.low ? driving : "passive", T01(total));
    paint("rangeLo", r.low ? driving : "passive", T01(total));
    paint("rangeCollar", "lock");
    slide(tcGroups.rangeCollar, "z", r.low ? -0.395 : -0.305, dt);

    // the centre
    tcGroups.chain.visible = sys === "part";
    tcGroups.planetary.visible = sys === "torsen";
    tcGroups.bevel.visible = sys === "ss2";
    tcGroups.clutch.visible = sys === "tod";
    const locked = s.centre === "locked";
    paint("centreLock", locked ? "lock" : "idle");
    if (sys === "part") slide(tcGroups.centreCollar, "z", locked ? -0.595 : -0.53, dt);
    if (sys === "torsen") slide(tcGroups.cdlCollar, "z", locked ? 0.045 : 0.085, dt);
    if (sys === "ss2") slide(tcGroups.bevelCollar, "z", locked ? 0.075 : 0.115, dt);
    paint("planets", s.centre === "rear" ? "idle" : locked ? "lock" : total > 1e-6 ? "active" : "passive", T01(total));
    paint("chain", s.centre === "rear" ? "idle" : frontOn ? "active" : turning(raw.fl) ? "passive" : "idle", T01(r.frontForce));
    paint("frontOut", s.centre === "rear" ? "idle" : frontOn ? "active" : "passive", T01(r.frontForce));
    if (sys === "tod") {
      const cl = s.centre === "rear" ? "open" : s.centre === "locked" ? "lock" : r.clutch;
      const gap = cl === "open" ? 0.016 : 0.009;
      tcGroups.plates.forEach((p, i) => slide(p, "z", (i - 3.5) * gap, dt));
      paint("clutchInner", r.rearForce > 1e-6 ? "active" : "passive", T01(r.rearForce));
      paint("clutchOuter", cl === "open" ? (turning(raw.fl) ? "passive" : "idle") : cl === "lock" || cl === "max" ? "lock" : "heat");
    }

    // props and axles
    paint("frontProp", frontOn ? "active" : turning(raw.fl + raw.fr) ? "passive" : "idle", T01(r.frontForce));
    paint("rearProp", r.rearForce > 1e-6 ? "active" : turning(raw.rl + raw.rr) ? "passive" : "idle", T01(r.rearForce));
    paint("frontRing", frontOn ? "active" : turning(raw.fl + raw.fr) ? "passive" : "idle", T01(r.frontForce));
    paint("rearRing", r.rearForce > 1e-6 ? "active" : turning(raw.rl + raw.rr) ? "passive" : "idle", T01(r.rearForce));
    ["front", "rear"].forEach((a) => {
      const type = s[a];
      const lockedAxle = type === "locked" && !(a === "front" && s.centre === "rear");
      paint(a + "Spider", lockedAxle ? "lock" : Math.abs(raw[a === "front" ? "fl" : "rl"] - raw[a === "front" ? "fr" : "rr"]) > 0.3 ? "passive" : "idle");
      paint(a + "Lock", type === "locked" ? "lock" : "idle");
      slide(axleBits[a].collar, "x", type === "locked" ? -0.1 : -0.16, dt);
    });
    paint("rearLsd", s.rear === "lsd" ? "lsd" : "idle");
    axleBits.rear.lsd.visible = !!r.state.rearLsd || s.rear === "lsd";

    // half shafts and wheels
    C.WHEELS.forEach((w) => {
      const st = wheelState(w);
      const f = r.wheels[w].force;
      paint("half-" + w, st === "spin" ? "slip" : st === "brake" ? "brake" : f > 1e-6 ? "active" : turning(raw[w]) ? "passive" : "idle", T01(f * 2));
      const ringState = { grip: "grip", spin: "slip", brake: "brake", idle: "idle", air: "idle" }[st];
      paintMat(wheelBits[w].ringMat, ringState);
      paintMat(wheelBits[w].calMat, st === "brake" ? "brake" : "idle");
    });

    // tiles
    C.WHEELS.forEach((w) => {
      setTile(w, r.state.surfaces[w]);
      tiles[w].edge.material.opacity = hover === w ? 0.9 : 0;
    });
  }

  function paintMat(m, state) {
    parts.__tmp = [m];
    paint("__tmp", state, 1);
    delete parts.__tmp;
  }

  const DIFF_NAMES = { open: "OPEN", locked: "LOCKED", lsd: "LSD", tc: "OPEN + TRC" };
  const STATE_WORDS = { grip: "PUSHING", spin: "SPINNING", brake: "BRAKED BY TRC", idle: "NOT PUSHING", air: "IN THE AIR" };

  function updateLabels() {
    const r = result, s = r.splits;
    const centreWords = {
      rear: "2WD: FRONT NOT DRIVEN", locked: "CENTRE LOCKED", open: "OPEN CENTRE DIFF", torsen: "TORSEN CENTRE DIFF",
      tc: "OPEN CENTRE + TRC", clutch: r.clutch === "open" ? "CLUTCH OPEN: REAR ONLY" : r.clutch === "max" ? "CLUTCH AT ITS LIMIT" : "CLUTCH FEEDING THE FRONT"
    };
    tcLabel.el.innerHTML = "";
    const head = document.createElement("span");
    head.textContent = "TRANSFER CASE · " + r.mode.label;
    const sub = document.createElement("span");
    sub.className = "tag3d-sub";
    sub.textContent = centreWords[s.centre];
    tcLabel.el.append(head, sub);
    tcLabel.el.classList.toggle("is-lock", s.centre === "locked");
    ["front", "rear"].forEach((a) => {
      const off = a === "front" && s.centre === "rear";
      axleBits[a].label.el.textContent = a.toUpperCase() + " DIFF · " + (off ? "NOT DRIVEN" : DIFF_NAMES[s[a]]);
      axleBits[a].label.el.classList.toggle("is-lock", s[a] === "locked" && !off);
    });
    C.WHEELS.forEach((w) => {
      const st = wheelState(w);
      const sf = C.surface(r.wheels[w].surface);
      const el = wheelBits[w].label.el;
      el.innerHTML = "";
      const a = document.createElement("span");
      a.className = "tag3d-surface";
      a.textContent = sf.name;
      const b = document.createElement("span");
      b.className = "tag3d-state tag3d-state--" + st;
      b.textContent = st === "idle" && !r.wheels[w].driven ? "NOT DRIVEN" : STATE_WORDS[st];
      el.append(a, b);
    });
  }

  function placeLabels() {
    const wdt = canvas.clientWidth, hgt = canvas.clientHeight;
    labelLayer.classList.toggle("is-far", cam.sph.radius > 3.2); // the small part labels only when zoomed in
    const v = new T.Vector3();
    labels.forEach((l) => {
      v.copy(l.pos);
      rig.localToWorld(v);
      v.project(camera);
      const hidden = v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05;
      l.el.style.display = hidden ? "none" : "";
      l.el.style.transform = "translate(-50%, -100%) translate(" + ((v.x + 1) / 2) * wdt + "px, " + ((1 - v.y) / 2) * hgt + "px)";
    });
  }

  // ---------------------------------------------------------------- loop
  function frame(dt) {
    time += dt;
    const sp = stepSpeeds(dt);
    applyRotation(sp, dt);
    paintAll(dt);
    groundOffset -= (shown.v * dt) / 3.0; // the ground runs back as the vehicle drives forward (+z)
    C.WHEELS.forEach((w) => { if (tiles[w].mat.map) tiles[w].mat.map.offset.y = groundOffset; });
    if (!reduceMotion) C.WHEELS.forEach((w) => { if (wheelState(w) === "spin" && shown.wheel[w] > 6) emit(w, dt); });
    stepParticles(dt);
    rig.position.set(0, 0, 0);
    if (result.status === "bog" && !reduceMotion) rig.position.set((Math.random() - 0.5) * 0.008, (Math.random() - 0.5) * 0.006, 0);
    stepCamera(dt);
    renderer.render(scene, camera);
    placeLabels();
  }

  function loop(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t;
    frame(dt);
    raf = requestAnimationFrame(loop);
  }

  function runState() {
    const should = !reduceMotion && visible && !document.hidden && !!result;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }

  // Under reduced motion (or when paused) draw a few frames on demand.
  let kickRaf = 0;
  function kick() {
    if (running || !result || kickRaf) return;
    kickRaf = requestAnimationFrame(() => { kickRaf = 0; frame(0.05); if (cam.goal) kick(); });
  }

  function resize() {
    const wdt = box.clientWidth;
    const hgt = Math.max(420, Math.min(wdt * 0.72, window.innerHeight * 0.66));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(wdt, hgt, false);
    canvas.style.width = wdt + "px";
    canvas.style.height = hgt + "px";
    camera.aspect = wdt / hgt;
    camera.updateProjectionMatrix();
    if (result) frame(0);
  }

  // ---------------------------------------------------------------- set up
  function init(el, clickHandler) {
    canvas = el;
    box = canvas.parentElement;
    onWheelClick = clickHandler;
    labelLayer = document.createElement("div");
    labelLayer.className = "tags3d";
    labelLayer.setAttribute("aria-hidden", "true");
    box.appendChild(labelLayer);

    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    scene.fog = new T.Fog(0x040817, 9, 18);
    camera = new T.PerspectiveCamera(38, 1.4, 0.05, 60);

    scene.add(new T.HemisphereLight(0xbfdcff, 0x1a1408, 0.5));
    const sun = new T.DirectionalLight(0xffffff, 0.95);
    sun.position.set(-3, 6, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 15 });
    scene.add(sun);
    const rim = new T.DirectionalLight(0x4cc9ff, 0.5);
    rim.position.set(4, 3, -4);
    scene.add(rim);

    rig = new T.Group();
    scene.add(rig);
    buildGround();
    buildChassis();
    buildEngine();
    buildTransferCase();
    buildDriveline();
    buildWheels();
    buildParticles();

    const v = VIEWS.all;
    cam.target.fromArray(v.target);
    cam.sph.copy(sphFrom(new T.Vector3().fromArray(v.pos), cam.target));
    setUpOrbit();
    canvas.style.cursor = "grab";

    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(box);
    window.addEventListener("resize", resize);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; runState(); }).observe(canvas);
    }
    document.addEventListener("visibilitychange", runState);
  }

  function show(r) {
    result = r;
    updateLabels();
    runState();
    if (!running) { frame(0.05); kick(); }
  }

  return { init: init, show: show, focus: focus };
})();
