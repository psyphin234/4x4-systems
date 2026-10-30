// Meshing check (dev only): for each pair of meshing gears, the distance
// between the nearest tooth centres of the two gears now ("cur") and with the
// second gear turned half a tooth ("half"). Teeth sitting in gaps: cur > half.
// Run at several moments: cur must stay the same (no drift).
(function () {
  const T = THREE;
  function teeth(g) {
    g.updateMatrixWorld(true);
    const inst = g.children.find((c) => c.isInstancedMesh);
    const M = new T.Matrix4(), out = [];
    for (let i = 0; i < inst.count; i++) {
      inst.getMatrixAt(i, M);
      M.premultiply(inst.matrixWorld);
      out.push(new T.Vector3().setFromMatrixPosition(M));
    }
    return out;
  }
  function minDist(A, B) {
    let m = 1e9;
    A.forEach((a) => B.forEach((b) => { m = Math.min(m, a.distanceTo(b)); }));
    return m;
  }
  function pair(a, b, nb) {
    const cur = minDist(teeth(a), teeth(b));
    const keep = b.rotation.y;
    b.rotation.y += Math.PI / nb;
    const half = minDist(teeth(a), teeth(b));
    b.rotation.y = keep;
    return { cur: +cur.toFixed(4), half: +half.toFixed(4), ok: cur > half };
  }
  window.meshCheck = function (pairs) {
    const rows = [];
    pairs.forEach(([name, a, b, nb]) => rows.push(name + " " + JSON.stringify(pair(a, b, nb))));
    return rows;
  };
})();
