'use strict';
/* 角色冒險（2.5D 單人體驗）
   沿用迷宮尋寶的地圖產生（game.js 的 gen）、地景繪製（render.js 的 getBase）與寶石／寶箱／小怪獸資料，
   再用 SWT MindFlow 角色系統（/character）讓背包客在迷宮裡自由移動。多人連線模式完全不受影響。 */
(function () {
  const NS = window.MFChar, THREE = window.THREE, d = document, $ = id => d.getElementById(id);
  const boot = $('aBoot');
  if (!THREE || !NS) { boot.textContent = '3D 引擎載入失敗，請重新整理。'; return; }

  /* ===== 參數（網址：?li=難度 0–3 &th=環境 0–5 &char=boy-ai|girl-ai） ===== */
  const QS = new URLSearchParams(location.search);
  const int = (v, lo, hi, def) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= lo && n <= hi ? n : def; };
  const li = int(QS.get('li'), 0, LV.length - 1, 0);          // 預設「入門」：最小的地圖
  const th = int(QS.get('th'), 0, TH.length - 1, 0);
  const seed = int(QS.get('sd'), 1, 2147483646, (Math.random() * 2147483646 | 0) + 1);
  const T = TH[th];
  const CS = 1.25;          // 一格的邊長（公尺）；角色身高約 1
  const WALL_H = 0.9;       // 牆高：比跳躍高度高，跳不過去
  const fmt = ms => { ms = Math.max(0, ms | 0); const m = ms / 60000 | 0, s = (ms % 60000) / 1000; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

  /* ===== 迷宮資料（與多人模式同一個產生器） ===== */
  const lv = gen(seed, li); lv.key = 'adv/' + seed + '/' + li;
  const W = lv.W, H = lv.H;
  const wx = x => (x - (W - 1) / 2) * CS, wz = y => (y - (H - 1) / 2) * CS;
  const isWall = (x, y) => x < 0 || y < 0 || x >= W || y >= H || !!lv.g[y * W + x];
  const cellOf = (X, Z) => [Math.round(X / CS + (W - 1) / 2), Math.round(Z / CS + (H - 1) / 2)];

  /* ===== 輸入（左手搖桿、右手技能；電腦鍵盤） ===== */
  const stage = $('stage');
  NS.lockBrowserGestures(stage);
  const input = new NS.InputManager({ root: stage, uiParent: stage });
  const device = input.device;

  /* ===== 場景 ===== */
  const renderer = new THREE.WebGLRenderer({ canvas: $('cv'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
  const scene = new THREE.Scene();
  scene.background = lin(T.bg);
  scene.fog = new THREE.Fog(lin(T.bg), 14, 30);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  scene.add(new THREE.HemisphereLight(0xfff6e6, 0x3a4a44, 0.75));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.15);
  sun.castShadow = true; sun.shadow.mapSize.set(device.kind === 'phone' ? 1024 : 2048, device.kind === 'phone' ? 1024 : 2048);
  { const c = sun.shadow.camera; c.left = c.bottom = -7; c.right = c.top = 7; c.near = 0.5; c.far = 30; sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03; }
  scene.add(sun, sun.target);
  const clay = (hex, o) => new THREE.MeshStandardMaterial(Object.assign({ color: lin(hex), roughness: 0.85, metalness: 0 }, o || {}));

  // 地面：直接使用原本 2D 版畫好的地景（render.js 的 getBase），視覺與多人模式一致
  const baseTex = new THREE.CanvasTexture(getBase(lv, th));
  baseTex.encoding = THREE.sRGBEncoding; baseTex.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W * CS, H * CS), new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  // 牆：每個牆格長成一塊立體方塊；頂面貼原本的牆面圖案，側面用同一張圖加深
  (function buildWalls() {
    const pos = [], uv = [], col = [], idx = [];
    const quad = (a, b, c, e, u0, v0, u1, v1, k0, k1) => {
      const n = pos.length / 3;
      [a, b, c, e].forEach(p => pos.push(p[0], p[1], p[2]));
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      [k0, k0, k1, k1].forEach(k => col.push(k, k, k));
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!lv.g[y * W + x]) continue;
      const x0 = wx(x) - CS / 2, x1 = x0 + CS, z0 = wz(y) - CS / 2, z1 = z0 + CS, h = WALL_H;
      const u0 = x / W, u1 = (x + 1) / W, v0 = 1 - (y + 1) / H, v1 = 1 - y / H;
      quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], u0, v0, u1, v1, 1, 1);                       // 頂面
      if (!isWall(x, y + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], u0, v0, u1, v1, .45, .78);   // 南（面向鏡頭）
      if (!isWall(x, y - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], u0, v0, u1, v1, .35, .6);
      if (!isWall(x + 1, y)) quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], u0, v0, u1, v1, .4, .7);
      if (!isWall(x - 1, y)) quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], u0, v0, u1, v1, .4, .7);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: baseTex, vertexColors: true, roughness: 0.9 }));
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  })();

  /* ===== 碰撞：角色是圓，牆是方格；推出牆外並去掉撞牆方向的速度（可沿牆滑行） ===== */
  function pushOut(P, r, v) {
    let hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const [cx, cy] = cellOf(P.x, P.z);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = cx + i, gy = cy + j; if (!isWall(gx, gy)) continue;
        const minX = wx(gx) - CS / 2, maxX = minX + CS, minZ = wz(gy) - CS / 2, maxZ = minZ + CS;
        const qx = Math.max(minX, Math.min(P.x, maxX)), qz = Math.max(minZ, Math.min(P.z, maxZ));
        let dx = P.x - qx, dz = P.z - qz, dd = Math.hypot(dx, dz);
        if (dd >= r) continue;
        if (dd < 1e-6) {                       // 中心已在牆內：往最近的邊推出去
          const e = [P.x - minX, maxX - P.x, P.z - minZ, maxZ - P.z], k = e.indexOf(Math.min(...e));
          dx = [-1, 1, 0, 0][k]; dz = [0, 0, -1, 1][k]; dd = 0;
          P.x += dx * (e[k] + r); P.z += dz * (e[k] + r);
        } else { const nx = dx / dd, nz = dz / dd; P.x = qx + nx * r; P.z = qz + nz * r; dx = nx; dz = nz; }
        if (v) { const vn = v.x * dx + v.z * dz; if (vn < 0) { v.x -= vn * dx; v.z -= vn * dz; } }
        hit = true;
      }
    }
    return hit;
  }
  function circleFree(x, z, r) {
    const [cx, cy] = cellOf(x, z);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j; if (!isWall(gx, gy)) continue;
      const minX = wx(gx) - CS / 2, minZ = wz(gy) - CS / 2;
      const qx = Math.max(minX, Math.min(x, minX + CS)), qz = Math.max(minZ, Math.min(z, minZ + CS));
      if (Math.hypot(x - qx, z - qz) < r) return false;
    }
    return true;
  }

  /* ===== 寶箱與寶石（同色配對，沿用 BC 顏色） ===== */
  const inter = new NS.InteractionManager();
  inter.bounds = 1e6;
  inter.placeFilter = (x, z, it) => circleFree(x, z, it.radius + 0.03);
  const home = lv.targets.map(() => false);
  const chests = lv.targets.map((t, i) => {
    const x = wx(t[0]), z = wz(t[1]), g = new THREE.Group(), c = lin(BC[i]);
    const wood = clay(0x7a4a26), trim = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: c, emissiveIntensity: 0.15 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.46), wood); base.position.y = 0.15; g.add(base);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.1, 0.48), clay(0x93603a)); lid.position.y = 0.36; g.add(lid);
    [-0.22, 0.22].forEach(k => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.5), trim); b.position.set(k, 0.21, 0); g.add(b); });
    const lock = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), trim); lock.position.set(0, 0.26, 0.25); g.add(lock);
    const glow = new THREE.PointLight(c, 0, 2.2); glow.position.y = 0.7; g.add(glow);
    g.position.set(x, 0, z);
    g.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    scene.add(g);
    const surf = { id: 'chest' + i, kind: 'chest', idx: i, x, z, r: 0.42, h: 0.41 };
    inter.surfaces.push(surf);
    inter.obstacles.push({ x, z, r: 0.34, h: 0.41, surfaceId: surf.id });
    return { g, glow, lid, x, z };
  });
  const gems = lv.balls.map((b, i) => {
    const g = new THREE.Group(), c = lin(BC[i]);
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), new THREE.MeshStandardMaterial({ color: c, roughness: 0.25, metalness: 0.1, emissive: c, emissiveIntensity: 0.35, flatShading: true }));
    m.scale.set(1, 1.25, 1); m.position.y = 0.19; g.add(m);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.position.set(wx(b[0]), 0, wz(b[1])); scene.add(g);
    return inter.addItem({ id: 'gem' + i, idx: i, name: '寶石', icon: '💎', radius: 0.17, height: 0.38, weight: 1.2, obj: g, pos: { x: wx(b[0]), y: 0, z: wz(b[1]) } });
  });

  /* ===== 小怪獸（沿用原本的巡邏路線與步調） ===== */
  const MCOL = (typeof MC !== 'undefined' ? MC : ['#d9f27a'])[th] || '#d9f27a';
  const mons = (lv.mons || []).map((path, i) => {
    const k = (i * 2) % path.length, g = new THREE.Group(), c = lin(MCOL);
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.4 }));
    body.position.y = 0.42; body.castShadow = true; g.add(body);
    [-1, 1].forEach(s => {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), clay(0x1a1a24)); e.position.set(s * 0.09, 0.47, 0.22); g.add(e);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), clay(0xffffff)); h.position.set(s * 0.09 - 0.015, 0.49, 0.27); g.add(h);
    });
    const glow = new THREE.PointLight(c, 0.6, 2.5); glow.position.y = 0.5; g.add(glow);
    g.position.set(wx(path[k][0]), 0, wz(path[k][1])); scene.add(g);
    return { path, k, d: 1, g, cell: path[k].slice(), body };
  });
  let monT = 0;
  function monStep() {
    mons.forEach(m => {
      let nk = m.k + m.d;
      if (nk < 0 || nk >= m.path.length) { m.d = -m.d; nk = m.k + m.d; }
      const t = m.path[nk];
      if (gems.some(it => { const c = cellOf(it.pos.x, it.pos.z); return it.state !== 'held' && c[0] === t[0] && c[1] === t[1]; })) { m.d = -m.d; return; }  // 寶石擋路就折返
      m.k = nk; m.cell = t.slice();
    });
  }

  /* ===== 玩家（背包客） ===== */
  const AI = (window.MFCHAR_MODELS || []).map(m => Object.assign({}, m, { url: '/character/' + m.url }));
  let charIdx = Math.max(0, AI.findIndex(m => m.id === QS.get('char')));
  const player = NS.createPlayer({ THREE, scene, input, interaction: inter, character: 'boy', controller: { bounds: 1e6 } });
  player.controller.collider = (P, v, r) => pushOut(P, r, v);
  const spawn = [lv.spawn % W, lv.spawn / W | 0];
  function toSpawn() { const C = player.controller; C.pos.x = wx(spawn[0]); C.pos.z = wz(spawn[1]); C.pos.y = 0; C.vel.x = C.vel.z = C.vel.y = 0; C.yaw = C.targetYaw = Math.PI; }
  toSpawn();
  const glbCache = {};
  function applyChar(done) {
    const m = AI[charIdx]; $('aChar').textContent = m ? m.label : '🧑 背包客';
    if (!m) { if (done) done(); return; }
    if (glbCache[m.id]) { player.setCharacter({ rig: glbCache[m.id] }); if (done) done(); return; }
    NS.GLBCharacterLoader.load(THREE, m.url, Object.assign({ height: 1 }, m, { name: m.label })).then(rig => {
      rig.keep = true; glbCache[m.id] = rig; if (AI[charIdx] === m) player.setCharacter({ rig }); if (done) done();
    }, err => { console.error(err); toast('角色模型載入失敗，先用備用角色'); if (done) done(); });
  }
  if (AI.length) { player.object.visible = false; applyChar(() => { player.object.visible = true; ready(); }); } else ready();

  /* ===== 鏡頭：2.5D 斜俯視跟隨；滑鼠或右半邊拖曳可轉動 ===== */
  const cam = { yaw: 0, dist: 3.3, height: 6.2, pos: new THREE.Vector3(), look: new THREE.Vector3() };
  function updateCamera(dt, snap) {
    const P = player.controller.pos, portrait = innerHeight > innerWidth;
    const dist = cam.dist * (portrait ? 1.15 : 1), h = cam.height * (portrait ? 1.3 : 1);
    const k = snap ? 1 : 1 - Math.exp(-5 * dt);
    cam.pos.x += (P.x + Math.sin(cam.yaw) * dist - cam.pos.x) * k;
    cam.pos.y += (h + P.y * 0.3 - cam.pos.y) * k;
    cam.pos.z += (P.z + Math.cos(cam.yaw) * dist - cam.pos.z) * k;
    cam.look.x += (P.x - cam.look.x) * k; cam.look.y += (0.45 - cam.look.y) * k; cam.look.z += (P.z - cam.look.z) * k;
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    sun.position.set(P.x + 3, 9, P.z + 5); sun.target.position.set(P.x, 0, P.z);
  }
  function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.fov = innerWidth < innerHeight ? 55 : 42; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize(); updateCamera(0, true);

  /* ===== HUD 與遊戲流程 ===== */
  let toastT = 0, t0 = 0, el = 0, done = false, freezeT = 0, hits = 0;
  function toast(s) { const t = $('aToast'); t.textContent = s; t.classList.add('on'); toastT = 1.8; }
  function setGems() { $('aGems').textContent = '寶石 ' + home.filter(Boolean).length + '/' + home.length; }
  setGems();
  $('aLevel').textContent = LV[li].n + '・' + W + '×' + H;
  const reload = p => { const q = new URLSearchParams(location.search); Object.keys(p).forEach(k => p[k] == null ? q.delete(k) : q.set(k, p[k])); location.search = q.toString(); };
  $('aLevel').onclick = () => reload({ li: (li + 1) % LV.length, sd: null });
  $('aChar').onclick = () => { if (AI.length < 2) return; charIdx = (charIdx + 1) % AI.length; applyChar(); const q = new URLSearchParams(location.search); q.set('char', AI[charIdx].id); history.replaceState(null, '', '?' + q); };

  inter.on('grabDone', it => toast('拿起了 ' + it.icon + ' 寶石，帶到同色寶箱放下'));
  inter.on('grabStart', it => { if (home[it.idx]) { home[it.idx] = false; setGems(); } });
  inter.on('placed', e => {
    const it = e.item, s = inter.surfaces.find(q => q.id === e.place.surface);
    if (s && s.kind === 'chest') {
      if (s.idx === it.idx) { home[it.idx] = true; chime([660, 990]); toast('寶石歸位！'); if (home.every(Boolean)) finish(); else player.sm.queued = 'CELEBRATE'; }
      else toast('顏色不一樣，換一個寶箱試試');
    }
    setGems();
  });
  function finish() {
    done = true; el = performance.now() - t0; player.sm.queued = 'CELEBRATE'; chime([523, 659, 784, 1047]);
    setTimeout(() => {
      const ov = $('aOv'); ov.hidden = false;
      ov.innerHTML = '<div class="card"><h2>全部寶石歸位</h2><div class="tbig">' + fmt(el) + '</div>' + (hits ? '<p>被小怪獸撞到 ' + hits + ' 次</p>' : '') +
        '<div class="row"><button class="abtn" id="aAgain">再玩一局</button>' + (li < LV.length - 1 ? '<button class="abtn" id="aNext">下一個難度</button>' : '') + '<a class="abtn" href="/">回首頁</a></div></div>';
      $('aAgain').onclick = () => reload({ sd: null });
      const nx = $('aNext'); if (nx) nx.onclick = () => reload({ li: li + 1, sd: null });
    }, 1600);
  }
  let AC;
  function chime(fs) {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume();
      const t = AC.currentTime;
      fs.forEach((f, i) => { const o = AC.createOscillator(), g = AC.createGain(), s = t + i * .18; o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(.1, s + .03); g.gain.exponentialRampToValueAtTime(.001, s + 1.6); o.connect(g); g.connect(AC.destination); o.start(s); o.stop(s + 1.7); });
    } catch (e) { /* 沒有音效也能玩 */ }
  }

  /* ===== 主迴圈 ===== */
  let last = performance.now(), started = false, readyFlag = false;
  function ready() { readyFlag = true; boot.classList.add('done'); toast('把每顆寶石搬進同顏色的寶箱'); }
  const hi = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.25, 32), new THREE.MeshBasicMaterial({ color: lin(0x7ee0c3), transparent: true, opacity: 0.9, depthWrite: false }));
  hi.rotation.x = -Math.PI / 2; hi.visible = false; scene.add(hi);
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    const s = input.sample(dt);
    cam.yaw -= s.cameraDelta * 0.006;
    if (!started && readyFlag && (s.mag > 0.1 || s.actions.length)) { started = true; t0 = now; }
    if (freezeT > 0 || done) { freezeT -= dt; s.moveX = s.moveY = s.mag = 0; s.sprint = false; if (done) s.actions.length = 0; }
    player.update(dt, cam.yaw, s);
    const C = player.controller;
    // 小怪獸
    if ((monT += dt * 1000) >= LV[li].ms) { monT = 0; monStep(); }
    mons.forEach((m, i) => {
      const tx = wx(m.cell[0]), tz = wz(m.cell[1]), g = m.g, k = 1 - Math.exp(-10 * dt);
      g.position.x += (tx - g.position.x) * k; g.position.z += (tz - g.position.z) * k;
      m.body.position.y = 0.42 + Math.sin(now / 300 + i * 2) * 0.05;
      const dx = C.pos.x - g.position.x, dz = C.pos.z - g.position.z;
      if (!done && freezeT <= 0 && C.pos.y < 0.45 && Math.hypot(dx, dz) < 0.55) {
        hits++; freezeT = 3; toSpawn(); updateCamera(0, true); chime([196, 165]); toast('撞到小怪獸，回到起點，3 秒後可以繼續');
        if (navigator.vibrate) try { navigator.vibrate([120, 60, 120]); } catch (e) { /* ignore */ }
      }
    });
    // 寶箱：寶石歸位後發光
    chests.forEach((c, i) => { c.glow.intensity += ((home[i] ? 1.6 + Math.sin(now / 300) * 0.3 : 0) - c.glow.intensity) * 0.1; });
    gems.forEach((it, i) => { if (it.state !== 'held' && it.obj.children[0]) it.obj.children[0].rotation.y = now / 900 + i; });
    // 目標提示與 HUD
    const tg = inter.target; hi.visible = !!tg;
    if (tg) { hi.position.set(tg.pos.x, tg.pos.y + 0.01, tg.pos.z); const sc = (tg.radius + 0.08) / 0.25 * (1 + Math.sin(now / 180) * 0.06); hi.scale.set(sc, sc, 1); }
    const hc = $('aHeld'); if (inter.held) { hc.hidden = false; hc.textContent = '持有 ' + inter.held.icon; } else hc.hidden = true;
    $('aClock').textContent = fmt(done ? el : started ? now - t0 : 0);
    if (toastT > 0 && (toastT -= dt) <= 0) $('aToast').classList.remove('on');
    player.object.children.forEach(o => { o.visible = freezeT > 0 ? Math.sin(now / 80) > -0.3 : true; });
    updateCamera(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  // 給自動化測試使用
  window.__adv = { player, input, inter, lv, cellOf, wx, wz, isWall, gems, chests, mons, home, cam, CS, get done() { return done; }, get ready() { return readyFlag; }, get hits() { return hits; } };
})();
