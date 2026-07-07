/* =====================================================================
   퍼스트 퀸 IV 재현 목업 — 엔진
   전략(턴제 지역 점령) + 고챠캐릭(ごちゃキャラ) 실시간 난전
   ===================================================================== */
var FQ = (function () {
  'use strict';

  var TS = 32;                       // 타일 크기(px)
  var VIEW_W = 960, VIEW_H = 600;    // 전투 캔버스 내부 해상도
  var SAVE_KEY = 'fq4_save_v1';

  /* ================= 유틸 ================= */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function rnd() { return Math.random(); }
  function irnd(n) { return Math.floor(Math.random() * n); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var UIDC = 1;

  /* ================= 게임 상태 ================= */
  var G = {
    screen: 'title',
    turn: 1,
    army: [],            // 원정군 명부 [{uid,key,lvl,exp,hp,ft,alive}]
    fallen: [],          // 전사한 네임드 기록
    owners: {},          // regionId -> 0(카리온)/1(바르시아)
    cleared: false
  };
  var B = null;          // 전투 컨텍스트
  var preBattle = null;  // 패배/퇴각 시 복원용 스냅샷

  /* ================= 능력치 ================= */
  function baseOf(key) { return FQD.UNITS[key]; }
  function growth(lvl) { return 1 + 0.09 * (lvl - 1); }
  function maxHpOf(mem) { return Math.round(baseOf(mem.key).hp * growth(mem.lvl)); }
  function statsOf(mem) {
    var b = baseOf(mem.key), m = growth(mem.lvl);
    return {
      at: Math.round(b.at * m), df: Math.round(b.df * m),
      ar: Math.round(b.ar + (mem.lvl - 1) * 2), dr: Math.round(b.dr + (mem.lvl - 1) * 2),
      spd: b.spd, hp: maxHpOf(mem)
    };
  }
  function expNeed(lvl) { return 24 + lvl * 22; }

  function makeMember(key, lvl) {
    var mem = { uid: UIDC++, key: key, lvl: lvl || 1, exp: 0, ft: 0, alive: true };
    mem.hp = maxHpOf(mem);
    return mem;
  }

  /* ================= 저장/불러오기 ================= */
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        turn: G.turn, army: G.army, fallen: G.fallen, owners: G.owners, cleared: G.cleared, uidc: UIDC
      }));
    } catch (e) {}
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || !d.army || !d.army.length) return false;
      G.turn = d.turn || 1; G.army = d.army; G.fallen = d.fallen || [];
      G.owners = d.owners || {}; G.cleared = !!d.cleared; UIDC = d.uidc || 1000;
      return true;
    } catch (e) { return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function newGame() {
    G.turn = 1; G.army = []; G.fallen = []; G.owners = {}; G.cleared = false; UIDC = 1;
    FQD.START_ARMY.forEach(function (t) { G.army.push(makeMember(t[0], t[1])); });
    FQD.REGIONS.forEach(function (r) { G.owners[r.id] = r.owner; });
    save();
  }

  /* ================= 화면 전환 ================= */
  var SCREENS = ['title', 'strategy', 'deploy', 'battle', 'result'];
  function show(name) {
    G.screen = name;
    SCREENS.forEach(function (s) {
      var el = $('scr-' + s); if (el) el.classList.toggle('on', s === name);
    });
    if (name === 'strategy') drawStrategy();
  }

  /* ================= 대화(스토리) 오버레이 ================= */
  var dlg = { lines: [], i: 0, cb: null };
  function dialog(lines, cb) {
    dlg.lines = lines.slice(); dlg.i = 0; dlg.cb = cb || null;
    $('dlgOverlay').classList.add('on');
    dlgStep(true);
  }
  function dlgStep(first) {
    if (!first) dlg.i++;
    if (dlg.i >= dlg.lines.length) {
      $('dlgOverlay').classList.remove('on');
      var cb = dlg.cb; dlg.cb = null;
      if (cb) cb();
      return;
    }
    var line = dlg.lines[dlg.i];
    var m = line.match(/^【(.+?)】\s*(.*)$/);
    $('dlgName').textContent = m ? m[1] : '';
    $('dlgName').style.display = m ? 'inline-block' : 'none';
    $('dlgText').textContent = m ? m[2] : line;
    $('dlgMore').textContent = (dlg.i === dlg.lines.length - 1) ? '▣ 닫기' : '▼ 계속';
  }

  /* =====================================================================
     전략 맵 (로그리스 대륙)
     ===================================================================== */
  var stCv, stCtx, selRegion = -1;

  function attackableRegions() {
    var list = [];
    FQD.REGIONS.forEach(function (r) {
      if (G.owners[r.id] !== 1) return;
      var reachable = r.adj.some(function (a) { return G.owners[a] === 0; });
      if (reachable) list.push(r.id);
    });
    return list;
  }

  function drawStrategy() {
    if (!stCv) { stCv = $('stCanvas'); stCtx = stCv.getContext('2d'); }
    var c = stCtx, W = stCv.width, H = stCv.height;
    // 바다
    var sea = c.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#14304e'); sea.addColorStop(1, '#0d1f36');
    c.fillStyle = sea; c.fillRect(0, 0, W, H);
    // 로그리스 대륙 실루엣
    c.save();
    c.beginPath();
    c.moveTo(140, 560); c.bezierCurveTo(60, 430, 110, 300, 170, 210);
    c.bezierCurveTo(210, 120, 300, 40, 430, 18);
    c.bezierCurveTo(560, 30, 680, 90, 700, 200);
    c.bezierCurveTo(740, 320, 660, 430, 620, 500);
    c.bezierCurveTo(560, 570, 300, 590, 140, 560);
    c.closePath();
    c.fillStyle = '#2e4a2c'; c.fill();
    c.strokeStyle = '#0a1626'; c.lineWidth = 5; c.stroke();
    c.clip();
    // 지형 힌트
    c.fillStyle = 'rgba(255,255,255,.10)';
    c.beginPath(); c.ellipse(400, 80, 190, 55, 0, 0, 7); c.fill();      // 북부 설원
    c.fillStyle = 'rgba(20,60,20,.5)';
    c.beginPath(); c.ellipse(280, 235, 90, 55, 0, 0, 7); c.fill();      // 서부 삼림
    c.fillStyle = 'rgba(90,70,40,.55)';
    c.beginPath(); c.ellipse(575, 235, 75, 55, 0, 0, 7); c.fill();      // 동부 산악
    c.strokeStyle = '#39608f'; c.lineWidth = 12; c.beginPath();          // 로그리스 강
    c.moveTo(80, 330); c.bezierCurveTo(300, 280, 560, 330, 720, 290); c.stroke();
    c.restore();

    // 연결선
    c.lineWidth = 3; c.strokeStyle = 'rgba(240,230,200,.4)'; c.setLineDash([7, 6]);
    FQD.REGIONS.forEach(function (r) {
      r.adj.forEach(function (a) {
        if (a < r.id) return;
        var o = FQD.REGIONS[a];
        c.beginPath(); c.moveTo(r.x, r.y + 20); c.lineTo(o.x, o.y + 20); c.stroke();
      });
    });
    c.setLineDash([]);

    // 지역 노드
    var atk = attackableRegions();
    FQD.REGIONS.forEach(function (r) {
      var own = G.owners[r.id] === 0;
      var canAtk = atk.indexOf(r.id) !== -1;
      var x = r.x, y = r.y + 20;
      c.beginPath(); c.arc(x, y, 17, 0, 7);
      c.fillStyle = own ? '#2f6fd0' : '#b23a48'; c.fill();
      c.lineWidth = 3;
      c.strokeStyle = (r.id === selRegion) ? '#ffe27a' : (canAtk ? '#f2b3a0' : 'rgba(10,20,30,.8)');
      c.stroke();
      c.font = '15px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(r.hq ? '🏰' : (r.capital ? '👑' : (r.boss ? '⚔️' : '🚩')), x, y);
      // 이름표
      c.font = 'bold 13px sans-serif';
      var tw = c.measureText(r.name).width + 12;
      c.fillStyle = 'rgba(8,14,24,.82)';
      c.fillRect(x - tw / 2, y + 21, tw, 19);
      c.fillStyle = own ? '#9dc4ff' : (canAtk ? '#ffd2ba' : '#e8b8be');
      c.fillText(r.name, x, y + 31);
      if (canAtk) {
        c.fillStyle = '#ffe27a'; c.font = 'bold 11px sans-serif';
        c.fillText('진군 가능', x, y - 26);
      }
    });

    // 상단 정보
    $('stTurn').textContent = G.turn;
    var alive = G.army.filter(function (m) { return m.alive; });
    $('stArmy').textContent = alive.length + '명';
    var lv = alive.length ? Math.round(alive.reduce(function (s, m) { return s + m.lvl; }, 0) / alive.length * 10) / 10 : 0;
    $('stLvl').textContent = 'Lv' + lv;
    renderRegionInfo();
    renderRoster();
  }

  function renderRegionInfo() {
    var box = $('regionInfo');
    if (selRegion < 0) { box.innerHTML = '<p class="fq-dim">대륙의 지역을 선택하세요. 아군 영토(파랑)와 맞닿은 적 지역으로 진군할 수 있습니다.</p>'; return; }
    var r = FQD.REGIONS[selRegion];
    var own = G.owners[r.id] === 0;
    var canAtk = attackableRegions().indexOf(r.id) !== -1;
    var h = '<h3>' + (own ? '🔵' : '🔴') + ' ' + r.name + '</h3><p>' + r.desc + '</p>';
    if (!own && r.garrison) {
      var total = r.garrison.reduce(function (s, g) { return s + g[1]; }, 0) + (r.boss ? 1 : 0);
      h += '<p class="fq-dim">적 수비대: 약 ' + total + '명';
      if (r.boss) h += ' · 적장 <b>' + baseOf(r.boss[0]).name + '</b>(' + baseOf(r.boss[0]).cls + ')';
      h += '</p>';
    }
    if (canAtk) h += '<button class="btn primary" id="btnMarch">⚔️ 이 지역으로 진군</button>';
    else if (!own) h += '<p class="fq-dim">아군 영토와 접해 있지 않아 진군할 수 없습니다.</p>';
    box.innerHTML = h;
    var mb = $('btnMarch');
    if (mb) mb.onclick = function () { openDeploy(r.id); };
  }

  function renderRoster() {
    var alive = G.army.filter(function (m) { return m.alive; });
    var byKey = {};
    alive.forEach(function (m) {
      (byKey[m.key] = byKey[m.key] || []).push(m);
    });
    var h = '';
    Object.keys(byKey).forEach(function (k) {
      var b = baseOf(k), arr = byKey[k];
      if (b.hero) {
        arr.forEach(function (m) {
          h += '<div class="fq-chip hero" style="--c:' + b.color + '">★ ' + b.name + ' <em>Lv' + m.lvl + '</em></div>';
        });
      } else {
        var lv = Math.round(arr.reduce(function (s, m) { return s + m.lvl; }, 0) / arr.length);
        h += '<div class="fq-chip" style="--c:' + b.color + '">' + b.name + ' ×' + arr.length + ' <em>Lv' + lv + '</em></div>';
      }
    });
    if (G.fallen.length) {
      h += '<div class="fq-fallen">⚰️ 전사: ' + G.fallen.join(', ') + '</div>';
    }
    $('rosterBox').innerHTML = h;
  }

  /* =====================================================================
     출진(배치) 화면 — 최대 2개 군단 × 18명
     ===================================================================== */
  var deployTarget = -1, deploySel = {};

  function openDeploy(regionId) {
    deployTarget = regionId;
    deploySel = {};
    var alive = G.army.filter(function (m) { return m.alive; });
    alive.slice(0, FQD.UNIT_CAP).forEach(function (m) { deploySel[m.uid] = true; });
    renderDeploy();
    show('deploy');
  }
  function deployCount() {
    return Object.keys(deploySel).filter(function (k) { return deploySel[k]; }).length;
  }
  function renderDeploy() {
    var r = FQD.REGIONS[deployTarget];
    $('dpTitle').textContent = '⚔️ ' + r.name + ' 공략전';
    $('dpDesc').textContent = r.desc;
    var alive = G.army.filter(function (m) { return m.alive; });
    var n = deployCount();
    $('dpCount').innerHTML = '출진 <b>' + n + '</b> / ' + FQD.UNIT_CAP + '명 &nbsp;·&nbsp; 제1군단 ' +
      Math.min(n, FQD.LEGION_SIZE) + '명 / 제2군단 ' + Math.max(0, n - FQD.LEGION_SIZE) + '명';
    var h = '';
    alive.forEach(function (m) {
      var b = baseOf(m.key), on = !!deploySel[m.uid];
      h += '<div class="dp-row' + (on ? ' on' : '') + (b.hero ? ' hero' : '') + '" data-uid="' + m.uid + '" style="--c:' + b.color + '">' +
        '<span class="dp-nm">' + (b.hero ? '★ ' : '') + b.name + '</span>' +
        '<span class="dp-lv">Lv' + m.lvl + '</span>' +
        '<span class="dp-hp">HP ' + m.hp + '/' + maxHpOf(m) + '</span>' +
        '<span class="dp-ft' + (m.ft > 50 ? ' warn' : '') + '">FT ' + Math.round(m.ft) + '</span>' +
        '<span class="dp-ck">' + (on ? '✔' : '') + '</span></div>';
    });
    $('dpList').innerHTML = h;
    Array.prototype.forEach.call($('dpList').children, function (row) {
      row.onclick = function () {
        var uid = row.getAttribute('data-uid');
        if (deploySel[uid]) { delete deploySel[uid]; }
        else if (deployCount() < FQD.UNIT_CAP) { deploySel[uid] = true; }
        renderDeploy();
      };
    });
    $('dpGo').disabled = n === 0;
  }

  /* =====================================================================
     전투 — 고챠캐릭 실시간 난전
     ===================================================================== */
  var cv, ctx, mapCv;      // 메인/오프스크린 맵 캔버스
  var keys = {}, joy = { on: false, dx: 0, dy: 0 };
  var lastT = 0, rafId = 0;

  function tileAt(x, y) {
    var i = Math.floor(x / TS), j = Math.floor(y / TS);
    if (i < 0 || j < 0 || j >= B.rows || i >= B.cols) return 't';
    return B.map[j][i];
  }
  function walkable(x, y, r) {
    // 원 주위 4점 + 중심 검사
    var pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (var k = 0; k < pts.length; k++) {
      if (!FQD.TILE[tileAt(x + pts[k][0], y + pts[k][1])].walk) return false;
    }
    return true;
  }
  function terrainSpd(x, y) { return FQD.TILE[tileAt(x, y)].spd || 1; }

  function findOpenSpot(cx, cy, spread) {
    for (var t = 0; t < 40; t++) {
      var x = cx + (rnd() - 0.5) * spread * 2, y = cy + (rnd() - 0.5) * spread * 2;
      x = clamp(x, TS * 1.5, B.w - TS * 1.5); y = clamp(y, TS * 1.5, B.h - TS * 1.5);
      if (walkable(x, y, 10)) return { x: x, y: y };
    }
    return { x: cx, y: cy };
  }

  function spawnZone(code) {
    // 맵 가장자리/중앙 스폰 기준점
    var w = B.w, h = B.h;
    switch (code) {
      case 'S': return { x: w / 2, y: h - TS * 4 };
      case 'N': return { x: w / 2, y: TS * 5 };
      case 'W': return { x: TS * 4, y: h / 2 };
      case 'E': return { x: w - TS * 4, y: h / 2 };
      default:  return { x: w / 2, y: h * 0.32 };   // 'C' 중앙(성 내부)
    }
  }

  function makeFighter(mem, team, x, y) {
    var b = baseOf(mem.key), st = statsOf(mem);
    return {
      id: UIDC++, mem: mem, key: mem.key, team: team,
      name: b.name, hero: !!b.hero, boss: !!b.boss, doll: !!b.doll,
      color: b.color, trim: b.trim, weapon: b.weapon,
      x: x, y: y, r: b.r, face: team === 0 ? -Math.PI / 2 : Math.PI / 2,
      hp: mem.hp, maxhp: st.hp, at: st.at, df: st.df, ar: st.ar, dr: st.dr,
      spd: st.spd, ft: mem.ft || 0,
      range: b.range || 0, reach: b.reach || 0, bolt: !!b.bolt,
      special: b.special || null, scd: 2 + rnd() * 2, cd: rnd(),
      order: 'free', tgt: null, slot: 0, swing: 0, hurt: 0, alive: true,
      aiT: rnd() * 0.2, kills: 0
    };
  }

  function startBattle(regionId) {
    var r = FQD.REGIONS[regionId];
    // 스냅샷(패배/퇴각 복원용)
    preBattle = JSON.stringify({ army: G.army, fallen: G.fallen });

    var mapRows = r.map();
    B = {
      region: r, map: mapRows, rows: mapRows.length, cols: mapRows[0].length,
      w: mapRows[0].length * TS, h: mapRows.length * TS,
      units: [], shots: [], parts: [], floats: [], banner: null,
      cam: { x: 0, y: 0 }, ctrl: null, time: 0, over: null, resultShown: false,
      waves: (r.waves || []).map(function (w) { return { def: w, done: false }; }),
      boss: null, boss2Pending: !!r.boss2, initEnemies: 0,
      order: 'free', shake: 0, kills: 0
    };

    // ── 아군 배치 (군단 1·2 나란히) ──
    var az = spawnZone(r.allySpawn || 'S');
    var sel = G.army.filter(function (m) { return m.alive && deploySel[m.uid]; }).slice(0, FQD.UNIT_CAP);
    sel.forEach(function (m, i) {
      var legion = i < FQD.LEGION_SIZE ? 0 : 1;
      var bx = az.x + (legion === 0 ? -TS * 3 : TS * 3);
      var p = findOpenSpot(bx, az.y, TS * 3);
      var f = makeFighter(m, 0, p.x, p.y);
      f.slot = i; f.legion = legion;
      B.units.push(f);
      if (m.key === 'ares') B.ctrl = f;
    });
    if (!B.ctrl) B.ctrl = B.units[0];

    // ── 적 배치 ──
    var ez = spawnZone(r.enemySpawn || 'N');
    (r.garrison || []).forEach(function (g) {
      for (var i = 0; i < g[1]; i++) {
        var p = findOpenSpot(ez.x, ez.y, TS * 7);
        B.units.push(makeFighter(makeMember(g[0], g[2]), 1, p.x, p.y));
      }
    });
    if (r.boss) {
      var bp = findOpenSpot(ez.x, ez.y - TS, TS * 2);
      B.boss = makeFighter(makeMember(r.boss[0], r.boss[1]), 1, bp.x, bp.y);
      B.units.push(B.boss);
    }
    B.initEnemies = B.units.filter(function (u) { return u.team === 1; }).length;

    prerenderMap();
    buildPortraits();
    updateHud(true);
    show('battle');
    banner(r.name + ' — 전투 개시!', '#ffe27a');
    lastT = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  /* ---------- 맵 프리렌더 (PC-98풍 타일) ---------- */
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16);
    var r2 = clamp(((n >> 16) & 255) + amt, 0, 255), g = clamp(((n >> 8) & 255) + amt, 0, 255), b = clamp((n & 255) + amt, 0, 255);
    return 'rgb(' + r2 + ',' + g + ',' + b + ')';
  }
  var TILE_COLOR = {
    '.': '#4e8a3c', 'g': '#457e35', 'd': '#8a7248', 'r': '#a8905e', 'b': '#8f6f3f',
    'f': '#2f6428', 't': '#1f4a1c', 'w': '#2e6da0', 'm': '#6d6258', 'h': '#7d7061',
    'x': '#5a5348', 'S': '#dfe6ea', 'W': '#8c8c96', 'F': '#a9a4b4', 'c': '#8e3548', 's': '#c9b06e'
  };
  function prerenderMap() {
    mapCv = document.createElement('canvas');
    mapCv.width = B.w; mapCv.height = B.h;
    var c = mapCv.getContext('2d');
    var seed = 7;
    function drnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    for (var j = 0; j < B.rows; j++) {
      for (var i = 0; i < B.cols; i++) {
        var ch = B.map[j][i], col = TILE_COLOR[ch] || '#000';
        var x = i * TS, y = j * TS;
        c.fillStyle = col; c.fillRect(x, y, TS, TS);
        // 디더링 질감
        c.fillStyle = 'rgba(0,0,0,.06)';
        if ((i + j) % 2 === 0) c.fillRect(x, y, TS, TS);
        if (ch === '.' || ch === 'g') {           // 풀 터치
          c.fillStyle = 'rgba(255,255,255,.08)';
          for (var k = 0; k < 3; k++) c.fillRect(x + drnd() * 28, y + drnd() * 28, 2, 4);
        } else if (ch === 'w') {                   // 물결
          c.fillStyle = 'rgba(255,255,255,.16)';
          c.fillRect(x + drnd() * 20, y + 8 + drnd() * 12, 10, 2);
        } else if (ch === 't') {                   // 거목
          c.fillStyle = '#153a14';
          c.beginPath(); c.arc(x + 16, y + 18, 13, 0, 7); c.fill();
          c.fillStyle = '#2c6a26';
          c.beginPath(); c.arc(x + 13, y + 13, 10, 0, 7); c.fill();
        } else if (ch === 'f') {                   // 숲
          c.fillStyle = 'rgba(15,50,15,.5)';
          c.beginPath(); c.arc(x + 8 + drnd() * 14, y + 8 + drnd() * 14, 7, 0, 7); c.fill();
          c.fillStyle = 'rgba(80,140,60,.45)';
          c.beginPath(); c.arc(x + 8 + drnd() * 14, y + 8 + drnd() * 14, 5, 0, 7); c.fill();
        } else if (ch === 'm') {                   // 산
          c.fillStyle = '#57493e';
          c.beginPath(); c.moveTo(x, y + 32); c.lineTo(x + 16, y + 4); c.lineTo(x + 32, y + 32); c.closePath(); c.fill();
          c.fillStyle = 'rgba(255,255,255,.25)';
          c.beginPath(); c.moveTo(x + 16, y + 4); c.lineTo(x + 22, y + 14); c.lineTo(x + 10, y + 14); c.closePath(); c.fill();
        } else if (ch === 'W') {                   // 성벽
          c.fillStyle = '#6f6f7c'; c.fillRect(x, y + 10, TS, 22);
          c.fillStyle = '#a5a5b5'; c.fillRect(x, y, TS, 10);
          c.strokeStyle = 'rgba(0,0,0,.35)'; c.strokeRect(x + 0.5, y + 0.5, TS - 1, 10);
          c.fillStyle = 'rgba(0,0,0,.28)';
          c.fillRect(x + 4, y + 14, 10, 6); c.fillRect(x + 18, y + 22, 10, 6);
        } else if (ch === 'x') {                   // 바위
          c.fillStyle = TILE_COLOR[tileAtSafe(i, j)] || '#4e8a3c';
          c.fillStyle = '#4e8a3c'; c.fillRect(x, y, TS, TS);
          c.fillStyle = '#6b6357';
          c.beginPath(); c.ellipse(x + 16, y + 18, 12, 9, 0, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,.22)';
          c.beginPath(); c.ellipse(x + 12, y + 14, 5, 3, 0, 0, 7); c.fill();
        } else if (ch === 'S') {                   // 눈 반짝임
          c.fillStyle = 'rgba(255,255,255,.5)';
          if (drnd() < 0.3) c.fillRect(x + drnd() * 28, y + drnd() * 28, 2, 2);
        } else if (ch === 'c') {                   // 융단 무늬
          c.fillStyle = 'rgba(255,220,120,.2)';
          if ((i + j) % 2 === 0) c.fillRect(x + 12, y + 12, 8, 8);
        } else if (ch === 'F') {
          c.strokeStyle = 'rgba(0,0,0,.12)'; c.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        } else if (ch === 'b') {                   // 다리 널빤지
          c.strokeStyle = 'rgba(60,40,15,.5)';
          c.beginPath(); c.moveTo(x, y + 8); c.lineTo(x + TS, y + 8);
          c.moveTo(x, y + 20); c.lineTo(x + TS, y + 20); c.stroke();
        } else if (ch === 'r') {
          c.fillStyle = 'rgba(255,255,255,.07)';
          if (drnd() < 0.4) c.fillRect(x + drnd() * 24, y + drnd() * 24, 4, 3);
        }
      }
    }
  }
  function tileAtSafe(i, j) { return (B.map[j] && B.map[j][i]) || '.'; }

  /* ---------- 전투 이펙트 ---------- */
  function addFloat(x, y, text, color, big) {
    B.floats.push({ x: x, y: y, t: 0, life: big ? 1.4 : 0.9, text: text, color: color, big: !!big });
  }
  function banner(text, color) { B.banner = { text: text, color: color || '#fff', t: 0, life: 2.6 }; }
  function puff(x, y, color, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = rnd() * Math.PI * 2, v = (spd || 60) * (0.4 + rnd());
      B.parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, t: 0, life: 0.4 + rnd() * 0.4, color: color, sz: 2 + rnd() * 3 });
    }
  }
  function ringFx(x, y, radius, color) {
    B.parts.push({ ring: true, x: x, y: y, t: 0, life: 0.45, radius: radius, color: color });
  }

  /* ---------- 전투 계산 (원작식: AT×AR / DF×DR + 피로도) ---------- */
  function ftAtkMul(u) { return 1 - 0.4 * (u.ft / 100); }
  function ftDefMul(u) { return 1 - 0.8 * (u.ft / 100); }   // 피로하면 방어가 급락(원작 재현)
  function tryHit(a, d, mult) {
    var arEff = a.ar * ftAtkMul(a);
    var drEff = d.dr * ftDefMul(d);
    var chance = clamp(0.32 + (arEff - drEff) / 170, 0.12, 0.95);
    if (rnd() > chance) return -1;   // 회피
    var atk = a.at * ftAtkMul(a) * (mult || 1) * (0.85 + rnd() * 0.3);
    var def = d.df * ftDefMul(d) * 0.55;
    return Math.max(1, Math.round(atk - def));
  }
  function dealDamage(a, d, dmg) {
    d.hp -= dmg; d.hurt = 0.18;
    d.ft = clamp(d.ft + 0.7, 0, 100);
    addFloat(d.x, d.y - d.r - 8, String(dmg), d.team === 0 ? '#ff9c9c' : '#fff');
    puff(d.x, d.y, d.doll ? '#b3a184' : '#e05a4e', d.doll ? 5 : 3, 50);
    if (d.hp <= 0) killUnit(a, d);
  }
  function killUnit(killer, d) {
    d.alive = false; d.hp = 0;
    puff(d.x, d.y, d.doll ? '#c9b696' : '#933', 14, 110);
    if (d.boss) { B.shake = 0.5; banner(d.name + ' 격파!', '#ffd76a'); }
    if (d.team === 1) {
      B.kills++;
      if (killer && killer.team === 0) grantExp(killer, d);
    } else {
      d.mem.alive = false; d.mem.hp = 0;
      if (d.hero) {
        G.fallen.push(d.name);
        banner('★ ' + d.name + ' 전사…… (영구 이탈)', '#ff8f8f');
      }
      if (d === B.ctrl) {
        var next = B.units.find(function (u) { return u.alive && u.team === 0; });
        if (next) switchCtrl(next);
      }
    }
  }
  function grantExp(killer, dead) {
    var base = baseOf(dead.key);
    var exp = (dead.mem.lvl || 1) * 7 + (base.boss ? 120 : (base.hero ? 40 : 0));
    killer.kills++;
    addExp(killer, exp);
    // 주변 아군 분배(부대 경험치)
    B.units.forEach(function (u) {
      if (u.team === 0 && u.alive && u !== killer && dist2(u.x, u.y, dead.x, dead.y) < 160 * 160) addExp(u, Math.ceil(exp / 4));
    });
  }
  function addExp(u, exp) {
    var m = u.mem;
    m.exp += exp;
    var need = expNeed(m.lvl);
    while (m.exp >= need) {
      m.exp -= need; m.lvl++;
      var st = statsOf(m);
      u.at = st.at; u.df = st.df; u.ar = st.ar; u.dr = st.dr;
      var heal = Math.round(st.hp * 0.3);
      u.maxhp = st.hp; u.hp = Math.min(st.hp, u.hp + heal);
      m.hp = u.hp;
      addFloat(u.x, u.y - u.r - 18, 'LEVEL UP! Lv' + m.lvl, '#ffe27a', true);
      ringFx(u.x, u.y, 40, '#ffe27a');
      need = expNeed(m.lvl);
    }
  }

  /* ---------- 특수능력 ---------- */
  function useSpecial(u) {
    if (!u.special || u.scd > 0) return;
    var sp = FQD.SPECIALS[u.special];
    if (u === B.ctrl && u.ft + (sp.ft || 0) > 100) { addFloat(u.x, u.y - 20, '피로!', '#ffb0a0'); return; }
    u.scd = sp.cd;
    u.ft = clamp(u.ft + (sp.ft || 0), 0, 100);
    banner('✨ ' + u.name + ' 「' + sp.name + '」', u.team === 0 ? '#9fd0ff' : '#ffb0a0');
    if (sp.fx === 'shuriken') {
      for (var k = 0; k < 8; k++) {
        var a = k * Math.PI / 4;
        B.shots.push({ x: u.x, y: u.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, team: u.team, from: u, dmg: Math.round(u.at * sp.mult), life: 0.8, kind: 'shuriken' });
      }
      return;
    }
    var color = { fire: '#ff7a3c', water: '#5ab4ff', wind: '#9df0b0', earth: '#d8a850', bolt: '#fff27a', dark: '#b06aff' }[sp.fx] || '#fff';
    ringFx(u.x, u.y, sp.radius, color);
    puff(u.x, u.y, color, 26, 160);
    B.shake = Math.max(B.shake, 0.3);
    B.units.forEach(function (t) {
      if (!t.alive || t.team === u.team) return;
      if (dist2(t.x, t.y, u.x, u.y) > sp.radius * sp.radius) return;
      var dmg = Math.max(1, Math.round(u.at * ftAtkMul(u) * sp.mult * (0.9 + rnd() * 0.2) - t.df * 0.4));
      dealDamage(u, t, dmg);
      // 넉백
      var dx = t.x - u.x, dy = t.y - u.y, dd = Math.sqrt(dx * dx + dy * dy) || 1;
      t.x += dx / dd * 14; t.y += dy / dd * 14;
    });
  }

  /* ---------- 조작 캐릭터 교대 ---------- */
  function switchCtrl(next) {
    B.ctrl = next;
    ringFx(next.x, next.y, 26, '#ffe27a');
    updateHud(true);
  }
  function cycleCtrl(dir) {
    var allies = B.units.filter(function (u) { return u.alive && u.team === 0; });
    if (!allies.length) return;
    var i = allies.indexOf(B.ctrl);
    switchCtrl(allies[(i + dir + allies.length) % allies.length]);
  }
  function setOrder(o) {
    B.order = o;
    var label = { free: '자유 전투', gather: '집합', charge: '돌격' }[o];
    banner('부대 명령: ' + label, '#c9e2ff');
    B.units.forEach(function (u) { if (u.team === 0) u.order = o; });
    updateHud(true);
  }

  /* ---------- 유닛 AI ---------- */
  function nearestEnemy(u, maxD) {
    var best = null, bd = (maxD || 1e9) * (maxD || 1e9);
    for (var i = 0; i < B.units.length; i++) {
      var t = B.units[i];
      if (!t.alive || t.team === u.team) continue;
      var d = dist2(u.x, u.y, t.x, t.y);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  function moveUnit(u, dx, dy, dt) {
    var sp = u.spd * terrainSpd(u.x, u.y) * dt;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return;
    dx = dx / len * sp; dy = dy / len * sp;
    u.face = Math.atan2(dy, dx);
    if (walkable(u.x + dx, u.y, u.r)) u.x += dx;
    if (walkable(u.x, u.y + dy, u.r)) u.y += dy;
  }
  function attackRangeOf(u) { return u.range ? u.range : 0; }
  function meleeReach(u, t) { return u.r + t.r + 5 + (u.reach || 0); }

  function unitAI(u, dt) {
    u.aiT -= dt;
    var leader = B.ctrl;
    // 목표 갱신(스태거)
    if (u.aiT <= 0) {
      u.aiT = 0.15 + rnd() * 0.1;
      if (u.team === 1) {
        u.tgt = nearestEnemy(u, u.boss ? 1e9 : 420);
      } else {
        var aggro = u.order === 'charge' ? 1e9 : (u.order === 'gather' ? 90 : 260);
        u.tgt = nearestEnemy(u, aggro);
      }
      if (u.tgt && !u.tgt.alive) u.tgt = null;
    }
    var t = u.tgt;
    if (t && t.alive) {
      var d = Math.sqrt(dist2(u.x, u.y, t.x, t.y));
      if (u.range) {
        // 원거리: 사거리 유지
        if (d > u.range * 0.95) moveUnit(u, t.x - u.x, t.y - u.y, dt);
        else if (d < u.range * 0.45) moveUnit(u, u.x - t.x, u.y - t.y, dt * 0.7);
        else if (u.cd <= 0) {
          u.cd = 1.3 + rnd() * 0.4; u.swing = 0.2;
          u.face = Math.atan2(t.y - u.y, t.x - u.x);
          B.shots.push({ x: u.x, y: u.y, vx: (t.x - u.x) / d * 280, vy: (t.y - u.y) / d * 280, team: u.team, from: u, dmg: 0, life: u.range / 280 + 0.3, kind: u.bolt ? 'bolt' : 'arrow' });
          u.ft = clamp(u.ft + 1.0, 0, 100);
        }
      } else {
        var reach = meleeReach(u, t);
        if (d > reach) moveUnit(u, t.x - u.x, t.y - u.y, dt);
        else if (u.cd <= 0) {
          u.cd = 0.85 + rnd() * 0.35; u.swing = 0.25;
          u.face = Math.atan2(t.y - u.y, t.x - u.x);
          u.ft = clamp(u.ft + 1.4, 0, 100);
          var dmg = tryHit(u, t, 1);
          if (dmg < 0) addFloat(t.x, t.y - t.r - 8, 'MISS', '#bcc6cf');
          else dealDamage(u, t, dmg);
        }
      }
    } else if (u.team === 0 && u !== leader && leader && leader.alive) {
      // 대장 추종(진형 슬롯)
      var ang = (u.slot % 12) / 12 * Math.PI * 2, ring = 34 + Math.floor(u.slot / 12) * 26;
      var gx = leader.x + Math.cos(ang) * ring, gy = leader.y + Math.sin(ang) * ring;
      if (dist2(u.x, u.y, gx, gy) > 22 * 22) moveUnit(u, gx - u.x, gy - u.y, dt);
      else u.ft = clamp(u.ft - dt * 4, 0, 100);   // 대기 중 피로 회복
    } else {
      u.ft = clamp(u.ft - dt * 4, 0, 100);
    }
    // 보스 특수기
    if (u.team === 1 && u.special && u.scd <= 0) {
      var sp = FQD.SPECIALS[u.special];
      var cnt = 0;
      B.units.forEach(function (o) { if (o.alive && o.team === 0 && dist2(o.x, o.y, u.x, u.y) < (sp.radius || 100) * (sp.radius || 100)) cnt++; });
      if (cnt >= 2) useSpecial(u);
    }
  }

  /* ---------- 아군 서로 밀어내기 ---------- */
  function separation() {
    var cell = 42, buckets = {};
    B.units.forEach(function (u) {
      if (!u.alive) return;
      var k = Math.floor(u.x / cell) + ',' + Math.floor(u.y / cell);
      (buckets[k] = buckets[k] || []).push(u);
    });
    B.units.forEach(function (u) {
      if (!u.alive) return;
      var ci = Math.floor(u.x / cell), cj = Math.floor(u.y / cell);
      for (var a = ci - 1; a <= ci + 1; a++) for (var b = cj - 1; b <= cj + 1; b++) {
        var arr = buckets[a + ',' + b]; if (!arr) continue;
        for (var k = 0; k < arr.length; k++) {
          var o = arr[k]; if (o === u || o.id <= u.id) continue;
          var minD = u.r + o.r, d2 = dist2(u.x, u.y, o.x, o.y);
          if (d2 < minD * minD && d2 > 0.01) {
            var d = Math.sqrt(d2), push = (minD - d) / 2;
            var dx = (u.x - o.x) / d * push, dy = (u.y - o.y) / d * push;
            if (walkable(u.x + dx, u.y + dy, u.r)) { u.x += dx; u.y += dy; }
            if (walkable(o.x - dx, o.y - dy, o.r)) { o.x -= dx; o.y -= dy; }
          }
        }
      }
    });
  }

  /* ---------- 지원군 ---------- */
  function checkWaves() {
    var enemies = B.units.filter(function (u) { return u.alive && u.team === 1; }).length;
    B.waves.forEach(function (w) {
      if (w.done) return;
      var trig = false;
      if (w.def.at === 'half' && enemies <= B.initEnemies / 2) trig = true;
      if (w.def.at === 'boss' && B.boss && B.boss.alive && B.boss.hp < B.boss.maxhp * 0.55) trig = true;
      if (!trig) return;
      w.done = true;
      var z = spawnZone(w.def.from);
      w.def.units.forEach(function (g) {
        for (var i = 0; i < g[1]; i++) {
          var p = findOpenSpot(z.x, z.y, TS * 4);
          var f = makeFighter(makeMember(g[0], g[2]), 1, p.x, p.y);
          B.units.push(f);
          ringFx(p.x, p.y, 20, '#ff9c8a');
        }
      });
      banner('⚠️ ' + w.def.msg, '#ffb0a0');
    });
  }

  /* ---------- 2차 보스(왕도: 제넬 → 자닐) ---------- */
  function checkBoss2() {
    var r = B.region;
    if (!B.boss2Pending || !r.boss2) return;
    if (B.boss && !B.boss.alive) {
      B.boss2Pending = false;
      pauseLoop();
      dialog(r.boss2.msg, function () {
        var z = spawnZone('C');
        var bp = findOpenSpot(z.x, z.y - TS, TS * 2);
        B.boss = makeFighter(makeMember(r.boss2.unit[0], r.boss2.unit[1]), 1, bp.x, bp.y);
        B.units.push(B.boss);
        (r.boss2.escorts || []).forEach(function (g) {
          for (var i = 0; i < g[1]; i++) {
            var p = findOpenSpot(z.x, z.y, TS * 5);
            B.units.push(makeFighter(makeMember(g[0], g[2]), 1, p.x, p.y));
          }
        });
        B.shake = 0.6;
        ringFx(bp.x, bp.y, 90, '#b06aff');
        banner('자닐, 강림!', '#d0a8ff');
        resumeLoop();
      });
    }
  }

  /* ---------- 메인 루프 ---------- */
  var paused = false;
  function pauseLoop() { paused = true; }
  function resumeLoop() { paused = false; lastT = 0; }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (paused || G.screen !== 'battle') { lastT = 0; return; }
    if (!lastT) { lastT = ts; return; }
    var dt = Math.min((ts - lastT) / 1000, 0.05);
    lastT = ts;
    update(dt);
    render();
  }

  function update(dt) {
    B.time += dt;
    if (B.shake > 0) B.shake -= dt;

    // ── 조작 캐릭터 ──
    var c = B.ctrl;
    if (c && c.alive) {
      var dx = 0, dy = 0;
      if (keys.ArrowLeft || keys.a) dx -= 1;
      if (keys.ArrowRight || keys.d) dx += 1;
      if (keys.ArrowUp || keys.w) dy -= 1;
      if (keys.ArrowDown || keys.s) dy += 1;
      if (joy.on) { dx += joy.dx; dy += joy.dy; }
      if (dx || dy) moveUnit(c, dx, dy, dt);
      else c.ft = clamp(c.ft - dt * 4, 0, 100);
      // 몸통 부딪치기 자동 공격(이스식 — 원작 조작감)
      if (c.cd <= 0) {
        var t = nearestEnemy(c, c.range ? c.range : meleeReach(c, { r: 10, x: 0, y: 0 }) + 4);
        if (t) {
          var d = Math.sqrt(dist2(c.x, c.y, t.x, t.y));
          var ok = c.range ? d <= c.range : d <= meleeReach(c, t);
          if (ok) {
            c.cd = c.range ? 1.2 : 0.55; c.swing = 0.25;
            c.face = Math.atan2(t.y - c.y, t.x - c.x);
            c.ft = clamp(c.ft + 1.2, 0, 100);
            if (c.range) {
              B.shots.push({ x: c.x, y: c.y, vx: (t.x - c.x) / d * 300, vy: (t.y - c.y) / d * 300, team: 0, from: c, dmg: 0, life: c.range / 300 + 0.3, kind: c.bolt ? 'bolt' : 'arrow' });
            } else {
              var dmg = tryHit(c, t, 1);
              if (dmg < 0) addFloat(t.x, t.y - t.r - 8, 'MISS', '#bcc6cf');
              else dealDamage(c, t, dmg);
            }
          }
        }
      }
    }

    // ── AI/쿨다운/회복 ──
    B.units.forEach(function (u) {
      if (!u.alive) return;
      if (u.cd > 0) u.cd -= dt;
      if (u.scd > 0) u.scd -= dt;
      if (u.swing > 0) u.swing -= dt;
      if (u.hurt > 0) u.hurt -= dt;
      // 자연 회복(전투 이탈 시 서서히 — 원작의 휴식 회복 재현)
      if (u.hp < u.maxhp && !nearestEnemy(u, 150)) u.hp = Math.min(u.maxhp, u.hp + dt * 1.2);
      if (u !== B.ctrl) unitAI(u, dt);
      if (u.mem) { u.mem.hp = Math.round(u.hp); u.mem.ft = u.ft; }
    });
    separation();

    // ── 투사체 ──
    for (var i = B.shots.length - 1; i >= 0; i--) {
      var s = B.shots[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      var hit = false;
      if (!walkable(s.x, s.y, 2) && tileAt(s.x, s.y) === 'W') hit = true;   // 성벽에 막힘
      if (!hit) {
        for (var k = 0; k < B.units.length; k++) {
          var u2 = B.units[k];
          if (!u2.alive || u2.team === s.team) continue;
          if (dist2(s.x, s.y, u2.x, u2.y) < (u2.r + 4) * (u2.r + 4)) {
            var dmg = s.dmg || tryHit(s.from, u2, s.kind === 'bolt' ? 1.15 : 1);
            if (dmg < 0) addFloat(u2.x, u2.y - u2.r - 8, 'MISS', '#bcc6cf');
            else dealDamage(s.from, u2, s.kind === 'shuriken' ? Math.max(1, Math.round(s.dmg - u2.df * 0.4)) : dmg);
            hit = true; break;
          }
        }
      }
      if (hit || s.life <= 0) B.shots.splice(i, 1);
    }

    // ── 파티클/플로트 ──
    for (var p = B.parts.length - 1; p >= 0; p--) {
      var pt = B.parts[p]; pt.t += dt;
      if (!pt.ring) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 140 * dt; }
      if (pt.t >= pt.life) B.parts.splice(p, 1);
    }
    for (var f = B.floats.length - 1; f >= 0; f--) {
      var fl = B.floats[f]; fl.t += dt; fl.y -= 26 * dt;
      if (fl.t >= fl.life) B.floats.splice(f, 1);
    }
    if (B.banner) { B.banner.t += dt; if (B.banner.t >= B.banner.life) B.banner = null; }

    checkWaves();
    checkBoss2();

    // ── 카메라 ──
    if (c) {
      B.cam.x = lerp(B.cam.x, clamp(c.x - VIEW_W / 2, 0, B.w - VIEW_W), 0.12);
      B.cam.y = lerp(B.cam.y, clamp(c.y - VIEW_H / 2, 0, B.h - VIEW_H), 0.12);
    }

    // ── 승패 ──
    if (!B.over) {
      var allies = 0, enemies = 0, aresAlive = false;
      B.units.forEach(function (u) {
        if (!u.alive) return;
        if (u.team === 0) { allies++; if (u.key === 'ares') aresAlive = true; }
        else enemies++;
      });
      var wavesLeft = B.waves.some(function (w) { return !w.done; });
      if (!aresAlive) { B.over = 'lose'; setTimeout(endBattle, 1200); banner('아레스 전사…… 패배', '#ff8f8f'); }
      else if (enemies === 0 && !wavesLeft && !B.boss2Pending) { B.over = 'win'; setTimeout(endBattle, 1200); banner('🎉 승리! ' + B.region.name + ' 평정!', '#ffe27a'); }
      else if (allies === 0) { B.over = 'lose'; setTimeout(endBattle, 1200); }
    }

    if ((B.hudT = (B.hudT || 0) + dt) > 0.2) { B.hudT = 0; updateHud(); }
  }

  /* ---------- 렌더 ---------- */
  function render() {
    var c = ctx;
    var sx = B.shake > 0 ? (rnd() - 0.5) * 8 * B.shake : 0;
    var sy = B.shake > 0 ? (rnd() - 0.5) * 8 * B.shake : 0;
    var camX = Math.round(B.cam.x + sx), camY = Math.round(B.cam.y + sy);
    c.fillStyle = '#000'; c.fillRect(0, 0, VIEW_W, VIEW_H);
    c.drawImage(mapCv, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

    // y-정렬 렌더
    var list = B.units.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < list.length; i++) drawUnit(c, list[i], camX, camY);

    // 투사체
    B.shots.forEach(function (s) {
      var x = s.x - camX, y = s.y - camY;
      if (s.kind === 'bolt') {
        c.fillStyle = '#c07aff'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
        c.fillStyle = 'rgba(190,120,255,.4)'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill();
      } else if (s.kind === 'shuriken') {
        c.save(); c.translate(x, y); c.rotate(B.time * 20);
        c.fillStyle = '#dfe4ea'; c.fillRect(-4, -1, 8, 2); c.fillRect(-1, -4, 2, 8);
        c.restore();
      } else {
        c.strokeStyle = '#e8d8a8'; c.lineWidth = 2;
        var vl = Math.sqrt(s.vx * s.vx + s.vy * s.vy) || 1;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - s.vx / vl * 9, y - s.vy / vl * 9); c.stroke();
      }
    });

    // 파티클
    B.parts.forEach(function (p) {
      var k = 1 - p.t / p.life;
      if (p.ring) {
        c.strokeStyle = p.color; c.globalAlpha = k; c.lineWidth = 3 + 4 * k;
        c.beginPath(); c.arc(p.x - camX, p.y - camY, p.radius * (1 - k * 0.6), 0, 7); c.stroke();
        c.globalAlpha = 1;
      } else {
        c.globalAlpha = k; c.fillStyle = p.color;
        c.fillRect(p.x - camX - p.sz / 2, p.y - camY - p.sz / 2, p.sz, p.sz);
        c.globalAlpha = 1;
      }
    });

    // 데미지 플로트
    B.floats.forEach(function (f) {
      var k = 1 - f.t / f.life;
      c.globalAlpha = Math.min(1, k * 2);
      c.font = (f.big ? 'bold 18px' : 'bold 13px') + ' sans-serif';
      c.textAlign = 'center';
      c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 3;
      c.strokeText(f.text, f.x - camX, f.y - camY);
      c.fillStyle = f.color; c.fillText(f.text, f.x - camX, f.y - camY);
      c.globalAlpha = 1;
    });

    // 중앙 배너
    if (B.banner) {
      var bk = Math.min(1, B.banner.t * 4, (B.banner.life - B.banner.t) * 2);
      c.globalAlpha = bk;
      c.fillStyle = 'rgba(8,12,20,.72)';
      c.fillRect(0, 64, VIEW_W, 44);
      c.font = 'bold 22px sans-serif'; c.textAlign = 'center';
      c.fillStyle = B.banner.color;
      c.fillText(B.banner.text, VIEW_W / 2, 92);
      c.globalAlpha = 1;
    }

    drawMinimap(c);
  }

  function drawUnit(c, u, camX, camY) {
    var x = u.x - camX, y = u.y - camY;
    if (x < -40 || y < -40 || x > VIEW_W + 40 || y > VIEW_H + 40) return;
    if (!u.alive) return;
    var r = u.r;
    // 그림자
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(x, y + r * 0.7, r * 0.9, r * 0.45, 0, 0, 7); c.fill();
    // 조작 캐릭터 링
    if (u === B.ctrl) {
      c.strokeStyle = '#ffe27a'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y + 2, r + 5, 0, 7); c.stroke();
      c.fillStyle = '#ffe27a';
      c.beginPath(); c.moveTo(x, y - r - 16); c.lineTo(x - 5, y - r - 24); c.lineTo(x + 5, y - r - 24); c.closePath(); c.fill();
    }
    var flash = u.hurt > 0;
    // 몸통
    c.fillStyle = flash ? '#fff' : u.color;
    c.beginPath(); c.ellipse(x, y, r * 0.85, r, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
    // 머리
    var doll = u.doll;
    c.fillStyle = flash ? '#fff' : (doll ? '#cbb894' : '#f0c9a0');
    c.beginPath(); c.arc(x, y - r * 0.95, r * 0.55, 0, 7); c.fill();
    // 투구/장식(트림 색)
    c.fillStyle = flash ? '#eee' : u.trim;
    c.beginPath(); c.arc(x, y - r * 1.05, r * 0.55, Math.PI, 0); c.fill();
    if (u.boss) {   // 보스 견장
      c.fillStyle = '#ffd76a';
      c.fillRect(x - r, y - r * 0.6, r * 2, 2);
    }
    if (doll) {     // 인형 눈(무기질)
      c.fillStyle = '#443a28';
      c.fillRect(x - 3, y - r - 1, 2, 2); c.fillRect(x + 1, y - r - 1, 2, 2);
    }
    // 무기(공격 시 휘두르기)
    var wa = u.face + (u.swing > 0 ? Math.sin(u.swing * 40) * 0.9 : 0.5);
    var wl = u.weapon === 'spear' ? r + 12 : (u.weapon === 'bow' ? 0 : r + 7);
    if (u.weapon === 'bow') {
      c.strokeStyle = '#8a6a3a'; c.lineWidth = 2;
      c.beginPath(); c.arc(x + Math.cos(u.face) * (r + 2), y + Math.sin(u.face) * (r + 2), 6, u.face - 1.2, u.face + 1.2); c.stroke();
    } else if (u.weapon === 'staff') {
      c.strokeStyle = '#7a5aa8'; c.lineWidth = 3;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(wa) * (r + 10), y + Math.sin(wa) * (r + 10)); c.stroke();
      c.fillStyle = '#c9a8ff';
      c.beginPath(); c.arc(x + Math.cos(wa) * (r + 12), y + Math.sin(wa) * (r + 12), 3, 0, 7); c.fill();
    } else {
      c.strokeStyle = u.weapon === 'axe' || u.weapon === 'hammer' ? '#9a8a70' : '#d8dde4';
      c.lineWidth = u.weapon === 'hammer' ? 4 : 2;
      c.beginPath(); c.moveTo(x + Math.cos(wa) * r * 0.4, y + Math.sin(wa) * r * 0.4);
      c.lineTo(x + Math.cos(wa) * wl, y + Math.sin(wa) * wl); c.stroke();
    }
    // HP 바
    var hw = u.boss ? 30 : 18, hy = y - r - (u.boss ? 14 : 10);
    c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x - hw / 2, hy, hw, 3.5);
    var hr = u.hp / u.maxhp;
    c.fillStyle = u.team === 0 ? (hr > 0.35 ? '#5fd06a' : '#e8c84a') : '#e05a4e';
    c.fillRect(x - hw / 2, hy, hw * hr, 3.5);
    // 이름표(영웅/보스)
    if (u.hero || u.boss) {
      c.font = 'bold 11px sans-serif'; c.textAlign = 'center';
      c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 3;
      c.strokeText(u.name, x, hy - 4);
      c.fillStyle = u.team === 0 ? '#bfe0ff' : '#ffc4b8';
      c.fillText(u.name, x, hy - 4);
    }
  }

  function drawMinimap(c) {
    var mw = 132, mh = Math.round(mw * B.h / B.w), mx = VIEW_W - mw - 10, my = 10;
    c.globalAlpha = 0.85;
    c.drawImage(mapCv, 0, 0, B.w, B.h, mx, my, mw, mh);
    c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,255,255,.5)'; c.strokeRect(mx - 0.5, my - 0.5, mw + 1, mh + 1);
    B.units.forEach(function (u) {
      if (!u.alive) return;
      c.fillStyle = u.team === 0 ? '#6fb4ff' : '#ff6a5a';
      var ux = mx + u.x / B.w * mw, uy = my + u.y / B.h * mh;
      c.fillRect(ux - 1.5, uy - 1.5, u.boss ? 4 : 3, u.boss ? 4 : 3);
    });
    if (B.ctrl && B.ctrl.alive) {
      c.strokeStyle = '#ffe27a';
      c.strokeRect(mx + B.ctrl.x / B.w * mw - 3, my + B.ctrl.y / B.h * mh - 3, 6, 6);
    }
    // 뷰포트
    c.strokeStyle = 'rgba(255,255,255,.35)';
    c.strokeRect(mx + B.cam.x / B.w * mw, my + B.cam.y / B.h * mh, VIEW_W / B.w * mw, VIEW_H / B.h * mh);
  }

  /* ---------- HUD/초상 ---------- */
  function buildPortraits() {
    var bar = $('portraitBar'); bar.innerHTML = '';
    B.units.forEach(function (u) {
      if (u.team !== 0) return;
      var d = document.createElement('div');
      d.className = 'fq-port' + (u.hero ? ' hero' : '');
      d.style.setProperty('--c', u.color);
      d.setAttribute('data-id', u.id);
      d.innerHTML = '<span class="pp-nm">' + (u.hero ? '★' : '') + u.name.slice(0, 3) + '</span>' +
        '<span class="pp-hp"><i></i></span><span class="pp-ft"><i></i></span>';
      d.onclick = function () { if (u.alive) switchCtrl(u); };
      bar.appendChild(d);
      u.portEl = d;
    });
  }
  function updateHud(force) {
    var c = B && B.ctrl;
    if (!B) return;
    if (c) {
      $('hudName').textContent = (c.hero ? '★ ' : '') + c.name + '  Lv' + c.mem.lvl;
      $('hudStats').textContent = 'AT' + c.at + ' DF' + c.df + ' AR' + c.ar + ' DR' + c.dr;
      $('hudHpBar').style.width = clamp(c.hp / c.maxhp * 100, 0, 100) + '%';
      $('hudHpTxt').textContent = Math.max(0, Math.round(c.hp)) + '/' + c.maxhp;
      $('hudFtBar').style.width = clamp(c.ft, 0, 100) + '%';
      $('hudFtBar').className = 'ftfill' + (c.ft > 65 ? ' hot' : '');
      var sp = c.special ? FQD.SPECIALS[c.special] : null;
      $('btnSpecial').textContent = sp ? ('✨ ' + sp.name + (c.scd > 0 ? ' (' + Math.ceil(c.scd) + ')' : '')) : '✨ ―';
      $('btnSpecial').disabled = !sp || c.scd > 0;
    }
    var a = 0, e = 0;
    B.units.forEach(function (u) { if (u.alive) { if (u.team === 0) a++; else e++; } });
    $('hudCount').textContent = '아군 ' + a + ' vs 적 ' + e;
    ['free', 'gather', 'charge'].forEach(function (o) {
      $('ord-' + o).classList.toggle('on', B.order === o);
    });
    // 초상 갱신
    B.units.forEach(function (u) {
      if (u.team !== 0 || !u.portEl) return;
      u.portEl.classList.toggle('dead', !u.alive);
      u.portEl.classList.toggle('ctrl', u === B.ctrl);
      u.portEl.querySelector('.pp-hp i').style.width = clamp(u.hp / u.maxhp * 100, 0, 100) + '%';
      u.portEl.querySelector('.pp-ft i').style.width = clamp(u.ft, 0, 100) + '%';
    });
  }

  /* ---------- 전투 종료 ---------- */
  function endBattle() {
    if (B.resultShown) return;
    B.resultShown = true;
    var r = B.region, win = B.over === 'win';
    // 생존자 상태 반영 + 회복
    if (win) {
      B.units.forEach(function (u) {
        if (u.team !== 0 || !u.mem) return;
        if (u.alive) {
          u.mem.hp = Math.min(maxHpOf(u.mem), Math.round(u.hp + (maxHpOf(u.mem) - u.hp) * 0.6));
          u.mem.ft = Math.round(u.ft * 0.25);
        }
      });
      G.army = G.army.filter(function (m) { return m.alive; });
      G.owners[r.id] = 0;
      G.turn++;
      // 보상 합류
      var joined = [];
      var rw = r.reward || {};
      (rw.heroes || []).forEach(function (hk) {
        if (!G.army.some(function (m) { return m.key === hk; })) {
          G.army.push(makeMember(hk, Math.max(2, r.lvl)));
          joined.push('★ ' + baseOf(hk).name);
        }
      });
      (rw.units || []).forEach(function (g) {
        for (var i = 0; i < g[1]; i++) G.army.push(makeMember(g[0], g[2]));
        joined.push(baseOf(g[0]).name + ' ×' + g[1]);
      });
      save();
      showResult(true, joined);
    } else {
      // 패배/퇴각 — 출진 전 상태로 복원(원작이라면 세이브 로드)
      var snap = JSON.parse(preBattle);
      G.army = snap.army; G.fallen = snap.fallen;
      showResult(false, []);
    }
  }

  function showResult(win, joined) {
    var r = B.region;
    $('rsTitle').textContent = win ? '🎉 ' + r.name + ' 평정!' : '💀 패배……';
    var dead = [];
    B.units.forEach(function (u) { if (u.team === 0 && !u.alive) dead.push((u.hero ? '★' : '') + u.name); });
    var h = '<p>격파한 적: <b>' + B.kills + '</b>명</p>';
    if (win) {
      h += dead.length ? '<p class="fq-warn">아군 전사: ' + dead.join(', ') + '</p>' : '<p>아군 전사자 없음 — 완벽한 승리!</p>';
      if (joined.length) h += '<p class="fq-good">부대 합류: ' + joined.join(' · ') + '</p>';
    } else {
      h += '<p class="fq-dim">부대를 국경까지 물렸다. 병력은 출진 전으로 돌아간다. (전열을 다듬어 재도전하자)</p>';
    }
    $('rsBody').innerHTML = h;
    show('result');
    $('rsNext').onclick = function () {
      if (win && r.storyAfter) {
        dialog(r.storyAfter, function () {
          if (r.capital) { G.cleared = true; save(); showEnding(); }
          else { selRegion = -1; show('strategy'); }
        });
      } else {
        selRegion = -1; show('strategy');
      }
    };
  }

  function showEnding() {
    $('rsTitle').textContent = '👑 로그리스 해방 — 전역 클리어!';
    $('rsBody').innerHTML =
      '<p>바르시아를 뒤덮은 어둠이 걷히고, 대륙에 평화가 돌아왔다.</p>' +
      '<p>턴 수: <b>' + G.turn + '</b> · 전사한 영웅: ' + (G.fallen.length ? G.fallen.join(', ') : '없음') + '</p>' +
      '<p class="fq-dim">플레이해 주셔서 감사합니다 — 퍼스트 퀸 IV 재현 목업</p>';
    $('rsNext').onclick = function () { selRegion = -1; show('strategy'); };
    show('result');
  }

  function retreat() {
    if (!B || B.over) return;
    B.over = 'lose';
    banner('퇴각!', '#c9d4e0');
    setTimeout(endBattle, 700);
  }

  /* =====================================================================
     입력 처리
     ===================================================================== */
  function bindInputs() {
    document.addEventListener('keydown', function (e) {
      if (G.screen !== 'battle') return;
      if ($('dlgOverlay').classList.contains('on')) {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); dlgStep(); }
        return;
      }
      keys[e.key] = true;
      if (e.key === ' ') { e.preventDefault(); if (B.ctrl && B.ctrl.alive) useSpecial(B.ctrl); }
      else if (e.key === 'Tab') { e.preventDefault(); cycleCtrl(e.shiftKey ? -1 : 1); }
      else if (e.key === '1') setOrder('free');
      else if (e.key === '2') setOrder('gather');
      else if (e.key === '3') setOrder('charge');
      else if (e.key === 'Escape') retreat();
    });
    document.addEventListener('keyup', function (e) { keys[e.key] = false; });

    // 대화 클릭 진행
    $('dlgOverlay').addEventListener('click', function () { dlgStep(); });

    // 전략맵 클릭
    $('stCanvas').addEventListener('click', function (e) {
      var rect = stCv.getBoundingClientRect();
      var x = (e.clientX - rect.left) * stCv.width / rect.width;
      var y = (e.clientY - rect.top) * stCv.height / rect.height;
      var hit = -1;
      FQD.REGIONS.forEach(function (r) {
        if (dist2(x, y, r.x, r.y + 20) < 24 * 24) hit = r.id;
      });
      selRegion = hit;
      drawStrategy();
    });

    // 전투 버튼
    $('btnSpecial').onclick = function () { if (B && B.ctrl && B.ctrl.alive) useSpecial(B.ctrl); };
    $('btnSwitch').onclick = function () { cycleCtrl(1); };
    $('ord-free').onclick = function () { setOrder('free'); };
    $('ord-gather').onclick = function () { setOrder('gather'); };
    $('ord-charge').onclick = function () { setOrder('charge'); };
    $('btnRetreat').onclick = function () {
      if (confirm('부대를 물리고 전략 맵으로 돌아갑니까? (전투 상황은 초기화됩니다)')) retreat();
    };

    // 가상 조이스틱(모바일)
    var pad = $('joyPad'), knob = $('joyKnob');
    function joyMove(e) {
      var t = e.touches ? e.touches[0] : e;
      var rc = pad.getBoundingClientRect();
      var cx = rc.left + rc.width / 2, cy = rc.top + rc.height / 2;
      var dx = t.clientX - cx, dy = t.clientY - cy;
      var d = Math.sqrt(dx * dx + dy * dy), max = rc.width / 2;
      if (d > max) { dx = dx / d * max; dy = dy / d * max; }
      joy.on = true; joy.dx = dx / max; joy.dy = dy / max;
      knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    function joyEnd() { joy.on = false; joy.dx = joy.dy = 0; knob.style.transform = ''; }
    pad.addEventListener('touchstart', function (e) { e.preventDefault(); joyMove(e); }, { passive: false });
    pad.addEventListener('touchmove', function (e) { e.preventDefault(); joyMove(e); }, { passive: false });
    pad.addEventListener('touchend', joyEnd);
    pad.addEventListener('mousedown', function (e) {
      joyMove(e);
      var mm = function (ev) { joyMove(ev); };
      var mu = function () { joyEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
    });

    // 출진 화면
    $('dpGo').onclick = function () {
      var r = FQD.REGIONS[deployTarget];
      var go = function () { startBattle(deployTarget); };
      if (r.storyBefore) dialog(r.storyBefore, go); else go();
    };
    $('dpBack').onclick = function () { show('strategy'); };

    // 타이틀
    $('btnNew').onclick = function () {
      if (hasSave() && !confirm('저장된 진행이 있습니다. 처음부터 시작할까요?')) return;
      newGame();
      dialog(FQD.INTRO, function () { selRegion = -1; show('strategy'); });
    };
    $('btnContinue').onclick = function () {
      if (!load()) { alert('저장 데이터가 없습니다.'); return; }
      selRegion = -1; show('strategy');
    };
    $('stMenuBtn').onclick = function () { show('title'); refreshTitle(); };
  }

  function refreshTitle() {
    $('btnContinue').style.display = hasSave() ? '' : 'none';
  }

  /* ================= 초기화 ================= */
  function init() {
    cv = $('bCanvas'); ctx = cv.getContext('2d');
    bindInputs();
    refreshTitle();
    show('title');
  }

  document.addEventListener('DOMContentLoaded', init);
  return { G: function () { return G; }, B: function () { return B; } };
})();
