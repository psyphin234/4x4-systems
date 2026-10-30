/* Shapes shared by the two 3D views (diagram3d.js, the whole drivetrain, and
   diffdemo.js, one diff close up): gears, see-through housings, shafts.
   Pure geometry: nothing here keeps state. three.js r149. */
window.SYS_SHAPES = (function () {
  "use strict";

  const T = window.THREE;

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

  // A shaft between two points.
  function rod(a, b, r, mat) {
    const dir = new T.Vector3().subVectors(b, a);
    const m = new T.Mesh(new T.CylinderGeometry(r, r, dir.length(), 14), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
    m.castShadow = true;
    return m;
  }

  // A spur gear: a disc with straight teeth round the rim, axis = local Y.
  function gear(radius, width, teeth, mat, helix) {
    const g = new T.Group();
    g.add(new T.Mesh(new T.CylinderGeometry(radius * 0.94, radius * 0.94, width, 32), mat));
    const tw = ((2 * Math.PI * radius) / teeth) * 0.5;
    const inst = new T.InstancedMesh(new T.BoxGeometry(tw, width, radius * 0.16), mat, teeth);
    const o = new T.Object3D();
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      o.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      o.rotation.set(0, -a + Math.PI / 2, 0);
      if (helix) o.rotateZ(helix); // helical: the teeth lean round the gear
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
    }
    g.add(inst);
    g.add(new T.Mesh(new T.CylinderGeometry(radius * 0.28, radius * 0.28, width * 1.5, 12), mat)); // hub
    return g;
  }

  // A bevel gear on a cone whose apex is the local origin and whose axis is
  // local Y: alpha = the pitch cone's half-angle, the teeth run from r1 to r2
  // along the cone. Two bevel gears mesh when their apexes meet and their
  // angles add up to 90 degrees: 45 + 45 for spider and side gears, 76.3 +
  // 13.7 for a ring gear (teeth on its face) and its pinion (a small steep
  // cone); see `bevel` below.
  function coneGear(alphaDeg, r1, r2, teeth, mat) {
    const a = (alphaDeg * Math.PI) / 180, sa = Math.sin(a), ca = Math.cos(a);
    const g = new T.Group();
    const body = new T.Mesh(new T.CylinderGeometry(r2 * sa * 0.97, r1 * sa * 0.97, Math.max(0.006, (r2 - r1) * ca), 36), mat);
    body.position.y = ((r1 + r2) / 2) * ca;
    g.add(body);
    const rm = ((r1 + r2) / 2) * sa;
    const depth = Math.max(0.008, rm * 0.18);
    const inst = new T.InstancedMesh(new T.BoxGeometry(depth, r2 - r1, ((Math.PI * rm) / teeth) * 0.95), mat, teeth);
    const m = new T.Matrix4();
    for (let i = 0; i < teeth; i++) {
      const th = (i / teeth) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      const n = new T.Vector3(ca * c, -sa, ca * s);   // out of the cone's surface
      const gd = new T.Vector3(sa * c, ca, sa * s);   // along the cone, away from the apex
      const t = new T.Vector3(-s, 0, c);              // round the cone
      m.makeBasis(n, gd, t);
      const p = gd.clone().multiplyScalar((r1 + r2) / 2).addScaledVector(n, depth * 0.35);
      m.setPosition(p);
      inst.setMatrixAt(i, m);
    }
    g.add(inst);
    return g;
  }

  // An internal (ring) gear: teeth pointing in, axis = local Y.
  function ringGear(rIn, width, teeth, mat, helix) {
    const g = new T.Group();
    g.add(new T.Mesh(new T.CylinderGeometry(rIn + 0.022, rIn + 0.022, width, 48, 1, true), mat));
    const tw = ((2 * Math.PI * rIn) / teeth) * 0.5;
    const inst = new T.InstancedMesh(new T.BoxGeometry(tw, width, 0.016), mat, teeth);
    const o = new T.Object3D();
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      o.position.set(Math.cos(a) * (rIn + 0.006), 0, Math.sin(a) * (rIn + 0.006));
      o.rotation.set(0, -a + Math.PI / 2, 0);
      if (helix) o.rotateZ(helix);
      o.updateMatrix();
      inst.setMatrixAt(i, o.matrix);
    }
    g.add(inst);
    return g;
  }

  // Point an object's local Y axis along a world axis ("x" or "z").
  function along(obj, axis) {
    if (axis === "x") obj.rotation.z = Math.PI / 2;  // local Y -> world -X
    if (axis === "z") obj.rotation.x = Math.PI / 2;  // local Y -> world +Z
    return obj;
  }

  // A sliding dog collar: a short sleeve with dog teeth on both faces.
  function collarMesh(r, mat) {
    const g = new T.Group();
    g.add(new T.Mesh(new T.CylinderGeometry(r, r, 0.03, 24), mat));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const d = new T.Mesh(new T.BoxGeometry(0.016, 0.05, 0.016), mat);
      d.position.set(Math.cos(a) * r * 0.75, 0, Math.sin(a) * r * 0.75);
      g.add(d);
    }
    return g;
  }

  // The axle diffs' bevel gears, shared so both views mesh the same way
  // (rechecked 2026-10-30 after the owner saw the teeth drift):
  // - ring and pinion: 41 and 10 teeth, so the pinion turns 4.1 times per turn
  //   of the ring; their cone angles follow from that (tan = 41 / 10), so the
  //   teeth are the same size on both;
  // - spider and side gears: 12 teeth each on 45-degree cones, 1:1;
  // - phases: as built, every spider tooth sat in a side gear's tooth instead of
  //   its gap, and the pinion was a quarter tooth out. Turning each spider half
  //   a tooth (15 degrees) and the pinion a quarter (9 degrees) puts every tooth
  //   in a gap, and the speeds keep it there.
  const RING_TEETH = 41, PINION_TEETH = 10;
  const RING_ANGLE = (Math.atan(RING_TEETH / PINION_TEETH) * 180) / Math.PI; // 76.3
  const bevel = {
    ringTeeth: RING_TEETH, pinionTeeth: PINION_TEETH,
    ratio: RING_TEETH / PINION_TEETH,
    ringAngle: RING_ANGLE, pinionAngle: 90 - RING_ANGLE,
    sideTeeth: 12,
    spiderPhase: Math.PI / 12,
    pinionPhase: (2 * Math.PI * 0.25) / PINION_TEETH
  };

  return { glass: glass, rod: rod, gear: gear, coneGear: coneGear, ringGear: ringGear, along: along, collarMesh: collarMesh, bevel: bevel };
})();
