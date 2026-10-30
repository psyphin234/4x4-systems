/* The live drivetrain: a top view of the vehicle (front at the top) on a canvas,
   animated from the model's result (calc.js solve()). It only draws; app.js
   owns the state.
   - The ground under each wheel scrolls down when the vehicle drives on.
   - Shafts carry light whose thickness is the force they pass on and whose
     dashes run at the shaft's speed.
   - Wheels: green = gripping and pushing (with a push arrow), red = spinning
     (throwing the surface back), amber = held by traction control's brake,
     grey = not driven. Locked diffs glow gold.
   - Clicking the ground under a wheel calls onWheelClick(wheel).
   Under prefers-reduced-motion nothing scrolls or spins; the states still show.
   Paused offscreen and in a background tab. */
window.SYS_DIAGRAM = (function () {
  "use strict";

  const D = window.SYS_DATA;
  const C = window.SYS_CALC;
  // W × H is the whole picture; the vehicle is drawn in a 640-wide space,
  // shifted right by OX so the ground fills the sides.
  const W = 800, H = 600, OX = 80, VW = 640;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Layout, in canvas units.
  const WHEEL = { fl: [178, 158], fr: [462, 158], rl: [178, 446], rr: [462, 446] };
  const TYRE = { w: 60, h: 118 };
  const QUAD = (w) => ({ x: w === "fl" || w === "rl" ? 0 : W / 2, y: w === "fl" || w === "fr" ? 0 : H / 2, w: W / 2, h: H / 2 });
  const RAILS = [232, 408];
  const FDIFF = [348, 150], RDIFF = [320, 450];
  const ENGINE = { x: 248, y: 196, w: 92, h: 92 };
  const GEARBOX = { x: 276, y: 288, w: 40, h: 40 };
  const TCASE = { x: 258, y: 330, w: 124, h: 46 };
  const TC_FRONT = [366, 330], TC_REAR = [320, 376];

  const COL = {
    flow: "76, 201, 255",
    grip: "#2ee6a6", spin: "#ff5d73", brake: "#ffb347", idle: "#7487ad",
    lock: "#ffc857", lsd: "#b49bff", text: "#eaf2ff", muted: "#a8b7d6"
  };
  const NAMES = { fl: "FRONT LEFT", fr: "FRONT RIGHT", rl: "REAR LEFT", rr: "REAR RIGHT" };

  let canvas, ctx, scale = 1, dpr = 1;
  let result = null, onWheelClick = null;
  let raf = 0, running = false, visible = true, last = 0, time = 0;
  let hover = null;

  // Shown values ease towards the model's, so switching looks smooth.
  const shown = { v: 0, wheel: {}, force: {}, front: 0, rear: 0, glow: {} };
  const phase = { ground: 0, wheel: {}, shaft: { fl: 0, fr: 0, rl: 0, rr: 0, front: 0, rear: 0, main: 0 } };
  C.WHEELS.forEach((w) => { shown.wheel[w] = 0; shown.force[w] = 0; phase.wheel[w] = 0; });
  let flecks = [];

  // ---------------------------------------------------------------- targets
  function wheelState(w) {
    const r = result.wheels[w];
    if (r.surface === "air" && !(r.braked)) return r.slip ? "spin" : "air";
    if (r.braked) return "brake";
    if (r.slip) return "spin";
    if (!r.driven || r.force < 1e-6) return "idle";
    return "grip";
  }

  function targets() {
    const low = result.state.range === "4L";
    const ratio = result.state.lowRatio;
    const v = result.status === "move" ? (low ? 150 / ratio : 150) : 0;
    const spin = low ? 520 / Math.sqrt(ratio) : 560;
    const out = { v: v, wheel: {} };
    C.WHEELS.forEach((w) => {
      const st = wheelState(w);
      if (result.status === "move") out.wheel[w] = st === "brake" ? v * 0.4 : v;
      else if (st === "spin") out.wheel[w] = spin;
      else if (st === "brake") out.wheel[w] = 26;
      else out.wheel[w] = 0;
    });
    if (reduceMotion) { out.v = 0; C.WHEELS.forEach((w) => { out.wheel[w] = 0; }); }
    return out;
  }

  // ---------------------------------------------------------------- drawing helpers
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }

  // The quarter of the ground under one wheel (front left = top left, and so
  // on), scrolling with the vehicle.
  function quadrant(w) {
    const q = QUAD(w);
    const cx = WHEEL[w][0] + OX;
    const sf = C.surface(result.state.surfaces[w]);
    const x = q.x, y = q.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, q.w, q.h);
    ctx.clip();
    const off = phase.ground;
    if (sf.id === "air") {
      const g = ctx.createRadialGradient(cx, WHEEL[w][1], 10, cx, WHEEL[w][1], q.h);
      g.addColorStop(0, "#000208"); g.addColorStop(1, "#0a1230");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, q.w, q.h);
      ctx.strokeStyle = "rgba(120, 170, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let i = -q.h; i < q.w + q.h; i += 16) {
        ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i - q.h, y + q.h); ctx.stroke();
      }
    } else {
      const base = ctx.createLinearGradient(x, y, x + q.w, y + q.h);
      base.addColorStop(0, sf.color); base.addColorStop(1, shade(sf.color, -0.25));
      ctx.fillStyle = base;
      ctx.fillRect(x, y, q.w, q.h);
      const tile = 60, start = Math.floor(-off / tile) - 1;
      for (let row = start; row < start + q.h / tile + 3; row++) {
        const ty = y + row * tile + off;
        for (let k = 0; k < 34; k++) {
          const seed = row * 31 + k * 7 + (w.charCodeAt(0) + w.charCodeAt(1));
          const px = x + hash(seed) * q.w, py = ty + hash(seed + 0.5) * tile;
          ctx.fillStyle = sf.fleck;
          ctx.globalAlpha = 0.25 + 0.45 * hash(seed + 0.9);
          if (sf.id === "sand") {
            ctx.fillRect(px - 14, py, 28, 1.5); // ripples
          } else if (sf.id === "grass") {
            ctx.fillRect(px, py, 1.5, 6);
          } else if (sf.id === "rock") {
            ctx.beginPath(); ctx.arc(px, py, 3 + 6 * hash(seed + 0.3), 0, Math.PI * 2); ctx.fill();
          } else if (sf.id === "ice") {
            ctx.fillRect(px - 10, py, 20 * hash(seed + 0.2) + 4, 1);
          } else if (sf.id === "mud") {
            ctx.beginPath(); ctx.ellipse(px, py, 7 * hash(seed + 0.4) + 3, 3, 0, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.fillRect(px, py, 2.4, 2.4);
          }
        }
      }
      ctx.globalAlpha = 1;
      // the tyre's track through the surface
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(cx - TYRE.w / 2 - 2, y, TYRE.w + 4, q.h);
      if (sf.id === "tar") { // a lane line, like a road
        ctx.fillStyle = "rgba(240, 240, 230, 0.5)";
        const lx = w === "fl" || w === "rl" ? x + 36 : x + q.w - 42;
        for (let ly = y - 80 + (off % 80); ly < y + q.h; ly += 80) ctx.fillRect(lx, ly, 6, 46);
      }
    }
    // darken towards the middle so the drivetrain stands out
    const mid = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 300);
    mid.addColorStop(0, "rgba(4, 8, 23, 0.55)"); mid.addColorStop(1, "rgba(4, 8, 23, 0.05)");
    ctx.fillStyle = mid;
    ctx.fillRect(x, y, q.w, q.h);
    if (hover === w) {
      ctx.fillStyle = "rgba(76, 201, 255, 0.08)";
      ctx.fillRect(x, y, q.w, q.h);
      ctx.strokeStyle = "rgba(76, 201, 255, 0.9)";
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, y + 1.5, q.w - 3, q.h - 3);
    }
    ctx.restore();
  }

  // Lighten (amount > 0) or darken a #rrggbb colour.
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    return "rgb(" + f(n >> 16) + ", " + f((n >> 8) & 255) + ", " + f(n & 255) + ")";
  }

  // Steel: a frame rail, axle housing or crossmember, drawn as a lit beam.
  function beam(x1, y1, x2, y2, width) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = width + 4;
    ctx.beginPath(); ctx.moveTo(x1 + 3, y1 + 4); ctx.lineTo(x2 + 3, y2 + 4); ctx.stroke();
    ctx.strokeStyle = "#3b4560";
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = "rgba(200, 215, 240, 0.35)";
    ctx.lineWidth = Math.max(1, width * 0.22);
    const nx = y2 - y1, ny = x1 - x2, len = Math.hypot(nx, ny) || 1;
    const ox = (nx / len) * width * 0.22, oy = (ny / len) * width * 0.22;
    ctx.beginPath(); ctx.moveTo(x1 - ox, y1 - oy); ctx.lineTo(x2 - ox, y2 - oy); ctx.stroke();
    ctx.restore();
  }

  // A coil spring and shock absorber seen from above, on the axle.
  function spring(x, y) {
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    ctx.beginPath(); ctx.arc(x + 3, y + 4, 15, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#8d99b5";
    ctx.lineWidth = 2.4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath(); ctx.arc(x, y, 14 - i * 2.6, i * 0.7, i * 0.7 + Math.PI * 1.7); ctx.stroke();
    }
    ctx.fillStyle = "#c9d3e8";
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // The engine, gearbox and transfer case: lit from inside, like a cutaway.
  function housing(x, y, w, h, r, glow, edge) {
    ctx.save();
    ctx.shadowColor = glow; ctx.shadowBlur = 22;
    rrect(x, y, w, h, r);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "rgba(76, 201, 255, 0.30)"); g.addColorStop(1, "rgba(47, 107, 255, 0.16)");
    ctx.fillStyle = "#0b1736"; ctx.fill();
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();
    rrect(x, y, w, h, r);
    ctx.strokeStyle = edge; ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // A shaft: dark core plus light whose width is the force it carries.
  function shaft(x1, y1, x2, y2, force, ph, dim) {
    ctx.lineCap = "round";
    ctx.strokeStyle = dim ? "rgba(60, 72, 100, 0.6)" : "rgba(30, 40, 66, 1)";
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.strokeStyle = "rgba(140, 160, 200, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (dim) return;
    const f = Math.max(0, force);
    const width = 1.5 + Math.min(f, 0.7) * 26;
    const a = 0.25 + Math.min(f / 0.35, 1) * 0.6;
    ctx.save();
    ctx.shadowColor = "rgba(" + COL.flow + ", 0.9)";
    ctx.shadowBlur = 6 + width;
    ctx.strokeStyle = "rgba(" + COL.flow + ", " + a + ")";
    ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
    // dashes running at the shaft's speed
    ctx.save();
    ctx.strokeStyle = "rgba(235, 250, 255, " + (0.3 + 0.5 * Math.min(f / 0.3, 1)) + ")";
    ctx.lineWidth = Math.max(1.2, width * 0.35);
    ctx.setLineDash([6, 14]);
    ctx.lineDashOffset = -ph;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function stateColour(st) {
    return st === "grip" ? COL.grip : st === "spin" ? COL.spin : st === "brake" ? COL.brake : COL.idle;
  }

  function tyre(w) {
    const [cx, cy] = WHEEL[w];
    const st = wheelState(w);
    const r = result.wheels[w];
    const air = r.surface === "air";
    const lift = air ? 7 : 0;
    const x = cx - TYRE.w / 2 - lift * 0.6, y = cy - TYRE.h / 2 - lift;
    // shadow (further away when lifted)
    ctx.fillStyle = "rgba(0, 0, 0, " + (air ? 0.35 : 0.5) + ")";
    rrect(cx - TYRE.w / 2 + (air ? 8 : 3), cy - TYRE.h / 2 + (air ? 10 : 4), TYRE.w, TYRE.h, 12);
    ctx.fill();
    // glow in the wheel's colour
    const col = stateColour(st);
    const pulse = st === "spin" ? 0.6 + 0.4 * Math.sin(time * 14) : 1;
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = st === "idle" || st === "air" ? 0 : 18 * pulse;
    rrect(x, y, TYRE.w, TYRE.h, 12);
    ctx.fillStyle = "#151a26";
    ctx.fill();
    ctx.restore();
    // tread, scrolling up as the top of the tyre turns forward
    ctx.save();
    rrect(x, y, TYRE.w, TYRE.h, 12);
    ctx.clip();
    const pitch = 13, off = phase.wheel[w] % pitch;
    ctx.strokeStyle = "rgba(90, 100, 125, 0.95)";
    ctx.lineWidth = 4;
    for (let ty = y - pitch * 2 - off; ty < y + TYRE.h + pitch * 2; ty += pitch) {
      ctx.beginPath();
      ctx.moveTo(x + 4, ty + 6); ctx.lineTo(x + TYRE.w / 2, ty); ctx.lineTo(x + TYRE.w - 4, ty + 6);
      ctx.stroke();
    }
    // a blur over a fast-spinning tyre
    if (shown.wheel[w] > 300) {
      ctx.fillStyle = "rgba(255, 93, 115, 0.18)";
      ctx.fillRect(x, y, TYRE.w, TYRE.h);
    }
    const shade = ctx.createLinearGradient(x, 0, x + TYRE.w, 0);
    shade.addColorStop(0, "rgba(0,0,0,0.55)"); shade.addColorStop(0.5, "rgba(0,0,0,0)"); shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(x, y, TYRE.w, TYRE.h);
    ctx.restore();
    rrect(x + 1, y + 1, TYRE.w - 2, TYRE.h - 2, 11);
    ctx.strokeStyle = col;
    ctx.globalAlpha = st === "idle" || st === "air" ? 0.55 : 0.95;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    // brake caliper glowing when traction control holds this wheel
    if (st === "brake") {
      const inner = w === "fl" || w === "rl" ? x + TYRE.w + 6 : x - 6;
      ctx.save();
      ctx.shadowColor = COL.brake; ctx.shadowBlur = 16 + 6 * Math.sin(time * 9);
      ctx.fillStyle = COL.brake;
      rrect(inner - 4, cy - 16, 8, 32, 3);
      ctx.fill();
      ctx.restore();
    }
  }

  // The green push arrow ahead of each wheel that's driving the vehicle.
  function pushArrow(w) {
    const f = shown.force[w];
    if (f < 0.004) return;
    const st = wheelState(w);
    const [cx, cy] = WHEEL[w];
    const len = 10 + Math.min(f, 0.6) * 110;
    const col = st === "spin" ? COL.spin : st === "brake" ? COL.brake : COL.grip;
    const y0 = cy - TYRE.h / 2 - 6, y1 = y0 - len;
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = 3 + Math.min(f, 0.6) * 10;
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(cx, y0); ctx.lineTo(cx, y1 + 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - 9 - ctx.lineWidth * 0.4, y1 + 12); ctx.lineTo(cx, y1 - 2); ctx.lineTo(cx + 9 + ctx.lineWidth * 0.4, y1 + 12); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Bits of the surface thrown back by a spinning wheel.
  function emit(w, dt) {
    const sf = C.surface(result.state.surfaces[w]);
    if (sf.id === "air" || reduceMotion) return;
    const [cx, cy] = WHEEL[w];
    const n = Math.min(6, Math.floor(dt * 160));
    for (let i = 0; i < n; i++) {
      flecks.push({
        x: cx + OX + (Math.random() - 0.5) * TYRE.w * 0.8, y: cy + TYRE.h / 2,
        vx: (Math.random() - 0.5) * 120, vy: 140 + Math.random() * 260,
        life: 0.5 + Math.random() * 0.5, age: 0, col: sf.id === "tar" ? "#c9ced8" : sf.fleck,
        r: 1.2 + Math.random() * 2.6, smoke: sf.id === "tar"
      });
    }
  }

  function drawFlecks(dt) {
    flecks = flecks.filter((p) => (p.age += dt) < p.life);
    if (flecks.length > 420) flecks.splice(0, flecks.length - 420);
    flecks.forEach((p) => {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.95;
      ctx.globalAlpha = (1 - p.age / p.life) * (p.smoke ? 0.25 : 0.9);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.smoke ? p.r * 4 * (1 + p.age * 3) : p.r, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // A diff: a ring gear turning with the carrier, two spider gears turning
  // only when its two sides turn at different speeds. Locked: gold, with a bar.
  function diff(cx, cy, type, speedA, speedB, label, braking) {
    const r = 26;
    const locked = type === "locked";
    const ring = locked ? COL.lock : type === "lsd" ? COL.lsd : "rgba(" + COL.flow + ", 0.9)";
    ctx.save();
    ctx.fillStyle = "#0b1330";
    ctx.shadowColor = locked ? COL.lock : "rgba(" + COL.flow + ", 0.6)";
    ctx.shadowBlur = locked ? 18 + 4 * Math.sin(time * 3) : 8;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ring; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    // ring gear teeth turning with the carrier
    const carrier = ((speedA + speedB) / 2) * 0.004 * 60;
    const rot = (phase.shaft.main * 0.02 + carrier) % (Math.PI * 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = ring; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.7;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6)); ctx.lineTo(Math.cos(a) * (r - 2), Math.sin(a) * (r - 2)); ctx.stroke();
    }
    ctx.restore();
    // spider gears: turn with the speed difference
    const spiderRot = phase.shaft[label + "Spider"] || 0;
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.translate(cx, cy + side * 9);
      ctx.rotate(side * spiderRot);
      ctx.strokeStyle = locked ? COL.lock : "rgba(234, 242, 255, 0.85)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); ctx.lineTo(Math.cos(a) * 8.5, Math.sin(a) * 8.5); ctx.stroke();
      }
      ctx.restore();
    });
    if (locked) {
      ctx.save();
      ctx.shadowColor = COL.lock; ctx.shadowBlur = 10;
      ctx.strokeStyle = COL.lock; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx - r + 6, cy); ctx.lineTo(cx + r - 6, cy); ctx.stroke();
      ctx.restore();
    }
    if (braking) {
      ctx.strokeStyle = COL.brake; ctx.lineWidth = 2; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function tag(text, x, y, col, align, size) {
    ctx.font = "700 " + (size || 10) + "px Inter, system-ui, sans-serif";
    ctx.textAlign = align || "center";
    ctx.fillStyle = col || COL.muted;
    ctx.fillText(text, x, y);
  }

  const DIFF_NAMES = { open: "OPEN", locked: "LOCKED", lsd: "LSD", tc: "OPEN + TRC", rear: "" };

  // The info block beside each wheel: name, surface, its grip and its push.
  function wheelInfo(w) {
    const r = result.wheels[w];
    const [cx, cy] = WHEEL[w];
    const left = w === "fl" || w === "rl";
    const x = left ? cx - TYRE.w / 2 - 22 : cx + TYRE.w / 2 + 22;
    const align = left ? "right" : "left";
    const st = wheelState(w);
    const sf = C.surface(r.surface);
    // a dark card so the text reads over any ground
    ctx.fillStyle = "rgba(4, 8, 23, 0.72)";
    rrect(left ? x - 98 : x - 10, cy - 70, 108, 112, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(120, 170, 255, 0.18)"; ctx.lineWidth = 1; ctx.stroke();
    let y = cy - 52;
    tag(NAMES[w], x, y, COL.muted, align, 9.5);
    y += 17;
    tag(sf.name.toUpperCase(), x, y, COL.text, align, 12);
    y += 15;
    tag(sf.id === "air" ? "no load, no grip" : "grip " + Math.round(r.grip * 100) + "% of weight", x, y, COL.muted, align, 9.5);
    // bar: the grip this wheel has, and the push it's giving
    const bw = 76, bh = 7, bx = left ? x - bw : x;
    y += 10;
    const maxG = 0.45;
    ctx.fillStyle = "rgba(120, 170, 255, 0.12)";
    rrect(bx, y, bw, bh, 3); ctx.fill();
    const gw = Math.min(r.grip / maxG, 1) * bw;
    ctx.strokeStyle = "rgba(234, 242, 255, 0.55)"; ctx.lineWidth = 1;
    if (gw > 0) { rrect(bx + (left ? bw - gw : 0), y, gw, bh, 3); ctx.stroke(); }
    const fw = Math.min(shown.force[w] / maxG, 1) * bw;
    if (fw > 0.5) {
      ctx.fillStyle = stateColour(st === "air" ? "idle" : st);
      rrect(bx + (left ? bw - fw : 0), y + 1, fw, bh - 2, 2); ctx.fill();
    }
    y += 24;
    const word = { grip: "PUSHING", spin: "SPINNING", brake: "BRAKED BY TRC", idle: r.driven ? "NOT PUSHING" : "NOT DRIVEN", air: "IN THE AIR" }[st];
    tag(word, x, y, stateColour(st), align, 11);
  }

  // ---------------------------------------------------------------- the frame
  function frame(dt) {
    const tg = targets();
    const k = Math.min(1, dt * 4);
    shown.v += (tg.v - shown.v) * k;
    C.WHEELS.forEach((w) => {
      shown.wheel[w] += (tg.wheel[w] - shown.wheel[w]) * Math.min(1, dt * 3);
      shown.force[w] += (result.wheels[w].force - shown.force[w]) * k;
      phase.wheel[w] += shown.wheel[w] * dt;
      phase.shaft[w] += shown.wheel[w] * dt;
    });
    shown.front += (result.frontForce - shown.front) * k;
    shown.rear += (result.rearForce - shown.rear) * k;
    phase.ground += shown.v * dt;
    const sp = { front: (shown.wheel.fl + shown.wheel.fr) / 2, rear: (shown.wheel.rl + shown.wheel.rr) / 2 };
    const frontOff = result.splits.centre === "rear";
    phase.shaft.front += (frontOff ? 0 : sp.front) * dt * 1.6;
    phase.shaft.rear += sp.rear * dt * 1.6;
    phase.shaft.main += ((frontOff ? sp.rear : (sp.front + sp.rear) / 2) * (result.state.range === "4L" ? result.state.lowRatio : 1)) * dt * 1.2;
    phase.shaft.frontSpider = (phase.shaft.frontSpider || 0) + (shown.wheel.fl - shown.wheel.fr) * dt * 0.03;
    phase.shaft.rearSpider = (phase.shaft.rearSpider || 0) + (shown.wheel.rl - shown.wheel.rr) * dt * 0.03;
    if (!reduceMotion) C.WHEELS.forEach((w) => { if (shown.wheel[w] > 200 && wheelState(w) === "spin") emit(w, dt); });

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // the ground: one quarter per wheel, with a soft seam between them
    C.WHEELS.forEach(quadrant);
    ctx.fillStyle = "rgba(4, 8, 23, 0.55)";
    ctx.fillRect(W / 2 - 1.5, 0, 3, H);
    ctx.fillRect(0, H / 2 - 1.5, W, 3);
    drawFlecks(dt);

    // bogged down: the whole vehicle shudders
    ctx.save();
    ctx.translate(OX, 0);
    if (result.status === "bog" && !reduceMotion) ctx.translate((Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.6);

    tag("FRONT", VW / 2, 36, "rgba(234, 242, 255, 0.85)", "center", 10);
    ctx.fillStyle = "rgba(234, 242, 255, 0.85)";
    ctx.beginPath(); ctx.moveTo(VW / 2 - 6, 22); ctx.lineTo(VW / 2, 14); ctx.lineTo(VW / 2 + 6, 22); ctx.closePath(); ctx.fill();

    // the rolling chassis: ladder frame, beam axles, coil springs
    RAILS.forEach((rx) => beam(rx, 62, rx, 540, 12));
    [92, 312, 520].forEach((cy) => beam(RAILS[0], cy, RAILS[1], cy, 8));
    beam(WHEEL.fl[0] + TYRE.w / 2, WHEEL.fl[1], WHEEL.fr[0] - TYRE.w / 2, WHEEL.fr[1], 18);
    beam(WHEEL.rl[0] + TYRE.w / 2, WHEEL.rl[1], WHEEL.rr[0] - TYRE.w / 2, WHEEL.rr[1], 18);
    RAILS.forEach((rx) => { spring(rx, WHEEL.fl[1]); spring(rx, WHEEL.rl[1]); });

    const s = result.splits;
    const fl = shown.force;
    // half shafts, inside the axle housings
    shaft(WHEEL.fl[0] + TYRE.w / 2, WHEEL.fl[1], FDIFF[0] - 26, FDIFF[1], frontOff ? 0 : fl.fl, phase.shaft.fl, frontOff);
    shaft(FDIFF[0] + 26, FDIFF[1], WHEEL.fr[0] - TYRE.w / 2, WHEEL.fr[1], frontOff ? 0 : fl.fr, phase.shaft.fr, frontOff);
    shaft(WHEEL.rl[0] + TYRE.w / 2, WHEEL.rl[1], RDIFF[0] - 26, RDIFF[1], fl.rl, phase.shaft.rl);
    shaft(RDIFF[0] + 26, RDIFF[1], WHEEL.rr[0] - TYRE.w / 2, WHEEL.rr[1], fl.rr, phase.shaft.rr);
    // prop shafts
    shaft(TC_FRONT[0], TC_FRONT[1], FDIFF[0], FDIFF[1] + 26, frontOff ? 0 : shown.front, phase.shaft.front, frontOff);
    shaft(TC_REAR[0], TC_REAR[1], RDIFF[0], RDIFF[1] - 26, shown.rear, phase.shaft.rear);

    // engine and gearbox
    const bog = result.status === "bog";
    housing(ENGINE.x, ENGINE.y, ENGINE.w, ENGINE.h, 12, bog ? COL.spin : "rgba(" + COL.flow + ", 0.8)", bog ? COL.spin : "rgba(" + COL.flow + ", 0.85)");
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = "rgba(200, 230, 255, 0.4)";
      ctx.lineWidth = 1.2;
      rrect(ENGINE.x + 16, ENGINE.y + 13 + i * 17, ENGINE.w - 32, 11, 5);
      ctx.stroke();
    }
    tag("ENGINE", ENGINE.x + ENGINE.w / 2, ENGINE.y - 6, COL.text, "center", 9);
    housing(GEARBOX.x, GEARBOX.y, GEARBOX.w, GEARBOX.h, 8, "rgba(" + COL.flow + ", 0.6)", "rgba(" + COL.flow + ", 0.7)");
    if (bog) tag("BOGGED DOWN", ENGINE.x + ENGINE.w / 2, ENGINE.y + ENGINE.h / 2 + 4, COL.spin, "center", 11);

    // transfer case
    const centreLocked = s.centre === "locked";
    housing(TCASE.x, TCASE.y, TCASE.w, TCASE.h, 10,
      centreLocked ? COL.lock : "rgba(" + COL.flow + ", 0.6)", centreLocked ? COL.lock : "rgba(" + COL.flow + ", 0.85)");
    const range = result.state.range;
    tag(range, TCASE.x + 26, TCASE.y + 30, range === "4L" ? COL.lock : COL.text, "center", 17);
    // centre: a diff on full-time/AWD, a coupling on part-time
    const ccx = TCASE.x + 84, ccy = TCASE.y + TCASE.h / 2;
    if (result.state.system === "part") {
      ctx.strokeStyle = centreLocked ? COL.lock : "rgba(120, 140, 180, 0.6)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ccx - 18, ccy); ctx.lineTo(ccx - 4, ccy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ccx + (centreLocked ? -4 : 6), ccy); ctx.lineTo(ccx + 18, ccy); ctx.stroke();
      ctx.beginPath(); ctx.arc(ccx - 4, ccy, 4, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.save();
      ctx.beginPath(); ctx.arc(ccx, ccy, 15, 0, Math.PI * 2);
      ctx.strokeStyle = centreLocked ? COL.lock : "rgba(" + COL.flow + ", 0.9)";
      ctx.lineWidth = 2;
      ctx.stroke();
      const cs = (phase.shaft.front - phase.shaft.rear) * 0.02;
      ctx.translate(ccx, ccy); ctx.rotate(centreLocked ? 0 : cs);
      ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.moveTo(0, -9); ctx.lineTo(0, 9); ctx.stroke();
      ctx.restore();
    }
    tag("TRANSFER CASE", TCASE.x + TCASE.w / 2, TCASE.y + TCASE.h + 13, COL.muted, "center", 9);
    const centreName = result.state.system === "part"
      ? (centreLocked ? "FRONT + REAR LOCKED TOGETHER" : "FRONT NOT DRIVEN")
      : (centreLocked ? "CENTRE DIFF LOCKED (CDL)" : "CENTRE DIFF " + DIFF_NAMES[s.centre]);
    tag(centreName, TCASE.x + TCASE.w / 2, TCASE.y + TCASE.h + 25, centreLocked ? COL.lock : COL.muted, "center", 9);

    // axle diffs
    diff(FDIFF[0], FDIFF[1], frontOff ? "open" : s.front, shown.wheel.fl, shown.wheel.fr, "front",
      C.WHEELS.slice(0, 2).some((w) => wheelState(w) === "brake"));
    diff(RDIFF[0], RDIFF[1], s.rear, shown.wheel.rl, shown.wheel.rr, "rear",
      C.WHEELS.slice(2).some((w) => wheelState(w) === "brake"));
    tag("FRONT DIFF · " + (frontOff ? "NOT DRIVEN" : DIFF_NAMES[s.front]), FDIFF[0] - 8, FDIFF[1] - 36, s.front === "locked" && !frontOff ? COL.lock : COL.muted, "center", 9);
    tag("REAR DIFF · " + DIFF_NAMES[s.rear], RDIFF[0], RDIFF[1] + 44, s.rear === "locked" ? COL.lock : s.rear === "lsd" ? COL.lsd : COL.muted, "center", 9);

    C.WHEELS.forEach(tyre);
    C.WHEELS.forEach(pushArrow);
    C.WHEELS.forEach(wheelInfo);
    ctx.restore();

    // slope, bottom left
    tag("SLOPE " + result.state.slope + "°", 16, H - 16, COL.muted, "left", 10);
    tag("FORCES AS % OF THE VEHICLE'S WEIGHT · ILLUSTRATIVE", W - 16, H - 16, "rgba(168, 183, 214, 0.55)", "right", 9);
  }

  // ---------------------------------------------------------------- loop, size, input
  function loop(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
    last = t; time += dt;
    frame(dt);
    raf = requestAnimationFrame(loop);
  }

  function runState() {
    const should = !reduceMotion && visible && !document.hidden && !!result;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    if (!should && running) { running = false; cancelAnimationFrame(raf); }
  }

  function resize() {
    const box = canvas.parentElement;
    const maxH = Math.max(380, window.innerHeight * 0.6);
    const cssW = Math.min(box.clientWidth, maxH * (W / H));
    scale = cssW / W;
    dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssW * (H / W) + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssW * (H / W) * dpr);
    if (result) frame(0); // setting the size clears the canvas: redraw now, not on the next tick
  }

  function wheelAt(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W, y = ((e.clientY - rect.top) / rect.height) * H;
    return C.WHEELS.find((w) => { const q = QUAD(w); return x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h; }) || null;
  }

  function init(el, clickHandler) {
    canvas = el;
    ctx = canvas.getContext("2d");
    onWheelClick = clickHandler;
    resize();
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas.parentElement);
    window.addEventListener("resize", resize);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; runState(); }).observe(canvas);
    }
    document.addEventListener("visibilitychange", runState);
    canvas.addEventListener("pointermove", (e) => {
      const w = wheelAt(e);
      if (w !== hover) { hover = w; canvas.style.cursor = w ? "pointer" : "default"; if (!running && result) frame(0); }
    });
    canvas.addEventListener("pointerleave", () => { hover = null; if (!running && result) frame(0); });
    canvas.addEventListener("click", (e) => { const w = wheelAt(e); if (w && onWheelClick) onWheelClick(w); });
  }

  function show(r) {
    result = r;
    if (reduceMotion) {
      C.WHEELS.forEach((w) => { shown.force[w] = r.wheels[w].force; });
      shown.front = r.frontForce; shown.rear = r.rearForce;
    }
    runState();
    if (!running) frame(0);
  }

  return { init: init, show: show };
})();
