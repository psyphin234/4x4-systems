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

  // ---------------------------------------------------------------- the look
  // Both views share these (2026-11-10, owner asked for a better-looking
  // animation). Nothing here changes what a colour means.

  // Studio lighting: a dark room with soft light
  // panels for the metal to reflect (gears and rims look machined instead of
  // flat). The room is only ever seen in reflections.
  function studio(renderer, scene) {
    const room = new T.Scene();
    room.add(new T.Mesh(new T.BoxGeometry(30, 30, 30), new T.MeshBasicMaterial({ color: 0x020308, side: T.BackSide })));
    const panel = (w, h, hex, k, pos) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(hex).multiplyScalar(k), side: T.DoubleSide }));
      m.position.set(pos[0], pos[1], pos[2]);
      m.lookAt(0, 0, 0);
      room.add(m);
    };
    panel(10, 6, 0xffffff, 0.4, [0, 9, 2]);      // soft box overhead
    panel(3, 8, 0x4cc9ff, 0.5, [-9, 3, -3]);     // cyan strip
    panel(3, 8, 0xffc890, 0.25, [9, 3, 4]);     // warm strip opposite
    panel(8, 2, 0x8f7bff, 0.25, [0, 2, -10]);     // violet, low behind
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(room, 0.03).texture;
    pm.dispose();
  }

  // A soft glow round whatever is brightly lit (the drive colours, locks,
  // spinning wheels): the picture is drawn to a buffer, its brightest parts
  // are blurred at a quarter of the size and added back. Returns
  // { setSize(w, h), render(scene, camera) }; where the buffers aren't
  // supported it draws straight to the screen, with no glow.
  function glow(renderer, o) {
    o = Object.assign({ threshold: 0.8, knee: 0.5, strength: 0.4 }, o);
    const plain = { setSize: function () {}, render: function (scene, camera) { renderer.render(scene, camera); } };
    if (!renderer.capabilities.isWebGL2 || !renderer.extensions.has("EXT_color_buffer_float")) return plain;
    const soft = { type: T.HalfFloatType, minFilter: T.LinearFilter, magFilter: T.LinearFilter, depthBuffer: false };
    const full = new T.WebGLRenderTarget(2, 2, { type: T.HalfFloatType, samples: 4 });
    const half = new T.WebGLRenderTarget(2, 2, soft), qa = new T.WebGLRenderTarget(2, 2, soft), qb = new T.WebGLRenderTarget(2, 2, soft);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    const qs = new T.Scene();
    qs.add(quad);
    const vs = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
    const mat = (fs, uniforms) => new T.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: uniforms, depthTest: false, depthWrite: false, blending: T.NoBlending });
    const bright = mat(
      "uniform sampler2D map; uniform float threshold; uniform float knee; varying vec2 vUv;" +
      // only strong colours glow (the drive colours), not pale lit ground such as ice
      "void main() { vec4 c = texture2D(map, vUv); float b = max(c.r, max(c.g, c.b));" +
      " float sat = (b - min(c.r, min(c.g, c.b))) / max(b, 0.0001);" +
      " float w = smoothstep(threshold, threshold + knee, b) * smoothstep(0.3, 0.55, sat);" +
      " gl_FragColor = vec4(min(c.rgb, vec3(4.0)) * w, 1.0); }",
      { map: { value: full.texture }, threshold: { value: o.threshold }, knee: { value: o.knee } });
    const blur = mat(
      "uniform sampler2D map; uniform vec2 dir; varying vec2 vUv;" +
      "void main() { vec3 s = texture2D(map, vUv).rgb * 0.227027;" +
      " s += (texture2D(map, vUv + dir * 1.3846).rgb + texture2D(map, vUv - dir * 1.3846).rgb) * 0.316216;" +
      " s += (texture2D(map, vUv + dir * 3.2308).rgb + texture2D(map, vUv - dir * 3.2308).rgb) * 0.070270;" +
      " gl_FragColor = vec4(s, 1.0); }",
      { map: { value: null }, dir: { value: new T.Vector2() } });
    const final = mat(
      "uniform sampler2D map; uniform sampler2D glowMap; uniform float strength; varying vec2 vUv;" +
      "void main() { vec4 c = texture2D(map, vUv); vec3 g = texture2D(glowMap, vUv).rgb * strength;" +
      " gl_FragColor = vec4(c.rgb + g, 1.0);\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n" +
      " gl_FragColor.a = max(c.a, clamp(max(g.r, max(g.g, g.b)), 0.0, 1.0)); }",
      { map: { value: full.texture }, glowMap: { value: qb.texture }, strength: { value: o.strength } });

    function pass(material, target) {
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(qs, cam);
    }
    function blurPass(from, to, x, y) {
      blur.uniforms.map.value = from.texture;
      blur.uniforms.dir.value.set(x / from.width, y / from.height);
      pass(blur, to);
    }
    return {
      setSize: function (w, h) {
        w = Math.max(2, w); h = Math.max(2, h);
        full.setSize(w, h);
        half.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
        qa.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
        qb.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      },
      render: function (scene, camera) {
        renderer.setRenderTarget(full);
        renderer.render(scene, camera);
        pass(bright, half);
        blurPass(half, qa, 1, 0);
        blurPass(qa, qb, 0, 1);
        blurPass(qb, qa, 2, 0);
        blurPass(qa, qb, 0, 2);
        pass(final, null);
      }
    };
  }

  // A soft round dot, for dust and spray.
  function dotTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255, 255, 255, 1)");
    grd.addColorStop(0.45, "rgba(255, 255, 255, 0.55)");
    grd.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  return { glass: glass, rod: rod, gear: gear, coneGear: coneGear, ringGear: ringGear, along: along, collarMesh: collarMesh, bevel: bevel,
    studio: studio, glow: glow, dotTexture: dotTexture };
})();
