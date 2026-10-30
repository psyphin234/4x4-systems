/* The diff demo in 3D (owner, 2026-10-30): one axle on its own, the diff drawn
   large in a see-through housing (ring and pinion, carrier, spider and side
   gears, LSD clutch packs, the locker's dog collar), half shafts out to two
   wheels, each on its own ground. Arrows show the torque: a curved one round
   each half shaft and a push on the ground, thicker and longer with more
   torque, cyan while the wheel grips, red while it spins. It only draws: app.js
   passes calc.js diffDemo()'s result to show().

   Built in three.js's own space, facing +z: the left wheel is at +x, so a
   camera behind the axle sees the left wheel on the left. The gear speeds
   follow the same rules as the rear axle in diagram3d.js (ring and pinion
   41:10, spiders at half the side gears' difference; SYS_SHAPES.bevel). */
window.SYS_DIFFDEMO = (function () {
  "use strict";

  const T = window.THREE;
  const S3 = window.SYS_SHAPES;
  const BEVEL = S3.bevel;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const R = 0.42;           // wheel radius
  const AY = R;             // axle height
  const WX = 1.05;          // wheel centres, either side
  const S = 2.2;            // the diff is drawn this much larger than life
  const COL = { active: 0x4cc9ff, passive: 0x6b7ea8, idle: 0x323a52, lock: 0xffc857, slip: 0xff5d73, heat: 0xff8a3c, lsd: 0xb49bff, grip: 0x3ef08a };

  let renderer, scene, camera, canvas, box, labelLayer;
  let result = null, raf = 0, running = false, visible = true, last = 0, time = 0;
  const parts = {};   // name -> materials painted together
  const spin = [];    // { obj, key, factor }: turned about local Y by angle[key]
  const angle = {}, speed = { l: 0, r: 0 };
  const labels = [];
  const bits = {};

  // ---------------------------------------------------------------- materials and paint
  function mat(name) {
    const m = new T.MeshStandardMaterial({ color: COL.idle, metalness: 0.55, roughness: 0.35 });
    (parts[name] = parts[name] || []).push(m);
    return m;
  }

  function paint(name, state, t) {
    (parts[name] || []).forEach((m) => {
      let c = COL.idle, e = 0x000000, ei = 0;
      // a low glow, so the teeth still show (owner, 2026-10-30: it drowned them out)
      if (state === "active") { c = COL.active; e = COL.active; ei = 0.05 + 0.25 * Math.min(1, t || 0); }
      else if (state === "passive") { c = COL.passive; e = 0x1b2a4a; ei = 0.4; }
      else if (state === "lock") { c = COL.lock; e = COL.lock; ei = 0.8; }
      else if (state === "slip") { c = COL.slip; e = COL.slip; ei = 0.6 + 0.4 * Math.abs(Math.sin(time * 9)); }
      else if (state === "heat") { c = COL.heat; e = COL.heat; ei = 0.7 + 0.3 * Math.abs(Math.sin(time * 7)); }
      else if (state === "lsd") { c = COL.lsd; e = COL.lsd; ei = 0.5; }
      else if (state === "grip") { c = COL.grip; e = COL.grip; ei = 0.9; }
      m.color.setHex(c);
      m.emissive.setHex(e);
      m.emissiveIntensity = ei;
    });
  }

  // Something that turns about its own Y axis with angle[key] (see turns() in diagram3d.js).
  function turns(key, obj, factor) {
    const holder = new T.Group();
    holder.rotation.copy(obj.rotation);
    obj.rotation.set(0, 0, 0);
    holder.add(obj);
    spin.push({ obj: obj, key: key, factor: factor || 1 });
    return holder;
  }

  function label(cls, pos) {
    const el = document.createElement("div");
    el.className = "tag3d " + cls;
    labelLayer.appendChild(el);
    const l = { el: el, pos: pos };
    labels.push(l);
    return l;
  }

  // ---------------------------------------------------------------- the axle
  // Axle group: centred on the diff, scaled by S. Inside it the diff's own
  // axis runs along +x (local Y turned to +x), as on diagram3d's rear axle.
  function buildAxle() {
    const ax = new T.Group();
    ax.position.set(0, AY, 0);
    ax.scale.setScalar(S);
    scene.add(ax);
    ax.add(S3.glass(new T.SphereGeometry(0.25, 28, 18), 0x9fd8ff, 0.07));

    const dh = new T.Group();
    dh.rotation.z = -Math.PI / 2; // local Y -> +x (the left wheel's side)
    ax.add(dh);
    // Proportions as in a real axle (owner, 2026-10-30: the side gears looked
    // as if they sat in the ring gear): the spider and side gears are small
    // and sit inside the carrier case; the ring gear is bolted round the
    // outside on a flange; bearing hubs stick out of each end. In the
    // diff's own space (axis = local Y), all within +-0.075 but the hubs.
    const CR = 0.075, CL = 0.075;          // carrier case radius, half length
    const G1 = 0.035, G2 = 0.075;          // spider and side gear teeth, along their 45-degree cones
    const R1 = 0.15, R2 = 0.21;            // ring gear and pinion teeth, along their cones
    const carrier = new T.Group();
    const caseG = new T.CylinderGeometry(CR, CR, 2 * CL, 40, 1, true);
    carrier.add(S3.glass(caseG, 0x9fb4d8, 0.16));
    const steel = new T.MeshStandardMaterial({ color: 0x5a6788, metalness: 0.7, roughness: 0.35 });
    [1, -1].forEach((s) => {
      // end walls with the bearing hubs the half shafts run through
      const wall = new T.Mesh(new T.RingGeometry(0.03, CR, 36), new T.MeshStandardMaterial({ color: 0x5a6788, metalness: 0.6, roughness: 0.4, transparent: true, opacity: 0.35, side: T.DoubleSide, depthWrite: false }));
      wall.rotation.x = -Math.PI / 2;
      wall.position.y = s * CL;
      carrier.add(wall);
      const hub = new T.Mesh(new T.CylinderGeometry(0.03, 0.033, 0.02, 24, 1, true), steel);
      hub.position.y = s * (CL + 0.01);
      carrier.add(hub);
    });
    // the locker's dogs on the right-hand hub's end (-local Y): the collar slides onto them
    for (let i = 0; i < 6; i++) {
      const b = Math.PI / 6 + (i / 6) * Math.PI * 2; // between the collar's dogs
      const dog = new T.Mesh(new T.BoxGeometry(0.016, 0.014, 0.016), mat("lockDogs"));
      dog.position.set(Math.cos(b) * 0.034, -(CL + 0.02 + 0.007), Math.sin(b) * 0.034);
      carrier.add(dog);
    }
    const spMat = mat("spider");
    const pin = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 2 * CR, 10), spMat);
    pin.rotation.z = Math.PI / 2;
    carrier.add(pin);
    const spiders = [];
    [1, -1].forEach((s) => {
      const h = new T.Group();
      h.rotation.z = -s * Math.PI / 2;
      const g = S3.coneGear(45, G1, G2, BEVEL.sideTeeth, spMat);
      h.add(g);
      carrier.add(h);
      spiders.push(g);
    });
    // the ring gear on its flange round the case, on the left
    const ringMat = mat("ring");
    ringMat.side = T.DoubleSide;
    const rh = new T.Group();
    rh.add(S3.coneGear(BEVEL.ringAngle, R1, R2, BEVEL.ringTeeth, ringMat));
    const ra = (BEVEL.ringAngle * Math.PI) / 180;
    const web = new T.Mesh(new T.RingGeometry(CR, R1 * Math.sin(ra), 48), ringMat);
    web.rotation.x = -Math.PI / 2;
    web.position.y = R1 * Math.cos(ra);
    rh.add(web);
    carrier.add(rh);
    dh.add(carrier);
    // side gears: +local Y = the left wheel's, -local Y = the right wheel's
    const sideL = S3.coneGear(45, G1, G2, BEVEL.sideTeeth, mat("sideL"));
    dh.add(sideL);
    const hr = new T.Group();
    hr.rotation.x = Math.PI;
    const sideR = S3.coneGear(45, G1, G2, BEVEL.sideTeeth, mat("sideR"));
    hr.add(sideR);
    dh.add(hr);

    // pinion and the prop shaft, pointing forwards (+z)
    const ph = new T.Group();
    ph.rotation.x = Math.PI / 2;
    const pMat = mat("pinion");
    const pinion = S3.coneGear(BEVEL.pinionAngle, R1, R2, BEVEL.pinionTeeth, pMat);
    const shaft = new T.Mesh(new T.CylinderGeometry(0.022, 0.022, 0.42, 12), pMat);
    shaft.position.y = R2 + 0.21;
    pinion.add(shaft);
    const flange = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.02, 20), pMat);
    flange.position.y = R2 + 0.43;
    pinion.add(flange);
    ph.add(pinion);
    ax.add(ph);

    // LSD clutch packs, between the back of each side gear and the case's end wall
    const lsd = new T.Group();
    const lsdMat = mat("lsd");
    [-1, 1].forEach((s) => {
      for (let i = 0; i < 3; i++) {
        const disc = S3.along(new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.004, 28), lsdMat), "x");
        disc.position.x = s * (0.058 + i * 0.006);
        lsd.add(disc);
      }
    });
    ax.add(lsd);
    // the locker's dog collar, on the right half shaft (away from the ring gear):
    // out at -0.175, in at -0.125 where its dogs mesh between the hub's
    const collar = turns("r", S3.along(S3.collarMesh(0.045, mat("lock")), "x"), -1);
    collar.position.x = -0.175;
    ax.add(collar);

    // the housing's tubes (faint), out towards the wheels
    const tubeMat = new T.MeshStandardMaterial({ color: 0x3b4560, metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.22, depthWrite: false });
    [-1, 1].forEach((s) => {
      const a = 0.24, b = (WX - 0.3) / S;
      const tube = S3.along(new T.Mesh(new T.CylinderGeometry(0.035, 0.035, b - a, 16), tubeMat), "x");
      tube.position.x = s * (a + b) / 2;
      ax.add(tube);
    });

    // half shafts, full size, from the side gears to the hubs
    [["l", 1], ["r", -1]].forEach(([w, s]) => {
      const a = 0.05 * S, b = WX - 0.12;
      const shaftM = S3.along(new T.Mesh(new T.CylinderGeometry(0.035, 0.035, b - a, 12), mat("half" + w.toUpperCase())), "x");
      const h = turns(w, shaftM, -1); // along() points local Y at -x: turn it backwards
      h.position.set(s * (a + b) / 2, AY, 0);
      scene.add(h);
    });

    bits.ring = rh.children[0];
    bits.carrier = carrier; bits.spiders = spiders; bits.sideL = sideL; bits.sideR = sideR;
    bits.pinion = pinion; bits.lsd = lsd; bits.collar = collar;
  }

  // ---------------------------------------------------------------- wheels and ground
  const rubber = new T.MeshStandardMaterial({ color: 0x15181f, metalness: 0.05, roughness: 0.92 });
  const rimMat = new T.MeshStandardMaterial({ color: 0x9aa6c2, metalness: 0.85, roughness: 0.25 });
  function buildWheel(w, x) {
    const side = x > 0 ? 1 : -1;
    const outer = new T.Group();
    outer.position.set(x, AY, 0);
    scene.add(outer);
    const spinner = new T.Group();
    outer.add(spinner);
    spinner.add(S3.along(new T.Mesh(new T.CylinderGeometry(R, R, 0.3, 40), rubber), "x"));
    const lugs = new T.InstancedMesh(new T.BoxGeometry(0.13, 0.05, 0.07), rubber, 56);
    const o = new T.Object3D();
    for (let i = 0; i < 56; i++) {
      const a = (i / 28) * Math.PI;
      o.position.set(i % 2 ? 0.075 : -0.075, Math.cos(a) * (R + 0.012), Math.sin(a) * (R + 0.012));
      o.rotation.set(a, 0, 0);
      o.updateMatrix();
      lugs.setMatrixAt(i, o.matrix);
    }
    spinner.add(lugs);
    spinner.add(S3.along(new T.Mesh(new T.CylinderGeometry(0.25, 0.25, 0.305, 30), rimMat), "x"));
    for (let i = 0; i < 6; i++) {
      const sp = new T.Mesh(new T.BoxGeometry(0.02, 0.44, 0.05), rimMat);
      sp.position.x = side * 0.16;
      sp.rotation.x = (i / 6) * Math.PI;
      spinner.add(sp);
    }
    const ringMat = new T.MeshStandardMaterial({ color: COL.idle, metalness: 0.5, roughness: 0.4 });
    (parts["ring" + w] = []).push(ringMat);
    const ring = new T.Mesh(new T.TorusGeometry(R + 0.005, 0.016, 8, 60), ringMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = side * 0.16;
    outer.add(ring);
    bits["wheel" + w] = { outer: outer, spinner: spinner, x: x };
  }

  // A flat canvas texture for the ground under each wheel.
  function texture(kind) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    if (kind === "tar") {
      g.fillStyle = "#2c313d"; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1400; i++) { g.fillStyle = rnd() < 0.5 ? "#3b4252" : "#22262f"; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); }
    } else if (kind === "ice") {
      g.fillStyle = "#b9d6ea"; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        g.beginPath();
        let x = rnd() * 256, y = rnd() * 256;
        g.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (rnd() - 0.5) * 80; y += (rnd() - 0.5) * 80; g.lineTo(x, y); }
        g.stroke();
      }
    } else {
      g.fillStyle = "#06122a"; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = "rgba(76,201,255,0.35)"; g.lineWidth = 2;
      for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
    }
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    return t;
  }

  const TEX = {};
  function buildGround() {
    ["tar", "ice", "air"].forEach((k) => { TEX[k] = texture(k); });
    [["l", 1], ["r", -1]].forEach(([w, s]) => {
      const m = new T.MeshStandardMaterial({ map: TEX.tar, roughness: 0.9 });
      const pad = new T.Mesh(new T.PlaneGeometry(1.3, 2.6), m);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(s * WX, 0, 0.2);
      pad.receiveShadow = true;
      scene.add(pad);
      bits["pad" + w] = { mesh: pad, mat: m, kind: "tar" };
    });
    const grid = new T.GridHelper(12, 24, 0x1d3b6b, 0x0f2142);
    grid.position.y = -0.62;
    scene.add(grid);
  }

  function setPad(w, kind) {
    const p = bits["pad" + w];
    if (p.kind === kind) return;
    p.kind = kind;
    p.mat.map = TEX[kind];
    p.mat.roughness = kind === "ice" ? 0.12 : 0.9;
    p.mat.metalness = kind === "ice" ? 0.15 : 0;
    p.mat.emissive = new T.Color(kind === "air" ? 0x0a2a55 : 0x000000);
    p.mat.emissiveIntensity = kind === "air" ? 0.4 : 0;
    p.mesh.position.y = kind === "air" ? -0.6 : 0; // in the air: the ground drops away
    p.mat.needsUpdate = true;
  }

  // ---------------------------------------------------------------- arrows
  // A curved arrow round the x axis (the way a wheel turns rolling forwards:
  // over the top towards +z), r = radius, th = thickness.
  function curvedArrow(r, th, color) {
    const g = new T.Group();
    const m = new T.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
    const a0 = -0.62 * Math.PI, a1 = 0.5 * Math.PI;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = a0 + ((a1 - a0) * i) / 24;
      pts.push(new T.Vector3(0, r * Math.cos(a), r * Math.sin(a)));
    }
    g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, th, 8), m));
    const head = new T.Mesh(new T.ConeGeometry(th * 2.6, th * 6, 14), m);
    const end = pts[pts.length - 1];
    head.position.copy(end);
    head.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(0, -Math.sin(a1), Math.cos(a1)));
    g.add(head);
    return g;
  }

  // A flat arrow on the ground pointing forwards (+z), len long.
  function pushArrow(len, th, color) {
    const g = new T.Group();
    const m = new T.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 });
    const shaft = new T.Mesh(new T.BoxGeometry(th * 2, 0.012, len), m);
    shaft.position.z = len / 2;
    g.add(shaft);
    const head = new T.Mesh(new T.ConeGeometry(th * 3.2, th * 5, 3), m);
    head.rotation.x = Math.PI / 2;
    head.scale.set(1, 1, 0.25);
    head.position.z = len + th * 2.5;
    g.add(head);
    return g;
  }

  function dispose(obj) {
    if (!obj) return;
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    obj.parent.remove(obj);
  }

  // Rebuilt on every show(): their size is the torque.
  const arrows = {};
  function placeArrows(r) {
    ["l", "r"].forEach((w) => {
      dispose(arrows["turn" + w]); dispose(arrows["push" + w]);
      arrows["turn" + w] = arrows["push" + w] = null;
      const t = r.torque[w] / r.need; // 1 = all the push the axle needs
      if (t < 0.01) return;
      const color = r.slip[w] ? COL.slip : COL.active;
      const s = w === "l" ? 1 : -1;
      const th = 0.008 + 0.03 * Math.min(1, t);
      const turn = curvedArrow(0.2, th, color);
      turn.position.set(s * (WX - 0.42), AY, 0);
      scene.add(turn);
      arrows["turn" + w] = turn;
      if (r.surfaces[w] !== "air") {
        // on the ground beside the tyre's outer face, so the camera behind sees it
        const push = pushArrow(0.15 + 0.85 * Math.min(1.2, t), th * 1.4, color);
        push.position.set(s * (WX + 0.3), 0.02, -0.3);
        scene.add(push);
        arrows["push" + w] = push;
      }
    });
    // what comes in from the engine, round the prop shaft
    dispose(arrows.input);
    arrows.input = null;
    const ti = r.ground / r.need;
    if (ti >= 0.01) {
      const inp = curvedArrow(0.13, 0.008 + 0.03 * Math.min(1, ti), COL.active);
      inp.rotation.y = Math.PI / 2; // round the prop (z), the way the pinion turns (-z)
      inp.position.set(0, AY, 1.25);
      scene.add(inp);
      arrows.input = inp;
    }
  }

  // ---------------------------------------------------------------- labels
  const SIDE = { l: "LEFT WHEEL", r: "RIGHT WHEEL" };
  function updateLabels(r) {
    ["l", "r"].forEach((w) => {
      const el = bits["label" + w].el;
      el.innerHTML = "";
      const head = document.createElement("span");
      head.textContent = SIDE[w];
      const tq = document.createElement("span");
      tq.className = "dd-tag-torque";
      tq.textContent = "TORQUE " + Math.round(r.torqueShare[w] * 100) + "%";
      const sp = document.createElement("span");
      sp.className = "dd-tag-speed";
      sp.textContent = "SPEED " + Math.round(r.speedShare[w] * 100) + "%";
      const st = document.createElement("span");
      const air = r.surfaces[w] === "air";
      st.className = "tag3d-state tag3d-state--" + (r.slip[w] ? "spin" : r.moves && !air ? "grip" : "idle");
      st.textContent = r.slip[w] ? "SPINNING" : air ? (r.moves ? "IN THE AIR, TURNING" : "IN THE AIR") : r.moves ? "PUSHING" : "STILL";
      el.append(head, tq, sp, st);
    });
    bits.labelDiff.el.textContent = { open: "OPEN DIFF", lsd: "LIMITED-SLIP DIFF", locked: "LOCKED DIFF" }[r.type];
    bits.labelDiff.el.classList.toggle("is-lock", r.type === "locked");
    bits.labelIn.el.textContent = "FROM THE ENGINE";
  }

  function placeLabels() {
    const wdt = canvas.clientWidth, hgt = canvas.clientHeight;
    const v = new T.Vector3();
    labels.forEach((l) => {
      v.copy(l.pos).project(camera);
      l.el.style.display = v.z > 1 ? "none" : "";
      l.el.style.transform = "translate(-50%, -100%) translate(" + ((v.x + 1) / 2) * wdt + "px, " + ((1 - v.y) / 2) * hgt + "px)";
    });
  }

  // ---------------------------------------------------------------- per frame
  function paintAll() {
    const r = result;
    ["l", "r"].forEach((w) => {
      const W = w.toUpperCase();
      const st = r.slip[w] ? "slip" : r.torque[w] > 1e-6 ? "active" : speed[w] > 0.05 || r.speed[w] > 0 ? "passive" : "idle";
      const t = r.torque[w] / r.need;
      paint("half" + W, st, t);
      paint("side" + W, st, t);
      paint("ring" + w, r.slip[w] ? "slip" : r.moves && r.surfaces[w] !== "air" ? "grip" : "idle");
    });
    const carry = r.ground > 1e-6 ? "active" : "passive";
    const tc = r.ground / r.need;
    ["ring", "pinion", "spider"].forEach((p) => paint(p, carry, tc));
    // LSD packs: purple when fitted, orange while they slip (one wheel faster than the other)
    const lsdSlip = r.type === "lsd" && r.speed.l !== r.speed.r;
    paint("lsd", lsdSlip ? "heat" : "lsd");
    bits.lsd.visible = r.type === "lsd";
    paint("lock", r.type === "locked" ? "lock" : "idle");
    paint("lockDogs", r.type === "locked" ? "lock" : "idle");
  }

  function frame(dt) {
    time += dt;
    const r = result;
    // speeds (rad/s): rolling along, or a wheel spinning with the other still.
    // Kept slow enough that no gear passes more than about 14 teeth a second
    // (a quarter tooth a frame at 60 fps): faster, the teeth strobe and seem to
    // stand still or run backwards.
    const goal = { l: 0, r: 0 };
    if (!reduceMotion) {
      const base = r.moves ? 1.2 : 2.2;
      goal.l = r.speed.l * base;
      goal.r = r.speed.r * base;
    }
    const k = Math.min(1, dt * 3);
    speed.l += (goal.l - speed.l) * k;
    speed.r += (goal.r - speed.r) * k;
    const add = (key, w) => (angle[key] = (angle[key] || 0) + w * dt);
    add("l", speed.l); add("r", speed.r);
    const c = (speed.l + speed.r) / 2;
    add("c", c);
    add("sp", (speed.r - speed.l) / 2); // the spiders: half the difference
    add("p", -BEVEL.ratio * c);          // the pinion: 41:10 teeth, 4.1 turns per turn of the ring
    bits.wheell.spinner.rotation.x = angle.l;
    bits.wheelr.spinner.rotation.x = angle.r;
    spin.forEach((s) => { s.obj.rotation.y = angle[s.key] * s.factor; });
    bits.carrier.rotation.y = angle.c;
    bits.spiders.forEach((g) => { g.rotation.y = angle.sp + BEVEL.spiderPhase; }); // half a tooth: teeth in gaps
    bits.sideL.rotation.y = angle.l;   // faces +x
    bits.sideR.rotation.y = -angle.r;  // faces -x
    bits.pinion.rotation.y = angle.p + BEVEL.pinionPhase;
    // the locker's collar slides in against the carrier when locked
    const cx = result.type === "locked" ? -0.125 : -0.175;
    bits.collar.position.x += (cx - bits.collar.position.x) * Math.min(1, dt * 8 || 1);
    // a wheel in the air hangs a little lower on its spring
    ["l", "r"].forEach((w) => {
      const y = AY + (r.surfaces[w] === "air" ? -0.06 : 0);
      bits["wheel" + w].outer.position.y += (y - bits["wheel" + w].outer.position.y) * Math.min(1, dt * 6 || 1);
    });
    paintAll();
    stepCamera();
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

  // ---------------------------------------------------------------- camera: behind the axle, drag to turn, scroll to zoom
  const target = new T.Vector3(0, 0.5, 0.15);
  const sph = new T.Spherical().setFromVector3(new T.Vector3(-0.75, 1.3, -2.75).sub(target));
  function stepCamera() {
    camera.position.setFromSpherical(sph).add(target);
    camera.lookAt(target);
  }

  function setUpOrbit() {
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      sph.theta -= (e.clientX - drag.x) * 0.008;
      sph.phi = Math.min(1.5, Math.max(0.2, sph.phi - (e.clientY - drag.y) * 0.008));
      drag.x = e.clientX; drag.y = e.clientY;
      if (!running) frame(0);
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      sph.radius = Math.min(8, Math.max(1.2, sph.radius * (1 + Math.sign(e.deltaY) * 0.1)));
      if (!running) frame(0);
    }, { passive: false });
  }

  function resize() {
    const wdt = box.clientWidth;
    const hgt = Math.max(380, Math.min(wdt * 0.62, window.innerHeight * 0.6));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(wdt, hgt, false);
    canvas.style.width = wdt + "px";
    canvas.style.height = hgt + "px";
    camera.aspect = wdt / hgt;
    camera.updateProjectionMatrix();
    if (result) frame(0);
  }

  // ---------------------------------------------------------------- set up
  function init(el) {
    canvas = el;
    box = canvas.parentElement;
    labelLayer = document.createElement("div");
    labelLayer.className = "tags3d";
    labelLayer.setAttribute("aria-hidden", "true");
    box.appendChild(labelLayer);

    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.outputEncoding = T.sRGBEncoding;
    scene = new T.Scene();
    scene.fog = new T.Fog(0x040817, 7, 14);
    camera = new T.PerspectiveCamera(36, 1.5, 0.05, 40);
    scene.add(new T.HemisphereLight(0xbfdcff, 0x1a1408, 0.55));
    const sun = new T.DirectionalLight(0xffffff, 0.9);
    sun.position.set(-2, 5, -3);
    scene.add(sun);
    const rim = new T.DirectionalLight(0x4cc9ff, 0.5);
    rim.position.set(3, 2, 4);
    scene.add(rim);

    buildGround();
    buildAxle();
    buildWheel("l", WX);
    buildWheel("r", -WX);
    bits.labell = label("tag3d--wheel", new T.Vector3(WX, AY + 0.62, 0));
    bits.labelr = label("tag3d--wheel", new T.Vector3(-WX, AY + 0.62, 0));
    bits.labelDiff = label("", new T.Vector3(0, AY + 0.66, 0));
    bits.labelIn = label("tag3d--small", new T.Vector3(0, AY + 0.22, 1.35));

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
    setPad("l", r.surfaces.l);
    setPad("r", r.surfaces.r);
    placeArrows(r);
    updateLabels(r);
    runState();
    if (!running) frame(0.05);
  }

  // step(): one frame dt seconds on (for screenshots).
  function step(dt) { frame(dt); }

  // inspect(): the gears, for the meshing check in dd.tmp.html.
  return { init: init, show: show, step: step, inspect: () => ({ bits: bits, sph: sph, target: target }) };
})();
