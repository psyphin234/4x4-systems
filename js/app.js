/* State, building the controls once, and update(): solve the model, then
   refresh the status, meters, switches and the live drawing. */
(function () {
  "use strict";

  const D = window.SYS_DATA;
  const C = window.SYS_CALC;
  const V = window.SYS_DIAGRAM;
  const KEY = "4x4-systems-v2";
  const $ = (id) => document.getElementById(id);
  const WHEEL_NAMES = { fl: "front left", fr: "front right", rl: "rear left", rr: "rear right" };
  const WHEEL_SHORT = { fl: "Front left", fr: "Front right", rl: "Rear left", rr: "Rear right" };
  const pct = (x) => Math.round(x * 100) + "%";

  // ---------------------------------------------------------------- state
  function fromScenario(id) {
    const sc = D.scenarios.find((s) => s.id === id) || D.scenarios[0];
    return { scenario: sc.id, surfaces: Object.assign({}, sc.wheels), slope: sc.slope };
  }

  let state = Object.assign({}, D.defaults, fromScenario(D.defaults.scenario));
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && saved.surfaces) state = Object.assign(state, saved);
  } catch (e) { /* private mode or bad JSON: use the defaults */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function set(change) {
    state = C.normalise(Object.assign({}, state, change));
    save();
    update();
  }

  // ---------------------------------------------------------------- building the controls
  function radio(el, checked) {
    el.setAttribute("role", "radio");
    el.setAttribute("aria-checked", checked ? "true" : "false");
  }

  function build() {
    // the vehicle
    D.systems.forEach((sys) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick";
      b.dataset.id = sys.id;
      b.innerHTML = "<span class=\"pick-name\"></span><span class=\"pick-sub\"></span>";
      b.querySelector(".pick-name").textContent = sys.name;
      b.querySelector(".pick-sub").textContent = sys.modes.map((m) => m.label).join(" · ") + (sys.cdl ? " · CDL" : "");
      b.addEventListener("click", () => set({ system: sys.id }));
      $("sys-chips").appendChild(b);
    });
    [["open", "Open"], ["lsd", "LSD"]].forEach(([id, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = id;
      b.textContent = label;
      b.addEventListener("click", () => set({ rearLsd: id === "lsd" }));
      $("lsd-seg").appendChild(b);
    });

    $("slope").addEventListener("input", (e) => set({ slope: +e.target.value }));

    // camera views
    document.querySelectorAll("#views button").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#views button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
        V.focus(b.dataset.view);
      });
    });

    // dash switches
    SWITCHES.forEach((sw) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "switch";
      b.dataset.id = sw.id;
      b.innerHTML = "<span class=\"switch-led\" aria-hidden=\"true\"></span><span class=\"switch-icon\" aria-hidden=\"true\"></span><span class=\"switch-name\"></span><span class=\"switch-state\"></span>";
      b.querySelector(".switch-icon").innerHTML = sw.icon;
      b.querySelector(".switch-name").textContent = sw.name;
      b.addEventListener("click", () => set({ [sw.key]: !state[sw.key] }));
      $("switches").appendChild(b);
    });

    $("lowRatio").min = D.lowRange.min;
    $("lowRatio").max = D.lowRange.max;
    $("lowRatio").step = D.lowRange.step;
    $("lowRatio").addEventListener("input", (e) => set({ lowRatio: +e.target.value }));

    // under each wheel: laid out like the wheels, three buttons each
    C.WHEELS.forEach((w) => {
      const box = document.createElement("div");
      box.className = "wheel-pick wheel-pick--" + w;
      box.setAttribute("role", "radiogroup");
      box.setAttribute("aria-label", WHEEL_SHORT[w] + " wheel");
      const name = document.createElement("span");
      name.className = "wheel-pick-name";
      name.textContent = WHEEL_SHORT[w];
      box.appendChild(name);
      D.surfaces.forEach((sf) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ground ground--" + sf.id;
        b.dataset.wheel = w;
        b.dataset.id = sf.id;
        b.innerHTML = "<span class=\"ground-swatch\" aria-hidden=\"true\"></span><span></span>";
        b.lastChild.textContent = sf.label;
        b.title = sf.name + ": " + sf.short.toLowerCase();
        b.setAttribute("aria-label", sf.name);
        b.addEventListener("click", () => setSurface(w, sf.id));
        box.appendChild(b);
      });
      $("wheel-grid").appendChild(box);
    });

    const gaps = $("gaps");
    D.gaps.forEach((g) => { const li = document.createElement("li"); li.textContent = g; gaps.appendChild(li); });
    $("year").textContent = new Date().getFullYear();
  }

  // Icons for the dash switches (simple line drawings, like dash buttons).
  const ICON_DIFF = "<svg viewBox=\"0 0 32 20\"><path d=\"M2 10h8M22 10h8\"/><circle cx=\"16\" cy=\"10\" r=\"6\"/>";
  const SWITCHES = [
    { id: "cdl", key: "cdl", name: "Centre diff lock", short: "CDL",
      icon: "<svg viewBox=\"0 0 32 20\"><path d=\"M16 1v5M16 14v5\"/><circle cx=\"16\" cy=\"10\" r=\"5\"/><path d=\"M6 3h20M6 17h20\"/></svg>" },
    { id: "rearLock", key: "rearLock", name: "Rear diff lock", short: "Rear locker",
      icon: ICON_DIFF + "<path d=\"M13 10h6\"/><path d=\"M4 18h24\"/></svg>" },
    { id: "frontLock", key: "frontLock", name: "Front diff lock", short: "Front locker",
      icon: ICON_DIFF + "<path d=\"M13 10h6\"/><path d=\"M4 2h24\"/></svg>" },
    { id: "trc", key: "trc", name: "Traction control", short: "TRC",
      icon: "<svg viewBox=\"0 0 32 20\"><path d=\"M10 2l-3 16M22 2l3 16\"/><path d=\"M9 7c2 2 4-2 7 0s5-2 7 0M8 13c2 2 4-2 7 0s5-2 8 0\"/></svg>" }
  ];

  // The transfer lever: one button per position of this system's lever.
  let leverFor = null;
  function buildLever(sys) {
    if (leverFor === sys.id) return;
    leverFor = sys.id;
    const lever = $("lever");
    lever.innerHTML = "";
    lever.style.gridTemplateColumns = "repeat(" + sys.modes.length + ", 1fr)";
    sys.modes.forEach((m) => {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = m.id;
      if (m.low) b.dataset.low = "true";
      b.innerHTML = "<span class=\"lever-led\" aria-hidden=\"true\"></span><span></span>";
      b.lastChild.textContent = m.label;
      b.title = MODE_HINT[m.centre] + (m.low ? ", low range" : "");
      b.addEventListener("click", () => set({ mode: m.id }));
      lever.appendChild(b);
    });
  }
  const MODE_HINT = {
    rear: "Rear-wheel drive only", locked: "Front and rear locked together", open: "Full-time 4WD, open centre diff",
    torsen: "Full-time 4WD, Torsen centre diff", clutch: "Auto 4WD: the clutch feeds the front as needed"
  };

  function setSurface(w, id) {
    const surfaces = Object.assign({}, state.surfaces, { [w]: id });
    set({ surfaces: surfaces, scenario: null });
  }

  // Clicking the ground in the picture steps through the surfaces.
  function cycleSurface(w) {
    const ids = D.surfaces.map((s) => s.id);
    setSurface(w, ids[(ids.indexOf(state.surfaces[w]) + 1) % ids.length]);
  }

  // ---------------------------------------------------------------- the status
  const SPLIT_NAMES = { open: "open", lsd: "limited-slip", tc: "open", locked: "locked" };

  // Why it's stuck, in a sentence or two.
  function reasons(r) {
    const out = [];
    const k = r.splits, wh = r.wheels;
    if (k.centre === "rear") out.push("In 2H only the rear wheels drive.");
    [["front", "fl", "fr"], ["rear", "rl", "rr"]].forEach(([axle, a, b]) => {
      if (axle === "front" && k.centre === "rear") return;
      const type = k[axle];
      if (type !== "open" && type !== "lsd") return;
      const sa = wh[a].slip, sb = wh[b].slip;
      if (sa !== sb) {
        const spinner = sa ? a : b, other = sa ? b : a;
        out.push("The " + SPLIT_NAMES[type] + " " + axle + " diff gives the " + WHEEL_NAMES[other] + " wheel only " +
          (type === "lsd" ? "a few times " : "") + "what the spinning " + WHEEL_NAMES[spinner] + " wheel can hold" +
          (wh[spinner].surface === "air" ? " (nothing: it's in the air)." : "."));
      }
    });
    if (k.centre === "open" || k.centre === "torsen") {
      const fs = wh.fl.slip || wh.fr.slip, rs = wh.rl.slip || wh.rr.slip;
      if (fs !== rs) out.push("The " + (k.centre === "torsen" ? "Torsen" : "open") + " centre diff holds the " + (fs ? "rear" : "front") +
        " axle back to " + (k.centre === "torsen" ? "a few times " : "") + "what the " + (fs ? "front" : "rear") + " axle can take.");
    }
    if (k.centre === "clutch" && r.clutch === "max") out.push("The 4A clutch is already passing all it can to the front.");
    if (!out.length) out.push("Every driven wheel is already pulling its weight: there isn't enough grip for this slope.");
    return out;
  }

  function renderStatus(r) {
    const el = $("status");
    el.className = "status status--" + r.status;
    const icon = { move: "&#10003;", spin: "!", bog: "!" }[r.status];
    const head = { move: "Driving on", spin: "Stuck: wheels spinning", bog: "Stuck: not enough pull" }[r.status];
    let sub;
    if (r.status === "move") {
      sub = r.low
        ? "In low range: slow, with the engine's pull multiplied ×" + r.state.lowRatio.toFixed(1) + "."
        : "The drivetrain can put " + pct(r.grip) + " of the weight to the ground and it needs " + pct(r.need) + ".";
    } else if (r.status === "spin") {
      sub = reasons(r).join(" ");
    } else {
      sub = "The tyres could take " + pct(r.grip) + " of the weight, but the engine only pulls " + pct(r.pull) +
        (r.low ? " even in low range" : " in high range") + ", and the climb needs " + pct(r.need) + ".";
    }
    el.innerHTML = "<span class=\"status-icon\" aria-hidden=\"true\">" + icon + "</span>" +
      "<div class=\"status-text\"><p class=\"status-head\"></p><p class=\"status-sub\"></p><div class=\"status-fix\"></div></div>";
    el.querySelector(".status-head").textContent = head;
    el.querySelector(".status-sub").textContent = sub;

    const fix = el.querySelector(".status-fix");
    const options = C.suggest(state).slice(0, 4);
    suggested = new Set();
    if (r.status !== "move") {
      if (options.length) {
        const lab = document.createElement("span");
        lab.className = "fix-label";
        lab.textContent = "Gets it moving:";
        fix.appendChild(lab);
        options.forEach((opt) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "fix";
          b.textContent = opt.map((t) => t.label).join(" + ");
          b.addEventListener("click", () => set(Object.assign({}, ...opt.map((t) => t.change))));
          fix.appendChild(b);
          opt.forEach((t) => suggested.add(t.id));
        });
      } else {
        const p = document.createElement("span");
        p.className = "fix-label";
        p.textContent = "Nothing on this vehicle gets it moving here: try another vehicle, or less slope.";
        fix.appendChild(p);
      }
    }
  }
  let suggested = new Set();

  // Three bars on one scale: what it needs, what the drivetrain can put down,
  // what the engine can pull.
  function renderMeters(r) {
    const max = Math.max(0.5, r.need, r.grip, r.pull, r.totalGrip) * 1.08;
    const rows = [
      { id: "need", label: "Needed to keep going", value: r.need, cls: "need" },
      { id: "grip", label: "Grip the drivetrain can use", value: r.grip, cls: r.grip + 1e-9 >= r.need ? "ok" : "short",
        ghost: r.totalGrip, ghostLabel: "all four tyres' grip" },
      { id: "pull", label: "Engine pull at the wheels" + (r.low ? " (low range)" : ""), value: r.pull,
        cls: r.pull + 1e-9 >= r.need ? "ok" : "short" }
    ];
    const box = $("meters");
    box.innerHTML = "";
    rows.forEach((row) => {
      const div = document.createElement("div");
      div.className = "meter meter--" + row.cls;
      div.innerHTML = "<span class=\"meter-label\"></span><span class=\"meter-track\"><span class=\"meter-fill\"></span>" +
        (row.ghost != null ? "<span class=\"meter-ghost\"></span>" : "") +
        "<span class=\"meter-need\"></span></span><span class=\"meter-value\"></span>";
      div.querySelector(".meter-label").textContent = row.label;
      div.querySelector(".meter-fill").style.width = (row.value / max) * 100 + "%";
      div.querySelector(".meter-need").style.left = (r.need / max) * 100 + "%";
      if (row.ghost != null) {
        const g = div.querySelector(".meter-ghost");
        g.style.left = (row.ghost / max) * 100 + "%";
        g.title = row.ghostLabel + ": " + pct(row.ghost);
      }
      div.querySelector(".meter-value").textContent = pct(row.value);
      box.appendChild(div);
    });
    const p = document.createElement("p");
    p.className = "hint meters-hint";
    p.textContent = "As % of the vehicle's weight. The white line is what it needs; the faint tick on the grip bar is what all four tyres could give if every wheel were locked together.";
    box.appendChild(p);
  }

  // ---------------------------------------------------------------- update
  function update() {
    state = C.normalise(state);
    const r = C.solve(state);
    const sys = C.system(state.system);

    document.querySelectorAll("#sys-chips .pick").forEach((b) => radio(b, b.dataset.id === state.system));
    $("sys-blurb").textContent = sys.blurb;
    document.querySelectorAll("#lsd-seg button").forEach((b) => radio(b, (b.dataset.id === "lsd") === !!state.rearLsd));
    $("slope").value = state.slope;
    $("slope-out").textContent = state.slope + "°";

    renderStatus(r);

    buildLever(sys);
    document.querySelectorAll("#lever button").forEach((b) => {
      radio(b, b.dataset.id === state.mode);
      b.classList.toggle("suggest", suggested.has("mode-" + b.dataset.id));
    });
    document.querySelectorAll("#switches .switch").forEach((b) => {
      const sw = SWITCHES.find((s) => s.id === b.dataset.id);
      let avail = true, why = "";
      if (sw.id === "cdl" && !sys.cdl) {
        avail = false;
        why = { part: "No centre diff: 4H locks it", ss2: "On the lever: 4HLc / 4LLc", tod: "No diff: 4H clamps the clutch" }[state.system] || "Not fitted";
      }
      const on = avail && !!state[sw.key];
      b.disabled = !avail;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.querySelector(".switch-state").textContent = avail ? (on ? "ON" : "OFF") : why;
      b.classList.toggle("suggest", suggested.has(sw.id));
    });
    $("lowRatio").value = state.lowRatio;
    $("ratio-out").textContent = "×" + (+state.lowRatio).toFixed(1);
    document.querySelectorAll("#wheel-grid .ground").forEach((b) => radio(b, state.surfaces[b.dataset.wheel] === b.dataset.id));

    const cautions = $("cautions");
    cautions.innerHTML = "";
    r.warnings.forEach((wn) => {
      const p = document.createElement("p");
      p.className = "caution";
      p.textContent = wn.text;
      cautions.appendChild(p);
    });

    renderMeters(r);
    V.show(r);
  }

  build();
  V.init($("view"), cycleSurface);
  update();
  // a link such as #view-tcase opens zoomed in on that part
  const hv = /^#view-(\w+)$/.exec(location.hash);
  if (hv) { const b = document.querySelector("#views button[data-view='" + hv[1] + "']"); if (b) b.click(); }
})();
