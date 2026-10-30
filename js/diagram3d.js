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
  const FZ = 1.45, RZ = -1.6;          // axle positions
  const FD = new T.Vector3(0.18, AY, FZ), RD = new T.Vector3(0, AY, RZ); // diff centres
  const MY = 0.56;                     // transfer case main shaft height
  const TCZ = -0.45;                   // transfer case centre
  const CHAIN_Z = -0.54;
  const FOUT = new T.Vector3(0.24, MY - 0.25, CHAIN_Z); // front output, in the case's lower lobe
  const WHEEL_POS = { fl: [-WX, FZ], fr: [WX, FZ], rl: [-WX, RZ], rr: [WX, RZ] };

  const COL = {
    active: 0x4cc9ff, passive: 0x6b7ea8, idle: 0x323a52, lock: 0xffc857,
    slip: 0xff5d73, heat: 0xff8a3c, brake: 0xffb347, grip: 0x3ef08a, lsd: 0xb49bff
  };

  // ---------------------------------------------------------------- state
  let renderer, scene, camera, rig, box, canvas, labelLayer;
  let world; // the ground and the vehicle together, tilted to the slope (front up)
  const X_AXIS = new T.Vector3(1, 0, 0);
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

  const steel = new T.MeshStandardMaterial({ color: 0x5a6788, metalness: 0.75, roughness: 0.38, transparent: true, opacity: 0.35, depthWrite: false });
  // The frame, springs and shocks fade when zoomed in, so they don't hide the gears.
  const chassisMats = [steel];
  const rubber = new T.MeshStandardMaterial({ color: 0x15181f, metalness: 0.05, roughness: 0.92 });
  const rimMat = new T.MeshStandardMaterial({ color: 0x9aa6c2, metalness: 0.85, roughness: 0.25 });

  // Shapes shared with the diff demo (js/shapes3d.js).
  const { glass, rod, gear, coneGear, ringGear, along, collarMesh, bevel: BEVEL } = window.SYS_SHAPES;

  // Register something that turns about its own Y axis at the speed of `name`.
  // Its orientation moves to a holder and only the spin stays on the object:
  // with both on one object, three.js would turn it about the parent's Y axis
  // (Euler order XYZ), not its own, and it would tumble.
  function turns(name, obj, factor) {
    const holder = new T.Group();
    holder.rotation.copy(obj.rotation);
    obj.rotation.set(0, 0, 0);
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

  const springs = [];

  // ---------------------------------------------------------------- the chassis
  // Kept light (owner, 2026-10-30: the frame was hiding the drivetrain): two
  // see-through rails with a crossmember at each end, springs and shocks.
  function buildChassis() {
    [-0.55, 0.55].forEach((x) => {
      const rail = new T.Mesh(new T.BoxGeometry(0.06, 0.12, 4.2), steel);
      rail.position.set(x, 0.95, -0.05);
      rig.add(rail);
    });
    [1.95, -2.1].forEach((z) => {
      const cm = new T.Mesh(new T.BoxGeometry(1.1, 0.06, 0.06), steel);
      cm.position.set(0, 0.95, z);
      rig.add(cm);
    });
    const helix = new T.Curve();
    helix.getPoint = function (t) {
      const a = t * Math.PI * 2 * 5.5;
      return new T.Vector3(Math.cos(a) * 0.075, 0.5 + t * 0.39, Math.sin(a) * 0.075);
    };
    const springGeo = new T.TubeGeometry(helix, 160, 0.011, 6, false);
    const springMat = new T.MeshStandardMaterial({ color: 0xc8d2ea, metalness: 0.7, roughness: 0.3, transparent: true });
    const shockMat = new T.MeshStandardMaterial({ color: 0xffc857, metalness: 0.4, roughness: 0.4, transparent: true });
    chassisMats.push(springMat, shockMat);
    [[-0.55, FZ], [0.55, FZ], [-0.55, RZ], [0.55, RZ]].forEach(([x, z]) => {
      const sp = new T.Mesh(springGeo, springMat);
      sp.position.set(x, 0, z);
      springs.push({ mesh: sp, x: x, z: z });
      rig.add(sp);
      const shock = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.42, 10), shockMat);
      shock.position.set(x + (x < 0 ? 0.13 : -0.13), 0.7, z + (z > 0 ? 0.14 : -0.14));
      shock.rotation.z = x < 0 ? -0.25 : 0.25;
      rig.add(shock);
    });
  }

  // ---------------------------------------------------------------- engine, gearbox
  // A box with rounded edges, centred on the origin.
  function roundedBox(w, h, d, r) {
    const b = r * 0.6;
    const W = w - 2 * b, H = h - 2 * b, x = -W / 2, y = -H / 2, c = Math.min(r, W / 2, H / 2);
    const s = new T.Shape();
    s.moveTo(x + c, y);
    s.lineTo(x + W - c, y); s.quadraticCurveTo(x + W, y, x + W, y + c);
    s.lineTo(x + W, y + H - c); s.quadraticCurveTo(x + W, y + H, x + W - c, y + H);
    s.lineTo(x + c, y + H); s.quadraticCurveTo(x, y + H, x, y + H - c);
    s.lineTo(x, y + c); s.quadraticCurveTo(x, y, x + c, y);
    const geo = new T.ExtrudeGeometry(s, { depth: d - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 6 });
    geo.translate(0, 0, -(d - 2 * b) / 2);
    return geo;
  }

  // A shape's outline extruded along z and centred, for the block and the sump.
  function prism(points, length, bevel) {
    const s = new T.Shape();
    points.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    s.closePath();
    const b = bevel || 0.012;
    const geo = new T.ExtrudeGeometry(s, { depth: length - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2 });
    geo.translate(0, 0, -(length - 2 * b) / 2);
    return geo;
  }

  // An inline-four: see-through block and head with the pistons, rods and
  // crank moving inside; rocker cover, sump, intake on the left, exhaust on
  // the right, pulleys and belt at the front. Origin = the crank's axis, in
  // line with the gearbox.
  const ENGINE_Z = 0.75;
  const CRANK_R = 0.035, ROD_L = 0.15;
  const CYL_Z = [0.27, 0.09, -0.09, -0.27], CYL_PHASE = [0, Math.PI, Math.PI, 0];
  const engineBits = { pistons: [], rods: [] };
  function buildEngine() {
    const eng = new T.Group();
    eng.position.set(0, MY, ENGINE_Z);
    rig.add(eng);
    const coreMat = reg("engine", flowMat());
    const metal = (c, o) => new T.MeshStandardMaterial(Object.assign({ color: c, metalness: 0.7, roughness: 0.35 }, o || {}));

    // block: wider at the deck than at the skirt
    eng.add(glass(prism([[-0.13, -0.05], [0.13, -0.05], [0.17, 0.27], [-0.17, 0.27]], 0.76), 0x4cc9ff, 0.14));
    // cylinder head and rocker cover
    const head = glass(roundedBox(0.36, 0.08, 0.78, 0.02), 0x4cc9ff, 0.14);
    head.position.y = 0.31;
    eng.add(head);
    const cover = new T.Mesh(roundedBox(0.26, 0.06, 0.7, 0.028), metal(0x1d2742, { emissive: 0x0b3a66, emissiveIntensity: 0.5 }));
    cover.position.y = 0.38;
    cover.castShadow = true;
    eng.add(cover);
    for (let i = 0; i < 5; i++) { // ribs on the cover
      const rib = new T.Mesh(new T.BoxGeometry(0.2, 0.012, 0.012), metal(0x4cc9ff, { emissive: 0x4cc9ff, emissiveIntensity: 0.35 }));
      rib.position.set(0, 0.413, -0.24 + i * 0.12);
      eng.add(rib);
    }
    const cap = new T.Mesh(new T.CylinderGeometry(0.025, 0.025, 0.025, 16), metal(0xffc857));
    cap.position.set(0.06, 0.42, 0.2);
    eng.add(cap);
    // sump
    const pan = new T.Mesh(prism([[-0.13, -0.05], [0.13, -0.05], [0.1, -0.17], [-0.1, -0.17]], 0.6, 0.01), metal(0x3b4560, { transparent: true, opacity: 0.75 }));
    pan.position.z = 0.04;
    eng.add(pan);

    // crank, rods and pistons
    const crank = new T.Group();
    crank.add(along(new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.86, 12), coreMat), "z"));
    CYL_Z.forEach((z, i) => {
      const web = new T.Mesh(new T.BoxGeometry(0.03, CRANK_R + 0.04, 0.025), coreMat);
      web.position.set(CRANK_R * Math.sin(CYL_PHASE[i]) / 2, CRANK_R * Math.cos(CYL_PHASE[i]) / 2, z);
      web.rotation.z = -CYL_PHASE[i];
      crank.add(web);
      const rod = new T.Mesh(new T.CylinderGeometry(0.011, 0.011, ROD_L, 8), coreMat);
      eng.add(rod);
      engineBits.rods.push(rod);
      const piston = new T.Mesh(new T.CylinderGeometry(0.062, 0.062, 0.07, 24), coreMat);
      eng.add(piston);
      engineBits.pistons.push(piston);
    });
    eng.add(crank);
    engineBits.crank = crank;

    // intake: plenum and four runners on the left
    const intakeMat = metal(0x2c3448);
    const plenum = new T.Mesh(roundedBox(0.08, 0.09, 0.52, 0.03), intakeMat);
    plenum.position.set(-0.28, 0.27, 0);
    eng.add(plenum);
    CYL_Z.forEach((z) => {
      const run = along(new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.1, 10), intakeMat), "x");
      run.position.set(-0.21, 0.3, z);
      eng.add(run);
    });
    const throttle = along(new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.06, 16), intakeMat), "z");
    throttle.position.set(-0.28, 0.27, 0.29);
    eng.add(throttle);
    // exhaust: four pipes from the head on the right into one down pipe
    const exMat = metal(0x9a7058, { roughness: 0.45 });
    CYL_Z.forEach((z) => {
      const curve = new T.QuadraticBezierCurve3(new T.Vector3(0.18, 0.3, z), new T.Vector3(0.27, 0.3, z), new T.Vector3(0.25, 0.1, z * 0.4 - 0.12));
      eng.add(new T.Mesh(new T.TubeGeometry(curve, 16, 0.02, 8), exMat));
    });
    const down = new T.Mesh(new T.TubeGeometry(new T.QuadraticBezierCurve3(new T.Vector3(0.25, 0.1, -0.12), new T.Vector3(0.3, -0.04, -0.3), new T.Vector3(0.32, -0.08, -0.55)), 16, 0.03, 10), exMat);
    eng.add(down);

    // front: timing cover, crank pulley, water pump and alternator, belt
    const tcov = glass(roundedBox(0.28, 0.36, 0.04, 0.03), 0x4cc9ff, 0.12);
    tcov.position.set(0, 0.13, 0.405);
    eng.add(tcov);
    const pulleys = [[0, 0, 0.075], [0, 0.22, 0.045], [0.16, 0.24, 0.04]];
    pulleys.forEach(([x, y, r], i) => {
      const p = turns("input", along(new T.Mesh(new T.CylinderGeometry(r, r, 0.03, 24), i ? rimMat : coreMat), "z"));
      p.position.set(x, y, 0.445);
      eng.add(p);
    });
    const belt = new T.CatmullRomCurve3([
      new T.Vector3(0, -0.08, 0.445), new T.Vector3(0.075, 0, 0.445), new T.Vector3(0.2, 0.22, 0.445),
      new T.Vector3(0.16, 0.285, 0.445), new T.Vector3(0, 0.27, 0.445), new T.Vector3(-0.05, 0.2, 0.445), new T.Vector3(-0.078, 0, 0.445)
    ], true);
    eng.add(new T.Mesh(new T.TubeGeometry(belt, 60, 0.008, 6, true), metal(0x111318, { roughness: 0.8, metalness: 0.1 })));
    label("ENGINE", new T.Vector3(0, MY + 0.55, ENGINE_Z));

    // gearbox: a cast bellhousing tapering to the main case and tail
    const prof = [[0.05, 0], [0.205, 0], [0.215, 0.03], [0.2, 0.12], [0.15, 0.19], [0.14, 0.3], [0.12, 0.38], [0.08, 0.42], [0.06, 0.48]]
      .map(([r, y]) => new T.Vector2(r, y));
    const gb = glass(new T.LatheGeometry(prof, 36), 0x4cc9ff, 0.12);
    gb.rotation.x = -Math.PI / 2; // the lathe's axis (Y) runs back along -z
    gb.position.set(0, MY, ENGINE_Z - 0.43);
    rig.add(gb);
    [0.22, 0.27, 0.33].forEach((y) => { // ribs on the case
      const rib = new T.Mesh(new T.TorusGeometry(0.145 - (y - 0.22) * 0.25, 0.006, 6, 36), metal(0x4cc9ff, { emissive: 0x4cc9ff, emissiveIntensity: 0.3, transparent: true, opacity: 0.6 }));
      rib.position.set(0, MY, ENGINE_Z - 0.43 - y);
      rig.add(rib);
    });
    const tower = new T.Mesh(new T.CylinderGeometry(0.03, 0.045, 0.12, 16), metal(0x2c3448));
    tower.position.set(0, MY + 0.19, ENGINE_Z - 0.43 - 0.3);
    rig.add(tower);
    const lever = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 0.16, 8), metal(0x8d99b5));
    lever.position.set(0, MY + 0.32, ENGINE_Z - 0.43 - 0.3);
    rig.add(lever);
    const gbShaft = turns("input", along(new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.5, 10), reg("input", flowMat())), "z"));
    gbShaft.position.set(0, MY, ENGINE_Z - 0.43 - 0.22);
    rig.add(gbShaft);
    label("GEARBOX", new T.Vector3(0, MY + 0.42, ENGINE_Z - 0.75), "tag3d--small");
  }

  // Pistons and rods follow the crank: an inline-four, pistons 1 and 4 together.
  function moveEngine(crankAngle) {
    engineBits.crank.rotation.z = -crankAngle;
    CYL_Z.forEach((z, i) => {
      const th = crankAngle + CYL_PHASE[i];
      const px = CRANK_R * Math.sin(th), py = CRANK_R * Math.cos(th);
      const pinY = py + Math.sqrt(ROD_L * ROD_L - px * px);
      const rod = engineBits.rods[i];
      rod.position.set(px / 2, (py + pinY) / 2, z);
      rod.rotation.z = Math.atan2(px, pinY - py);
      engineBits.pistons[i].position.set(0, pinY + 0.02, z);
    });
  }

  // ---------------------------------------------------------------- transfer case
  // Shaped like a chain-drive transfer case (owner, 2026-10-30: fewer gears,
  // and the right shape for each system): a casting with two round lobes, the
  // main shaft in the top one and the front output in the bottom one, a bell
  // at the front and a tail housing round the rear output. Every system has
  // the same planetary low range at the front and chain at the back; only the
  // piece between them changes:
  //   part-time: a 2-4 collar that locks the chain sprocket to the main shaft;
  //   Torsen / planetary: a helical planetary centre diff (+ CDL collar);
  //   multi-mode SSII: a bevel centre diff (+ lock collar);
  //   multi-mode TOD: a wet clutch pack in a drum on the sprocket.
  // Along the main shaft (z): low range -0.26, range collar -0.29 (H) /
  // -0.32 (L), centre unit -0.42, chain sprocket -0.54, tail to -0.75.
  // Low range: sun 0.06 on the input, three planets 0.028, a fixed ring
  // 0.116; the carrier turns 1 + 0.116/0.06 = 2.93 times slower.
  const LR = { sun: 0.06, planet: 0.028, ring: 0.116 };
  const LR_RATIO = 1 + LR.ring / LR.sun;
  const CU_Z = -0.42;
  let tcGroups = {};
  let tcLabel = null;

  // The casting's outline: the convex hull of the two lobes.
  function caseShape(rMain, rFront) {
    const pts = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      pts.push([Math.cos(a) * rMain, MY + Math.sin(a) * rMain]);
      pts.push([FOUT.x + Math.cos(a) * rFront, FOUT.y + Math.sin(a) * rFront]);
    }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    pts.forEach((p) => { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); });
    pts.slice().reverse().forEach((p) => { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); });
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    const sh = new T.Shape();
    hull.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
    sh.closePath();
    return sh;
  }

  function buildTransferCase() {
    const tc = new T.Group();
    rig.add(tc);
    // the casting: body, front bell, tail housing, front output boss
    const body = glass(new T.ExtrudeGeometry(caseShape(0.165, 0.13), { depth: 0.38, bevelEnabled: false, curveSegments: 4 }), 0x9fd8ff, 0.09);
    body.position.z = -0.58; // extrudes towards +z: -0.58 .. -0.2
    tc.add(body);
    const bell = glass(new T.CylinderGeometry(0.15, 0.17, 0.05, 32), 0x9fd8ff, 0.09);
    along(bell, "z");
    bell.position.set(0, MY, -0.175);
    tc.add(bell);
    const tail = glass(new T.CylinderGeometry(0.06, 0.085, 0.17, 24), 0x9fd8ff, 0.09);
    along(tail, "z");
    tail.position.set(0, MY, -0.665);
    tc.add(tail);
    const boss = glass(new T.CylinderGeometry(0.055, 0.07, 0.08, 20), 0x9fd8ff, 0.09);
    along(boss, "z");
    boss.position.set(FOUT.x, FOUT.y, -0.16);
    tc.add(boss);
    tcLabel = label("TRANSFER CASE", new T.Vector3(0.12, FOUT.y - 0.2, -0.4), "tag3d--tc");

    // input shaft, carrying the low range's sun gear
    const inMat = reg("input", flowMat());
    const s1 = turns("input", along(new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.16, 10), inMat), "z"));
    s1.position.set(0, MY, -0.2);
    tc.add(s1);

    // planetary low range: sun on the input, ring fixed in the case, carrier out
    const lr = new T.Group();
    lr.position.set(0, MY, -0.26);
    lr.rotation.x = Math.PI / 2; // local Y -> world +Z
    const sun = gear(LR.sun, 0.04, 20, inMat);
    lr.add(sun);
    lr.add(ringGear(LR.ring, 0.04, 40, reg("lrRing", flowMat())));
    const carrier = new T.Group();
    const pMat = reg("lrPlanets", flowMat());
    const planets = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = gear(LR.planet, 0.036, 10, pMat);
      p.position.set(Math.cos(a) * (LR.sun + LR.planet), 0, Math.sin(a) * (LR.sun + LR.planet));
      carrier.add(p);
      planets.push(p);
    }
    const plate = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.008, 36), pMat); // carrier plate, behind
    plate.position.y = -0.026;
    carrier.add(plate);
    lr.add(carrier);
    tc.add(lr);
    tcGroups.lr = { sun: sun, carrier: carrier, planets: planets };
    label("LOW RANGE", new T.Vector3(-0.2, MY + 0.2, -0.26), "tag3d--small");

    // the main shaft, from the range collar to the rear output
    const s2 = turns("centreIn", along(new T.Mesh(new T.CylinderGeometry(0.024, 0.024, 0.16, 10), reg("centreIn", flowMat())), "z"));
    s2.position.set(0, MY, -0.36);
    tc.add(s2);
    const s3 = turns("main", along(new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 0.31, 10), reg("main", flowMat())), "z"));
    s3.position.set(0, MY, -0.6);
    tc.add(s3);
    // range collar: forward onto the sun's hub (H) or back onto the carrier (L)
    const rc = turns("centreIn", along(collarMesh(0.045, reg("rangeCollar", flowMat())), "z"));
    rc.position.set(0, MY, -0.3);
    tc.add(rc);
    tcGroups.rangeCollar = rc;

    // chain: drive sprocket on the main shaft, driven sprocket on the front output
    const chMat = reg("chain", flowMat());
    const ds = turns("front", along(gear(0.1, 0.035, 22, chMat), "z"));
    ds.position.set(0, MY, CHAIN_Z);
    tc.add(ds);
    const fs = turns("front", along(gear(0.1, 0.035, 22, chMat), "z"));
    fs.position.copy(FOUT);
    tc.add(fs);
    chain = buildChain(chMat);
    tc.add(chain.group);
    const fShaft = turns("front", along(new T.Mesh(new T.CylinderGeometry(0.026, 0.026, 0.44, 10), reg("frontOut", flowMat())), "z"));
    fShaft.position.set(FOUT.x, FOUT.y, FOUT.z + 0.22);
    tc.add(fShaft);

    tcGroups.chain = buildPartTimeCentre(tc);
    tcGroups.planetary = buildPlanetary(tc);
    tcGroups.bevel = buildBevelCentre(tc);
    tcGroups.clutch = buildClutch(tc);
    tcGroups.cuLabel = label("", new T.Vector3(-0.22, MY + 0.22, CU_Z - 0.04), "tag3d--small");
  }

  // The chain: links running round both sprockets.
  function buildChain(mat) {
    const g = new T.Group();
    const A = new T.Vector2(0, MY), B = new T.Vector2(FOUT.x, FOUT.y), r = 0.108;
    const d = new T.Vector2().subVectors(B, A), len = d.length(), u = d.clone().normalize();
    const n = new T.Vector2(-u.y, u.x);
    const L = 2 * len + 2 * Math.PI * r;
    const N = 48;
    const links = [];
    const geo = new T.BoxGeometry(0.028, 0.012, 0.03);
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
      radius: r,
      move(offset) {
        for (let i = 0; i < N; i++) {
          const p = at(offset + (i / N) * L), q = at(offset + (i / N) * L + 0.01);
          links[i].position.set(p.x, p.y, CHAIN_Z);
          links[i].rotation.z = Math.atan2(q.y - p.y, q.x - p.x);
        }
      }
    };
  }

  // Part-time: no centre diff. The 2-4 collar on the main shaft slides onto
  // the sprocket's dogs (4H/4L), joining the front to the rear.
  function buildPartTimeCentre(tc) {
    const g = new T.Group();
    const c = turns("main", along(collarMesh(0.055, reg("centreLock", flowMat())), "z"));
    c.position.set(0, MY, -0.48);
    g.add(c);
    tcGroups.centreCollar = c;
    tc.add(g);
    return g;
  }

  // Full-time: a planetary centre diff with helical gears (as in a Torsen
  // type C). The main shaft drives the carrier; the planets drive the sun
  // (front, through a sleeve to the sprocket) and the ring (rear output).
  // The CDL collar locks the sun to the carrier.
  const PL = { sun: 0.04, planet: 0.04, orbit: 0.08, ring: 0.12 };
  function buildPlanetary(tc) {
    const g = new T.Group();
    g.position.set(0, MY, CU_Z);
    g.rotation.x = Math.PI / 2; // local Y -> world +Z
    const sun = gear(PL.sun, 0.06, 12, reg("chain", flowMat()), 0.45);
    g.add(sun);
    const ring = ringGear(PL.ring, 0.06, 36, reg("main", flowMat()), 0.45);
    g.add(ring);
    const carrier = new T.Group();
    const cMat = reg("planets", flowMat());
    const planets = [];
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = gear(PL.planet, 0.055, 12, cMat, -0.45);
      p.position.set(Math.cos(a) * PL.orbit, 0, Math.sin(a) * PL.orbit);
      carrier.add(p);
      planets.push(p);
    }
    const plate = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.008, 36), cMat);
    plate.position.y = 0.038;
    carrier.add(plate);
    g.add(carrier);
    const cdl = collarMesh(0.05, reg("centreLock", flowMat()));
    cdl.position.y = -0.065;
    g.add(cdl);
    tcGroups.cdlCollar = cdl;
    tcGroups.pl = { sun: sun, ring: ring, carrier: carrier, planets: planets, cdl: cdl };
    tc.add(g);
    return g;
  }

  // A bevel diff, axis = local Y: a carrier (case, cross pin, two spider
  // gears) between two side gears, all 45-degree bevel gears with one apex.
  // ringSide: +1 / -1 puts a ring gear on the carrier on that side; 0, none.
  function bevelDiff(prefix, ringSide) {
    const g = new T.Group();
    const carrier = new T.Group();
    const caseMat = reg(prefix + "Carrier", flowMat());
    caseMat.transparent = true; caseMat.opacity = 0.28; caseMat.depthWrite = false; caseMat.side = T.DoubleSide;
    carrier.add(new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 0.15, 32, 1, true), caseMat));
    const spMat = reg(prefix + "Spider", flowMat());
    const pin = new T.Mesh(new T.CylinderGeometry(0.011, 0.011, 0.21, 8), spMat);
    pin.rotation.z = Math.PI / 2; // along local X
    carrier.add(pin);
    const spiders = [];
    [1, -1].forEach((s) => {
      const h = new T.Group();
      h.rotation.z = -s * Math.PI / 2; // local Y -> +X or -X
      const sg = coneGear(45, 0.05, 0.095, 12, spMat);
      h.add(sg);
      carrier.add(h);
      spiders.push(sg);
    });
    let ring = null;
    if (ringSide) {
      const ringMat = reg(prefix + "Ring", flowMat());
      const h = new T.Group();
      if (ringSide < 0) h.rotation.x = Math.PI;
      ring = coneGear(BEVEL.ringAngle, 0.13, 0.19, BEVEL.ringTeeth, ringMat);
      h.add(ring);
      ringMat.side = T.DoubleSide;
      const web = new T.Mesh(new T.RingGeometry(0.1, 0.132, 40), ringMat); // the ring's flange, bolted to the carrier
      web.rotation.x = -Math.PI / 2;
      web.position.y = 0.05;
      h.add(web);
      carrier.add(h);
    }
    g.add(carrier);
    const sides = [];
    [1, -1].forEach((s) => {
      const h = new T.Group();
      if (s < 0) h.rotation.x = Math.PI;
      const sg = coneGear(45, 0.05, 0.095, 12, reg(prefix + (s > 0 ? "SidePlus" : "SideMinus"), flowMat()));
      h.add(sg);
      g.add(h);
      sides.push(sg);
    });
    return { group: g, carrier: carrier, spiders: spiders, plus: sides[0], minus: sides[1], ring: ring };
  }

  // Multi-mode (SSII): an open bevel centre diff. The main shaft drives the
  // carrier; the side gear at the back drives the sprocket (front), the one
  // at the front the inner shaft to the rear output. 4HLc / 4LLc slide a
  // collar that locks the rear side gear to the carrier.
  function buildBevelCentre(tc) {
    const g = new T.Group();
    g.position.set(0, MY, CU_Z);
    g.rotation.x = -Math.PI / 2; // local Y -> world -Z: the plus side faces the sprocket
    const d = bevelDiff("cd", 0);
    g.add(d.group);
    // the lock: a sleeve round the carrier that slides back onto the sprocket's hub
    const lc = collarMesh(0.125, reg("centreLock", flowMat()));
    lc.position.y = -0.03;
    g.add(lc);
    tcGroups.bevelCollar = lc;
    tcGroups.cd = d;
    tc.add(g);
    return g;
  }

  // Multi-mode (TOD): no diff. Inner plates turn with the main shaft, outer
  // plates with a drum on the chain sprocket; the electromagnet in front
  // clamps the pack: open (2H), slipping (4A, feeding the front), clamped (4H/4L).
  function buildClutch(tc) {
    const g = new T.Group();
    g.position.set(0, MY, CU_Z);
    const plates = [];
    for (let i = 0; i < 9; i++) {
      const outer = i % 2 === 0;
      const m = reg(outer ? "clutchOuter" : "clutchInner", flowMat());
      const p = new T.Group();
      const r = outer ? 0.125 : 0.11;
      p.add(new T.Mesh(new T.CylinderGeometry(r, r, 0.008, 36), m));
      for (let k = 0; k < 6; k++) { // tabs: outer plates to the drum, inner ones to the shaft
        const a = (k / 6) * Math.PI * 2;
        const tab = new T.Mesh(new T.BoxGeometry(0.02, 0.01, 0.02), m);
        const rr = outer ? r + 0.007 : 0.04;
        tab.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr);
        p.add(tab);
      }
      const h = turns(outer ? "front" : "main", along(p, "z"));
      g.add(h);
      plates.push(h);
    }
    // the drum, joined to the sprocket behind it
    const drum = new T.Mesh(new T.CylinderGeometry(0.142, 0.142, 0.14, 40, 1, true),
      reg("clutchDrum", new T.MeshStandardMaterial({ color: 0x6b7ea8, transparent: true, opacity: 0.2, depthWrite: false, side: T.DoubleSide })));
    drum.rotation.x = Math.PI / 2;
    drum.position.z = -0.05;
    g.add(drum);
    const coil = new T.Mesh(new T.TorusGeometry(0.08, 0.022, 8, 36), new T.MeshStandardMaterial({ color: 0xb87333, metalness: 0.7, roughness: 0.35 }));
    coil.position.z = 0.055;
    g.add(coil);
    tcGroups.plates = plates;
    tc.add(g);
    return g;
  }

  // ---------------------------------------------------------------- props and axles
  // The ring gear sits on the far side of the front diff from the rear one
  // (front: -x, rear: +x), so both prop shafts turn the same way, as on a
  // real vehicle. Pinions point at the transfer case.
  const PIN_REACH = 0.28;
  function buildDriveline() {
    const rp = rod(new T.Vector3(0, MY, -0.75), new T.Vector3(RD.x, AY, RZ + PIN_REACH), 0.035, reg("rearProp", flowMat()));
    rig.add(rp);
    const fp = rod(new T.Vector3(FOUT.x, FOUT.y, FOUT.z + 0.44), new T.Vector3(FD.x, AY, FZ - PIN_REACH), 0.032, reg("frontProp", flowMat()));
    rig.add(fp);
    [[0, MY, -0.75, "rearProp"], [RD.x, AY, RZ + PIN_REACH, "rearProp"], [FOUT.x, FOUT.y, FOUT.z + 0.44, "frontProp"], [FD.x, AY, FZ - PIN_REACH, "frontProp"]].forEach((p) => {
      const uj = new T.Mesh(new T.SphereGeometry(0.045, 12, 10), reg(p[3], flowMat()));
      uj.position.set(p[0], p[1], p[2]);
      rig.add(uj);
    });
    buildAxle("front", FD, -1);
    buildAxle("rear", RD, 1);
  }

  // An axle: banjo housing; ring and pinion; the bevel diff; the locker's dog
  // collar on the side away from the ring (and an LSD clutch pack on the
  // rear); half shafts inside see-through tubes.
  const axleBits = {};
  function buildAxle(name, D, ringSide) {
    const g = new T.Group();
    g.position.copy(D);
    rig.add(g);
    const toProp = name === "front" ? -1 : 1; // the pinion points at the transfer case
    g.add(glass(new T.SphereGeometry(0.25, 24, 16), 0x9fd8ff, 0.08));
    const tubeMat = new T.MeshStandardMaterial({ color: 0x3b4560, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.28, depthWrite: false });
    [-1, 1].forEach((s) => {
      const a = s * 0.22, b = s * (WX - 0.17) - D.x; // housing to hub, in the axle's own space
      const tube = along(new T.Mesh(new T.CylinderGeometry(0.06, 0.06, Math.abs(b - a), 16), tubeMat), "x");
      tube.position.x = (a + b) / 2;
      g.add(tube);
    });
    // the diff itself, its axis along the axle (local Y -> world +X)
    const dh = new T.Group();
    dh.rotation.z = -Math.PI / 2;
    const d = bevelDiff(name, ringSide);
    dh.add(d.group);
    g.add(dh);
    // the pinion: a 13.7-degree bevel gear whose apex meets the ring gear's
    const ph = new T.Group();
    ph.rotation.x = toProp * Math.PI / 2; // local Y -> world +Z (rear) or -Z (front)
    const pMat = reg(name + "Prop", flowMat());
    const pin = coneGear(BEVEL.pinionAngle, 0.13, 0.19, BEVEL.pinionTeeth, pMat);
    const pShaft = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, PIN_REACH - 0.17, 10), pMat);
    pShaft.position.y = (PIN_REACH + 0.17) / 2;
    pin.add(pShaft);
    ph.add(pin);
    g.add(ph);
    // half shafts, from the side gears out to the hubs
    const left = name === "front" ? "fl" : "rl", right = name === "front" ? "fr" : "rr";
    [[left, -1], [right, 1]].forEach(([w, s]) => {
      const a = s * 0.06, b = s * WX - D.x;
      const shaft = along(new T.Mesh(new T.CylinderGeometry(0.022, 0.022, Math.abs(b - a), 10), reg("half-" + w, flowMat())), "x");
      const sh = turns("side-" + w, shaft, -1); // along() points local Y at -X, so turn it backwards
      sh.position.x = (a + b) / 2;
      g.add(sh);
    });
    // locker: dog collar on the half shaft on the side away from the ring
    const cs = -ringSide;
    const collar = turns("side-" + (cs < 0 ? left : right), along(collarMesh(0.045, reg(name + "Lock", flowMat())), "x"), -1);
    collar.position.x = cs * 0.17;
    g.add(collar);
    const lsd = new T.Group();
    if (name === "rear") {
      [-1, 1].forEach((s) => {
        for (let i = 0; i < 3; i++) {
          const disc = along(new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.005, 24), reg("rearLsd", flowMat())), "x");
          disc.position.x = s * (0.07 + i * 0.007);
          lsd.add(disc);
        }
      });
      g.add(lsd);
    }
    axleBits[name] = { g: g, d: d, collar: collar, collarSide: cs, lsd: lsd, pin: pin, toProp: toProp, ringSide: ringSide };
    axleBits[name].label = label(name.toUpperCase() + " DIFF", new T.Vector3(D.x, D.y + 0.34, D.z));
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
      // low traction: brown dirt, loose stones, a few darker wet patches
      g.fillStyle = "#5a3f26"; g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 900; i++) {
        const k = rnd();
        g.fillStyle = "rgba(" + (95 + k * 50 | 0) + "," + (68 + k * 34 | 0) + "," + (40 + k * 22 | 0) + "," + (0.35 + rnd() * 0.4) + ")";
        g.fillRect(rnd() * 256, rnd() * 512, 2, 2);
      }
      g.fillStyle = "rgba(25, 15, 6, 0.35)";
      for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse(rnd() * 256, rnd() * 512, 16 + rnd() * 26, 8 + rnd() * 12, rnd() * 3, 0, Math.PI * 2); g.fill(); }
      for (let i = 0; i < 160; i++) { // stones, lit from the top left
        const x = rnd() * 256, y = rnd() * 512, rx = 2 + rnd() * 7, ry = rx * (0.6 + rnd() * 0.4), sh = 110 + rnd() * 50 | 0;
        g.fillStyle = "rgba(20, 12, 6, 0.5)";
        g.beginPath(); g.ellipse(x + 1.5, y + 1.5, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgb(" + sh + "," + (sh * 0.88 | 0) + "," + (sh * 0.74 | 0) + ")";
        g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "rgba(255, 245, 225, 0.25)";
        g.beginPath(); g.ellipse(x - rx * 0.3, y - ry * 0.3, rx * 0.4, ry * 0.35, 0, 0, Math.PI * 2); g.fill();
      }
    } else if (kind === "ice") {
      // very low traction: pale blue ice, frosty patches, cracks
      const grd = g.createLinearGradient(0, 0, 256, 512);
      grd.addColorStop(0, "#cfe6f5"); grd.addColorStop(0.5, "#a9cde6"); grd.addColorStop(1, "#c4dff0");
      g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = "rgba(255, 255, 255, " + (0.15 + rnd() * 0.3) + ")";
        g.beginPath(); g.ellipse(rnd() * 256, rnd() * 512, 10 + rnd() * 30, 4 + rnd() * 12, rnd() * 3, 0, Math.PI * 2); g.fill();
      }
      for (let i = 0; i < 22; i++) {
        let x = rnd() * 256, y = rnd() * 512;
        g.strokeStyle = i % 3 ? "rgba(255, 255, 255, 0.7)" : "rgba(70, 110, 140, 0.45)";
        g.lineWidth = 0.8 + rnd();
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 50; y += (rnd() - 0.5) * 50; g.lineTo(x, y); }
        g.stroke();
      }
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
  const rockGeo = new T.DodecahedronGeometry(1, 0);
  const rockMats = [0x7a6550, 0x6a5848, 0x8a7a66].map((c) => new T.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }));
  let seed01 = 3;
  const rnd01 = () => (seed01 = (seed01 * 16807) % 2147483647) / 2147483647;
  function buildGround() {
    ["tar", "mud", "ice", "air"].forEach((k) => { TEX[k] = texture(k); });
    C.WHEELS.forEach((w) => {
      const [x, z] = WHEEL_POS[w];
      const mat = new T.MeshStandardMaterial({ map: TEX.tar, roughness: 0.9, metalness: 0.0 });
      const tile = new T.Mesh(new T.PlaneGeometry(2.4, 3.0), mat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(x < 0 ? -1.2 : 1.2, 0, z < 0 ? -1.5 : 1.5);
      tile.receiveShadow = true;
      tile.userData.wheel = w;
      world.add(tile);
      // the edge of the tile, lit when hovered
      const edge = new T.LineSegments(new T.EdgesGeometry(new T.PlaneGeometry(2.38, 2.98)),
        new T.LineBasicMaterial({ color: 0x4cc9ff, transparent: true, opacity: 0.0 }));
      edge.rotation.x = -Math.PI / 2;
      edge.position.copy(tile.position).setY(0.005);
      world.add(edge);
      // loose rocks, shown on low traction, rolling back under the vehicle
      const rocks = new T.Group();
      for (let i = 0; i < 26; i++) {
        const m = new T.Mesh(rockGeo, rockMats[i % rockMats.length]);
        const sz = 0.03 + rnd01() * 0.06;
        m.scale.set(sz * (0.8 + rnd01() * 0.5), sz * 0.6, sz * (0.8 + rnd01() * 0.6));
        m.rotation.set(rnd01() * 3, rnd01() * 3, rnd01() * 3);
        m.position.set(tile.position.x + (rnd01() - 0.5) * 2.2, sz * 0.25, 0);
        m.userData.z0 = rnd01() * 3;
        m.castShadow = true;
        m.receiveShadow = true;
        rocks.add(m);
      }
      rocks.visible = false;
      world.add(rocks);
      tiles[w] = { mesh: tile, mat: mat, edge: edge, kind: "tar", rocks: rocks, z0: tile.position.z - 1.5 };
    });
    // a faint floor beyond the tiles
    const grid = new T.GridHelper(14, 28, 0x1d3b6b, 0x0f2142);
    grid.position.y = -0.01;
    world.add(grid);
  }

  function setTile(w, kind) {
    const t = tiles[w];
    if (t.kind === kind) return;
    t.kind = kind;
    t.mat.map = TEX[kind].clone();
    t.mat.map.needsUpdate = true;
    t.mat.roughness = kind === "ice" ? 0.12 : kind === "mud" ? 0.55 : 0.9; // ice is glossy
    t.mat.metalness = kind === "ice" ? 0.15 : 0;
    t.mat.emissive = new T.Color(kind === "air" ? 0x0a2a55 : 0x000000);
    t.mat.emissiveIntensity = kind === "air" ? 0.4 : 0;
    // a wheel in the air: the tile drops away into a pit, so the tyre hangs free
    t.mesh.position.y = kind === "air" ? -0.55 : 0;
    t.rocks.visible = kind === "mud";
    t.mat.needsUpdate = true;
  }

  // Rocks roll back under the vehicle as it drives on.
  function stepRocks() {
    C.WHEELS.forEach((w) => {
      const t = tiles[w];
      if (!t.rocks.visible) return;
      t.rocks.children.forEach((m) => {
        m.position.z = t.z0 + ((((m.userData.z0 - travel) % 3) + 3) % 3);
      });
    });
  }

  // ---------------------------------------------------------------- suspension
  // Live axles: each wheel rides up and down over the rocks on low traction;
  // a wheel with no traction hangs down on its spring. The axle beam tilts
  // between its two wheels and the springs squash or stretch.
  const susp = { fl: 0, fr: 0, rl: 0, rr: 0 };
  let travel = 0;
  function suspension(dt) {
    travel += shown.v * dt;
    C.WHEELS.forEach((w, i) => {
      const kind = tiles[w].kind;
      let goal = 0;
      if (kind === "air") goal = -0.07;
      else if (kind === "mud" && !reduceMotion) {
        const ph = travel * 5 + i * 1.7;
        goal = 0.035 * Math.sin(ph) + 0.02 * Math.sin(ph * 2.3 + 1.1);
        if (wheelState(w) === "spin") goal += 0.012 * Math.sin(time * 23 + i); // chattering on the stones
      }
      susp[w] += (goal - susp[w]) * Math.min(1, dt * 10 || 1);
      wheelBits[w].outer.position.y = AY + susp[w];
    });
    [["front", "fl", "fr"], ["rear", "rl", "rr"]].forEach(([a, l, r]) => {
      const g = axleBits[a].g;
      g.position.y = AY + (susp[l] + susp[r]) / 2;
      g.rotation.z = Math.atan2(susp[r] - susp[l], 2 * WX);
    });
    springs.forEach((sp) => {
      const l = sp.z > 0 ? "fl" : "rl", r = sp.z > 0 ? "fr" : "rr";
      const dy = (susp[l] + susp[r]) / 2 + (sp.x / WX) * (susp[r] - susp[l]) / 2;
      const k = (0.39 - dy) / 0.39; // the coil runs from 0.5 + dy up to the frame at 0.89
      sp.mesh.scale.y = k;
      sp.mesh.position.y = 0.89 * (1 - k);
    });
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
    world.add(particles);
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
      f.c.setHex(kind === "mud" ? (Math.random() < 0.5 ? 0x7a5532 : 0x5a3f26) : kind === "ice" ? 0xeaf6ff : 0x9aa3b6);
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
    // in the scene's (mirrored) space: +x is the vehicle's left
    all:   { target: [-0.05, 0.35, -0.1],    pos: [4.3, 3.7, 2.7] },     // from the front left
    tcase: { target: [-0.1, MY - 0.08, -0.42], pos: [1.35, 0.72, 0.05] },
    front: { target: [-FD.x, AY, FZ],        pos: [-1.1, 0.74, 0.62] },  // from the right: the front ring gear is on the left
    rear:  { target: [-RD.x, AY, RZ],        pos: [0.9, 0.74, -0.78] }
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
    const near = cam.sph.radius < 2.6;
    chassisMats.forEach((m) => { m.opacity = near ? 0.08 : m === steel ? 0.35 : 0.85; m.depthWrite = false; });
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
    // the target is a point on the vehicle, so it rides up the slope with it.
    // Far out the camera stays level, so the slope shows; zoomed in on a part it
    // tilts with the vehicle (blending in from 3.2 m to 2 m), so the close-ups
    // look the same on any slope instead of ending up behind a tyre.
    const aim = cam.target.clone().applyAxisAngle(X_AXIS, world.rotation.x);
    const ride = Math.min(1, Math.max(0, (3.2 - cam.sph.radius) / 1.2)) * world.rotation.x;
    camera.position.setFromSpherical(cam.sph).applyAxisAngle(X_AXIS, ride).add(aim);
    camera.up.set(0, 1, 0).applyAxisAngle(X_AXIS, ride);
    camera.lookAt(aim);
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
    const spinV = low ? 6 / Math.sqrt(ratio) : 6;
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
    // a locked axle turns both its wheels together
    [["front", "fl", "fr"], ["rear", "rl", "rr"]].forEach(([a, l, r]) => {
      if (result.splits[a] === "locked" && !(a === "front" && result.splits.centre === "rear")) {
        out.wheel[l] = out.wheel[r] = Math.max(out.wheel[l], out.wheel[r]);
      }
    });
    raw = Object.assign({}, out.wheel); // before reduced motion stops them: the colours use these
    if (reduceMotion) out.v = 0;
    return out;
  }

  let raw = { fl: 0, fr: 0, rl: 0, rr: 0 }; // the model's wheel speeds

  // Every part's speed, worked back from the wheels through the real gear
  // ratios, so meshing teeth move together. All about the part's own axis.
  function stepSpeeds(dt) {
    const tg = targetSpeeds();
    const k = Math.min(1, dt * 3);
    shown.v += (tg.v - shown.v) * k;
    C.WHEELS.forEach((w) => { shown.wheel[w] += ((reduceMotion ? 0 : tg.wheel[w]) - shown.wheel[w]) * k; });
    const ww = shown.wheel, s = result.splits, sys = result.state.system;
    const frontDriven = s.centre !== "rear";
    const sp = {};
    C.WHEELS.forEach((w) => { sp["wheel-" + w] = ww[w]; sp["side-" + w] = ww[w]; });
    // 2H: free-wheeling hubs let the front wheels roll while the front driveline stands still
    if (!frontDriven) { sp["side-fl"] = 0; sp["side-fr"] = 0; }
    const cF = (sp["side-fl"] + sp["side-fr"]) / 2, cR = (sp["side-rl"] + sp["side-rr"]) / 2;
    sp.frontCarrier = cF; sp.rearCarrier = cR;
    sp.frontSpiders = (sp["side-fl"] - sp["side-fr"]) / 2;
    sp.rearSpiders = (sp["side-rl"] - sp["side-rr"]) / 2;
    // props about +z: each pinion turns 4.1 times per turn of its ring gear (41:10 teeth)
    let pF = -BEVEL.ratio * cF, pR = -BEVEL.ratio * cR;
    if (s.centre === "locked") { const m = (pF + pR) / 2; pF = pR = m; }
    sp.front = pF; sp.main = pR;
    sp.frontPinion = -pF; // the front pinion faces backwards
    sp.rearPinion = pR;
    // the centre unit's input
    let cin;
    if (sys === "torsen") cin = (PL.sun * pF + PL.ring * pR) / (PL.sun + PL.ring);
    else if (sys === "ss2") cin = (pF + pR) / 2;
    else cin = pR;
    if (s.centre === "rear") cin = pR;
    sp.centreIn = cin;
    sp.planetRel = -(pF - cin) * (PL.sun / PL.planet);
    sp.cdSpiders = (pF - pR) / 2;
    // low range: the sun is the input, the ring is fixed, the carrier turns
    // LR_RATIO times slower; the range collar takes the main shaft from the
    // sun (high) or the carrier (low)
    const input = result.low ? cin * LR_RATIO : cin;
    sp.input = input;
    sp.lrCarrier = input / LR_RATIO;
    sp.lrPlanetRel = -(input - sp.lrCarrier) * (LR.sun / LR.planet);
    // keep the fastest part slow enough to see, scaling everything together
    let max = 0;
    Object.keys(sp).forEach((n) => { max = Math.max(max, Math.abs(sp[n])); });
    const scale = max > 26 ? 26 / max : 1;
    Object.keys(sp).forEach((n) => { if (!/^wheel-/.test(n)) sp[n] *= scale; });
    return sp;
  }

  function applyRotation(sp, dt) {
    const add = (n, w) => { angle[n] = (angle[n] || 0) + (w || 0) * dt; return angle[n]; };
    Object.keys(spin).forEach((name) => {
      const a = add(name, sp[name]);
      spin[name].forEach((s) => {
        if (s.wheel) s.obj.rotation.x = a; // rolling forward (+z) turns about +x
        else s.obj.rotation.y = a * s.factor;
      });
    });
    // axle diffs: carrier with the ring, side gears with the half shafts, spiders between
    ["front", "rear"].forEach((ax) => {
      const b = axleBits[ax], d = b.d;
      d.carrier.rotation.y = add(ax + "C", sp[ax + "Carrier"]);
      const sp1 = add(ax + "S", sp[ax + "Spiders"]);
      d.spiders.forEach((g) => { g.rotation.y = sp1 + BEVEL.spiderPhase; }); // half a tooth: teeth in gaps
      const l = ax === "front" ? "fl" : "rl", r = ax === "front" ? "fr" : "rr";
      d.plus.rotation.y = angle["side-" + r] || 0;       // right side gear faces +x
      d.minus.rotation.y = -(angle["side-" + l] || 0);   // left one faces -x
      b.pin.rotation.y = add(ax + "Pin", sp[ax + "Pinion"]) + BEVEL.pinionPhase;
    });
    moveEngine((angle.input || 0) * 1.5);
    // low range
    const lr = tcGroups.lr;
    lr.sun.rotation.y = angle.input || 0;
    lr.carrier.rotation.y = add("lrC", sp.lrCarrier);
    const lp = add("lrP", sp.lrPlanetRel);
    lr.planets.forEach((p) => { p.rotation.y = lp; });
    // centre units
    const pl = tcGroups.pl;
    pl.sun.rotation.y = angle.front || 0;
    pl.ring.rotation.y = angle.main || 0;
    pl.carrier.rotation.y = angle.centreIn || 0;
    const pr = add("planetRel", sp.planetRel);
    pl.planets.forEach((p) => { p.rotation.y = pr; });
    pl.cdl.rotation.y = angle.front || 0;
    // the bevel centre diff's axis points back (-z): its own angles are negated
    const cd = tcGroups.cd;
    cd.carrier.rotation.y = -(angle.centreIn || 0);
    const cs = add("cdS", sp.cdSpiders);
    cd.spiders.forEach((g) => { g.rotation.y = cs + BEVEL.spiderPhase; });
    cd.plus.rotation.y = -(angle.front || 0);  // back side gear: the sprocket
    cd.minus.rotation.y = angle.main || 0;     // front side gear: the rear output
    tcGroups.bevelCollar.rotation.y = -(angle.centreIn || 0);
    // the chain runs with the sprockets (a sprocket turning +z moves its top link towards -x)
    if (chain) chain.move(-(angle.front || 0) * chain.radius);
  }

  // Ease a collar (or anything) towards a position along one axis.
  function slide(obj, axis, goal, dt) {
    obj.position[axis] += (goal - obj.position[axis]) * Math.min(1, dt * 8 || 1);
  }

  const T01 = (f) => Math.min(1, f / 0.4);

  function paintAll(dt) {
    const r = result, s = r.splits;
    const sys = r.state.system;
    const total = r.frontForce + r.rearForce;
    const frontOn = s.centre !== "rear" && r.frontForce > 1e-6;
    const turning = (x) => Math.abs(x) > 0.05;
    const rearTurning = turning(raw.rl + raw.rr), frontTurning = s.centre !== "rear" && turning(raw.fl + raw.fr);
    const flow = (force, turningNow) => (force > 1e-6 ? "active" : turningNow ? "passive" : "idle");
    const driving = flow(total, rearTurning || frontTurning || r.status !== "bog");

    paint("engine", driving, T01(total));
    paint("input", driving, T01(total));
    paint("centreIn", driving, T01(total));
    // low range: idles in high, drives through the planets in low; the ring is fixed
    paint("lrPlanets", r.low ? driving : "passive", T01(total));
    paint("lrRing", "idle");
    paint("rangeCollar", "lock");
    slide(tcGroups.rangeCollar, "z", r.low ? -0.32 : -0.29, dt);

    tcGroups.chain.visible = sys === "part";
    tcGroups.planetary.visible = sys === "torsen";
    tcGroups.bevel.visible = sys === "ss2";
    tcGroups.clutch.visible = sys === "tod";
    const locked = s.centre === "locked";
    paint("centreLock", locked ? "lock" : "idle");
    if (sys === "part") slide(tcGroups.centreCollar, "z", locked ? -0.505 : -0.475, dt);
    if (sys === "torsen") slide(tcGroups.cdlCollar, "y", locked ? -0.045 : -0.075, dt);
    if (sys === "ss2") slide(tcGroups.bevelCollar, "y", locked ? 0.05 : -0.03, dt);
    paint("main", flow(r.rearForce, rearTurning), T01(r.rearForce));
    paint("chain", flow(s.centre === "rear" ? 0 : r.frontForce, frontTurning), T01(r.frontForce));
    paint("frontOut", flow(s.centre === "rear" ? 0 : r.frontForce, frontTurning), T01(r.frontForce));
    paint("planets", s.centre === "rear" ? "idle" : locked ? "lock" : driving, T01(total));
    paint("cdCarrier", locked ? "lock" : driving, T01(total));
    paint("cdSpider", locked ? "lock" : Math.abs(raw.fl + raw.fr - raw.rl - raw.rr) > 0.3 ? "passive" : "idle");
    paint("cdSidePlus", flow(r.frontForce, frontTurning), T01(r.frontForce));
    paint("cdSideMinus", flow(r.rearForce, rearTurning), T01(r.rearForce));
    if (sys === "tod") {
      const cl = s.centre === "rear" ? "open" : s.centre === "locked" ? "lock" : r.clutch;
      const gap = cl === "open" ? 0.016 : 0.009;
      tcGroups.plates.forEach((p, i) => slide(p, "z", (i - 4) * gap, dt));
      paint("clutchInner", flow(r.rearForce, rearTurning), T01(r.rearForce));
      paint("clutchDrum", flow(r.frontForce, frontTurning), T01(r.frontForce));
      paint("clutchOuter", cl === "open" ? (frontTurning ? "passive" : "idle") : cl === "lock" || cl === "max" ? "lock" : "heat");
    }

    // props and axles
    paint("frontProp", flow(s.centre === "rear" ? 0 : r.frontForce, frontTurning), T01(r.frontForce));
    paint("rearProp", flow(r.rearForce, rearTurning), T01(r.rearForce));
    ["front", "rear"].forEach((a) => {
      const off = a === "front" && s.centre === "rear";
      const force = a === "front" ? r.frontForce : r.rearForce;
      const turn = a === "front" ? frontTurning : rearTurning;
      const type = s[a];
      const lockedAxle = type === "locked" && !off;
      paint(a + "Ring", flow(off ? 0 : force, turn), T01(force));
      paint(a + "Carrier", flow(off ? 0 : force, turn), T01(force));
      const l = a === "front" ? "fl" : "rl", rr = a === "front" ? "fr" : "rr";
      paint(a + "Spider", lockedAxle ? "lock" : !off && Math.abs(raw[l] - raw[rr]) > 0.3 ? "passive" : "idle");
      paint(a + "SidePlus", wheelFlow(rr, off), T01(r.wheels[rr].force * 2));
      paint(a + "SideMinus", wheelFlow(l, off), T01(r.wheels[l].force * 2));
      paint(a + "Lock", type === "locked" ? "lock" : "idle");
      const b = axleBits[a];
      slide(b.collar, "x", b.collarSide * (type === "locked" ? 0.105 : 0.17), dt);
    });
    paint("rearLsd", s.rear === "lsd" ? "lsd" : "idle");
    axleBits.rear.lsd.visible = !!r.state.rearLsd || s.rear === "lsd";

    // half shafts and wheels
    C.WHEELS.forEach((w) => {
      const st = wheelState(w);
      const off = s.centre === "rear" && (w === "fl" || w === "fr");
      paint("half-" + w, wheelFlow(w, off), T01(r.wheels[w].force * 2));
      const ringState = { grip: "grip", spin: "slip", brake: "brake", idle: "idle", air: "idle" }[st];
      paintMat(wheelBits[w].ringMat, ringState);
      paintMat(wheelBits[w].calMat, st === "brake" ? "brake" : "idle");
    });

    C.WHEELS.forEach((w) => {
      setTile(w, r.state.surfaces[w]);
      tiles[w].edge.material.opacity = hover === w ? 0.9 : 0;
    });
  }

  // A half shaft or side gear: red when its wheel spins, amber when braked.
  function wheelFlow(w, off) {
    if (off) return "idle";
    const st = wheelState(w);
    if (st === "spin") return "slip";
    if (st === "brake") return "brake";
    return result.wheels[w].force > 1e-6 ? "active" : Math.abs(raw[w]) > 0.05 ? "passive" : "idle";
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
    tcGroups.cuLabel.el.textContent = { part: "2-4 COLLAR + CHAIN", torsen: "TORSEN / PLANETARY CENTRE DIFF", ss2: "BEVEL CENTRE DIFF", tod: "WET CLUTCH PACK" }[r.state.system];
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
    suspension(dt);
    stepRocks();
    const tilt = -(result.state.slope * Math.PI) / 180; // uphill: the front (+z) rises
    world.rotation.x += (tilt - world.rotation.x) * (reduceMotion || !dt ? 1 : Math.min(1, dt * 3));
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
    sun.position.set(3, 6, 3.5); // over the camera's shoulder (front left)
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 15 });
    scene.add(sun);
    const rim = new T.DirectionalLight(0x4cc9ff, 0.5);
    rim.position.set(-4, 3, -4);
    scene.add(rim);

    world = new T.Group();
    // Mirrored across the centreline: everything is built with the left wheels
    // at -x, but facing +z (forwards) the left is +x in three.js's right-handed
    // space, so without this every "left" part showed on the vehicle's right
    // (found 2026-10-30). The VIEWS below are in the mirrored space.
    world.scale.x = -1;
    scene.add(world);
    rig = new T.Group();
    world.add(rig);
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

  // step(): draw one frame dt seconds on (for tests and screenshots).
  function step(dt) { if (cam.goal) { cam.t = 1; stepCamera(0); } frame(dt); }

  // inspect(): the axle diffs, for the meshing check in dd.tmp.html.
  return { init: init, show: show, focus: focus, step: step, inspect: () => ({ axles: axleBits, cd: tcGroups.cd }) };
})();
