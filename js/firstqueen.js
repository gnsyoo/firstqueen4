/* =====================================================================
   퍼스트 퀸 IV 재현 목업 — 엔진 (원작 고증판)
   전략(턴제 지역 점령) + 고챠캐릭(ごちゃキャラ) 실시간 난전
   - 리더십제 부대 편성(부대장에 따라 인원수 변화)
   - 소환수(사라만다·용·실프·운디네)·비행 유닛
   - 지원군 호출 / 아이템(파괴의 돌·회복약)
   - 보스 기믹(꼬리 약점·석화·흡혈·골렘 소환·항복)
   ===================================================================== */
var FQ = (function () {
  'use strict';

  var TS = 32;
  var VIEW_W = 960, VIEW_H = 600;
  var SAVE_KEY = 'fq4_save_v2';
  var SUMMON_LIFE = 45;              // 소환수 유지 시간(초)

  /* ================= 유틸 ================= */
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function rnd() { return Math.random(); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var UIDC = 1;

  /* ================= 게임 상태 ================= */
  var G = {
    screen: 'title', turn: 1,
    army: [], fallen: [], owners: {},
    flags: {},                        // salamander / sylph / undine …
    items: {},                        // stone / potion
    codex: {},                        // 만난 인물 도감
    cleared: false
  };
  var B = null;
  var preBattle = null;

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
  function ldrCap(key) { var b = baseOf(key); return Math.min(FQD.LEGION_MAX, Math.round((b.ldr || 6) * 1.5)); }

  function makeMember(key, lvl) {
    var mem = { uid: UIDC++, key: key, lvl: lvl || 1, exp: 0, ft: 0, alive: true };
    mem.hp = maxHpOf(mem);
    return mem;
  }
  // 영웅의 현재 특수능력(해금 플래그에 따라 교체 — 사라만다/실프/운디네)
  function specialKeyOf(key) {
    var b = baseOf(key);
    if (b.specialUp && G.flags[b.specialUp.flag]) return b.specialUp.special;
    return b.special || null;
  }

  /* ================= 저장/불러오기 ================= */
  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        turn: G.turn, army: G.army, fallen: G.fallen, owners: G.owners,
        flags: G.flags, items: G.items, codex: G.codex, cleared: G.cleared, uidc: UIDC
      }));
    } catch (e) {}
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d || !d.army || !d.army.length) return false;
      G.turn = d.turn || 1; G.army = d.army; G.fallen = d.fallen || [];
      G.owners = d.owners || {}; G.flags = d.flags || {}; G.items = d.items || {};
      G.codex = d.codex || {}; G.cleared = !!d.cleared; UIDC = d.uidc || 2000;
      return true;
    } catch (e) { return false; }
  }
  function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }
  function newGame() {
    G.turn = 1; G.army = []; G.fallen = []; G.owners = {}; G.flags = {};
    G.items = JSON.parse(JSON.stringify(FQD.START_ITEMS)); G.codex = {}; G.cleared = false;
    UIDC = 1;
    FQD.START_ARMY.forEach(function (t) {
      G.army.push(makeMember(t[0], t[1]));
      if (baseOf(t[0]).hero) G.codex[t[0]] = true;
    });
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

  /* ================= 대화 오버레이 ================= */
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
      if (r.adj.some(function (a) { return G.owners[a] === 0; })) list.push(r.id);
    });
    return list;
  }

  function drawStrategy() {
    if (!stCv) { stCv = $('stCanvas'); stCtx = stCv.getContext('2d'); }
    var c = stCtx, W = stCv.width, H = stCv.height;
    var sea = c.createLinearGradient(0, 0, 0, H);
    sea.addColorStop(0, '#14304e'); sea.addColorStop(1, '#0d1f36');
    c.fillStyle = sea; c.fillRect(0, 0, W, H);
    // 로그리스 대륙
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
    c.fillStyle = 'rgba(90,70,40,.45)';
    c.beginPath(); c.ellipse(455, 300, 120, 60, 0, 0, 7); c.fill();     // 리스레이 황무지
    c.fillStyle = 'rgba(20,20,45,.4)';
    c.beginPath(); c.ellipse(300, 150, 90, 45, 0, 0, 7); c.fill();      // 에드윈의 그늘
    c.fillStyle = 'rgba(255,255,255,.08)';
    c.beginPath(); c.ellipse(430, 70, 190, 50, 0, 0, 7); c.fill();      // 바르시아 심장부
    c.strokeStyle = '#39608f'; c.lineWidth = 10; c.beginPath();          // 모로시아의 강
    c.moveTo(120, 230); c.bezierCurveTo(320, 190, 560, 240, 720, 200); c.stroke();
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
      c.font = 'bold 13px sans-serif';
      var tw = c.measureText(r.name).width + 12;
      c.fillStyle = 'rgba(8,14,24,.82)';
      c.fillRect(x - tw / 2, y + 21, tw, 19);
      c.fillStyle = own ? '#9dc4ff' : (canAtk ? '#ffd2ba' : '#e8b8be');
      c.fillText(r.name, x, y + 31);
      if (canAtk) {
        c.fillStyle = '#ffe27a'; c.font = 'bold 11px sans-serif';
        c.fillText(r.optional ? '진군 가능(우회 가능)' : '진군 가능', x, y - 26);
      }
    });

    $('stTurn').textContent = G.turn;
    var alive = G.army.filter(function (m) { return m.alive; });
    $('stArmy').textContent = alive.length + '명';
    var lv = alive.length ? Math.round(alive.reduce(function (s, m) { return s + m.lvl; }, 0) / alive.length * 10) / 10 : 0;
    $('stLvl').textContent = 'Lv' + lv;
    $('stItems').textContent = '💥×' + (G.items.stone || 0) + ' 🧪×' + (G.items.potion || 0);
    renderRegionInfo();
    renderRoster();
  }

  function renderRegionInfo() {
    var box = $('regionInfo');
    if (selRegion < 0) {
      box.innerHTML = '<p class="fq-dim">대륙의 지역을 선택하세요. 아군 영토(파랑)와 맞닿은 적 지역으로 진군할 수 있습니다. (우회 가능) 지역은 건너뛰어도 되지만, 강력한 동료가 기다립니다.</p>';
      return;
    }
    var r = FQD.REGIONS[selRegion];
    var own = G.owners[r.id] === 0;
    var canAtk = attackableRegions().indexOf(r.id) !== -1;
    var h = '<h3>' + (own ? '🔵' : '🔴') + ' ' + r.name + '</h3><p>' + r.desc + '</p>';
    if (!own && r.garrison) {
      var total = r.garrison.reduce(function (s, g) { return s + g[1]; }, 0) + (r.boss ? 1 : 0) + (r.midBoss ? 1 : 0);
      h += '<p class="fq-dim">적 수비대: 약 ' + total + '명';
      if (r.midBoss) h += ' · 중간보스 <b>' + baseOf(r.midBoss[0]).name + '</b>';
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
    alive.forEach(function (m) { (byKey[m.key] = byKey[m.key] || []).push(m); });
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
    if (G.fallen.length) h += '<div class="fq-fallen">⚰️ 전사: ' + G.fallen.join(', ') + '</div>';
    $('rosterBox').innerHTML = h;
  }

  /* ---------- 인물 도감 ---------- */
  function openCodex() {
    var h = '';
    var order = ['ares', 'elaine', 'kai', 'radincal', 'yanhuret', 'kara', 'nieman', 'barthom', 'krovi',
      'og', 'mcguire', 'mordred', 'srihut', 'vampire', 'guardian', 'kroviE', 'zenelu', 'garoa'];
    order.forEach(function (k) {
      var b = baseOf(k); if (!b || !b.bio) return;
      var met = G.codex[k];
      h += '<div class="cx-row' + (met ? '' : ' unknown') + '" style="--c:' + b.color + '">' +
        '<div class="cx-nm">' + (b.team === 0 ? '★ ' : '☠️ ') + (met ? b.name : '???') +
        ' <em>' + (met ? b.cls : '아직 만나지 못했다') + '</em></div>' +
        (met ? '<p>' + b.bio + '</p>' : '') + '</div>';
    });
    $('codexBody').innerHTML = h;
    $('codexModal').classList.add('on');
  }

  /* =====================================================================
     출진 편성 — 부대장 리더십에 따라 인원 결정(원작 재현)
     제1군단장은 아레스 고정(원작: 아레스는 부대장으로만 운용 가능)
     ===================================================================== */
  var deployTarget = -1, deploySel = {}, leader2 = '';

  function aliveArmy() { return G.army.filter(function (m) { return m.alive; }); }
  function heroMembers() { return aliveArmy().filter(function (m) { return baseOf(m.key).hero; }); }

  function openDeploy(regionId) {
    deployTarget = regionId;
    deploySel = {};
    // 제2군단장 기본값: 라딘칼(있으면) — 원작에서 초반 주력 부대장
    var rad = heroMembers().find(function (m) { return m.key === 'radincal'; });
    var alt = heroMembers().find(function (m) { return m.key !== 'ares'; });
    leader2 = rad ? 'radincal' : (alt ? alt.key : '');
    autoFill();
    renderDeploy();
    show('deploy');
  }
  function totalCap() { return ldrCap('ares') + (leader2 ? ldrCap(leader2) : 0); }
  function autoFill() {
    deploySel = {};
    var cap = totalCap();
    var list = aliveArmy();
    // 아레스·제2군단장 우선 포함
    list.forEach(function (m) {
      if (m.key === 'ares' || (leader2 && m.key === leader2)) deploySel[m.uid] = true;
    });
    list.forEach(function (m) {
      if (Object.keys(deploySel).length >= cap) return;
      if (!deploySel[m.uid]) deploySel[m.uid] = true;
    });
  }
  function deployCount() { return Object.keys(deploySel).filter(function (k) { return deploySel[k]; }).length; }

  function renderDeploy() {
    var r = FQD.REGIONS[deployTarget];
    $('dpTitle').textContent = '⚔️ ' + r.name + ' 공략전';
    $('dpDesc').textContent = r.desc;
    // 제2군단장 선택지
    var sel = $('dpLeader2'), opts = '<option value="">(제2군단 없음)</option>';
    heroMembers().forEach(function (m) {
      if (m.key === 'ares') return;
      var b = baseOf(m.key);
      opts += '<option value="' + m.key + '"' + (leader2 === m.key ? ' selected' : '') + '>' +
        b.name + ' (리더십 ' + b.ldr + ' → ' + ldrCap(m.key) + '명)</option>';
    });
    sel.innerHTML = opts;
    var cap1 = ldrCap('ares'), cap2 = leader2 ? ldrCap(leader2) : 0;
    var n = deployCount();
    $('dpCount').innerHTML =
      '제1군단장 <b>아레스</b>(리더십 ' + baseOf('ares').ldr + ' → ' + cap1 + '명) · ' +
      '제2군단장 <b>' + (leader2 ? baseOf(leader2).name : '없음') + '</b>' +
      (leader2 ? '(리더십 ' + baseOf(leader2).ldr + ' → ' + cap2 + '명)' : '') +
      ' &nbsp;—&nbsp; 출진 <b>' + n + '</b> / ' + (cap1 + cap2) + '명';
    var h = '';
    aliveArmy().forEach(function (m) {
      var b = baseOf(m.key), on = !!deploySel[m.uid];
      var lock = m.key === 'ares' || (leader2 && m.key === leader2);
      h += '<div class="dp-row' + (on ? ' on' : '') + (b.hero ? ' hero' : '') + '" data-uid="' + m.uid + '" style="--c:' + b.color + '">' +
        '<span class="dp-nm">' + (b.hero ? '★ ' : '') + b.name + (lock ? ' <i class="dp-lead">부대장</i>' : '') + '</span>' +
        '<span class="dp-lv">Lv' + m.lvl + '</span>' +
        '<span class="dp-hp">HP ' + m.hp + '/' + maxHpOf(m) + '</span>' +
        '<span class="dp-ft' + (m.ft > 50 ? ' warn' : '') + '">FT ' + Math.round(m.ft) + '</span>' +
        '<span class="dp-ck">' + (on ? '✔' : '') + '</span></div>';
    });
    $('dpList').innerHTML = h;
    Array.prototype.forEach.call($('dpList').children, function (row) {
      row.onclick = function () {
        var uid = row.getAttribute('data-uid');
        var mem = G.army.find(function (m) { return String(m.uid) === uid; });
        if (mem && (mem.key === 'ares' || (leader2 && mem.key === leader2))) return; // 부대장은 해제 불가
        if (deploySel[uid]) delete deploySel[uid];
        else if (deployCount() < totalCap()) deploySel[uid] = true;
        renderDeploy();
      };
    });
    $('dpGo').disabled = deployCount() === 0;
  }

  /* =====================================================================
     전투
     ===================================================================== */
  var cv, ctx, mapCv;
  var keys = {}, joy = { on: false, dx: 0, dy: 0 };
  var lastT = 0, rafId = 0;

  function tileAt(x, y) {
    var i = Math.floor(x / TS), j = Math.floor(y / TS);
    if (i < 0 || j < 0 || j >= B.rows || i >= B.cols) return 't';
    return B.map[j][i];
  }
  function tileOk(u, ch) {
    if (FQD.TILE[ch].walk) return true;
    if (u && u.fly && ch !== 'W' && ch !== 't') return true;        // 비행: 물·산·바위 통과
    if (u && u.waterMove && ch === 'w') return true;                 // 물뱀·몰드레드: 물속 이동
    return false;
  }
  function walkable(x, y, r, u) {
    var pts = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
    for (var k = 0; k < pts.length; k++) {
      if (!tileOk(u, tileAt(x + pts[k][0], y + pts[k][1]))) return false;
    }
    return true;
  }
  function terrainSpd(u) {
    if (u.fly) return 1.1;
    var t = FQD.TILE[tileAt(u.x, u.y)];
    return t.spd || 1;
  }

  function findOpenSpot(cx, cy, spread) {
    for (var t = 0; t < 40; t++) {
      var x = cx + (rnd() - 0.5) * spread * 2, y = cy + (rnd() - 0.5) * spread * 2;
      x = clamp(x, TS * 1.5, B.w - TS * 1.5); y = clamp(y, TS * 1.5, B.h - TS * 1.5);
      if (walkable(x, y, 10, null)) return { x: x, y: y };
    }
    return { x: cx, y: cy };
  }
  function spawnZone(code) {
    var w = B.w, h = B.h;
    switch (code) {
      case 'S': return { x: w / 2, y: h - TS * 4 };
      case 'N': return { x: w / 2, y: TS * 5 };
      case 'W': return { x: TS * 4, y: h / 2 };
      case 'E': return { x: w - TS * 4, y: h / 2 };
      default:  return { x: w / 2, y: h * 0.3 };
    }
  }

  function makeFighter(mem, team, x, y) {
    var b = baseOf(mem.key), st = statsOf(mem);
    return {
      id: UIDC++, mem: mem, key: mem.key, team: team,
      name: b.name, hero: !!b.hero, boss: !!b.boss, doll: !!b.doll,
      big: !!b.big, kind: b.kind || null, fly: !!b.fly, waterMove: !!b.waterMove,
      summonU: !!b.summon, tempU: !!b.temp,
      lifesteal: !!b.lifesteal, weakTail: !!b.weakTail, weakWind: !!b.weakWind,
      magicWeak: !!b.magicWeak, gaze: !!b.gaze, summonerOf: b.summoner || null,
      surrenderAt: b.surrender || 0, surrendered: false,
      color: b.color, trim: b.trim, weapon: b.weapon,
      x: x, y: y, r: b.r, face: team === 0 ? -Math.PI / 2 : Math.PI / 2,
      hp: mem.hp, maxhp: st.hp, at: st.at, df: st.df, ar: st.ar, dr: st.dr,
      spd: st.spd, ft: mem.ft || 0, petrify: 0, life: b.summon ? SUMMON_LIFE : 0,
      range: b.range || 0, reach: b.reach || 0, bolt: !!b.bolt,
      special: null, scd: 2 + rnd() * 2, sumCd: 6, cd: rnd(),
      order: 'free', tgt: null, slot: 0, legion: 0, swing: 0, hurt: 0, alive: true,
      aiT: rnd() * 0.2, kills: 0
    };
  }
  function fighterSpecial(f) {
    if (f.team === 0 && f.hero) return specialKeyOf(f.key);
    return baseOf(f.key).special || null;
  }

  function startBattle(regionId) {
    var r = FQD.REGIONS[regionId];
    preBattle = JSON.stringify({ army: G.army, fallen: G.fallen, items: G.items });

    var mapRows = r.map();
    B = {
      region: r, map: mapRows, rows: mapRows.length, cols: mapRows[0].length,
      w: mapRows[0].length * TS, h: mapRows.length * TS,
      units: [], shots: [], parts: [], floats: [], banner: null,
      cam: { x: 0, y: 0 }, ctrl: null, time: 0, over: null, resultShown: false,
      waves: (r.waves || []).map(function (w) { return { def: w, done: false }; }),
      boss: null, boss2Pending: !!r.boss2, initEnemies: 0,
      order: 'free', shake: 0, kills: 0,
      reserves: [], callsLeft: 2, joined: []
    };

    // ── 아군 배치: 군단1(아레스) + 군단2 ──
    var az = spawnZone(r.allySpawn || 'S');
    var cap1 = ldrCap('ares');
    var sel = aliveArmy().filter(function (m) { return deploySel[m.uid]; });
    // 부대장 우선 정렬(아레스 → 군단2장 → 나머지)
    sel.sort(function (a, b2) {
      var pa = a.key === 'ares' ? 0 : (leader2 && a.key === leader2 ? 1 : 2);
      var pb = b2.key === 'ares' ? 0 : (leader2 && b2.key === leader2 ? 1 : 2);
      return pa - pb;
    });
    var leaders = [null, null];
    sel.forEach(function (m, i) {
      var legion = i < cap1 ? 0 : 1;
      var bx = az.x + (legion === 0 ? -TS * 3 : TS * 3);
      var p = findOpenSpot(bx, az.y, TS * 3);
      var f = makeFighter(m, 0, p.x, p.y);
      f.slot = i; f.legion = legion;
      if (m.key === 'ares') { leaders[0] = f; }
      if (leader2 && m.key === leader2) { leaders[1] = f; f.legion = 1; }
      B.units.push(f);
    });
    B.leaders = leaders;
    B.ctrl = leaders[0] || B.units[0];
    // 예비대(출진하지 않은 생존 부대원) → 지원군 호출용
    B.reserves = aliveArmy().filter(function (m) { return !deploySel[m.uid]; });

    // ── 링커 자경단 등 임시 원군 ──
    (r.militia || []).forEach(function (g) {
      for (var i = 0; i < g[1]; i++) {
        var p = findOpenSpot(az.x, az.y - TS * 3, TS * 4);
        var f = makeFighter(makeMember(g[0], g[2]), 0, p.x, p.y);
        f.legion = 0;
        B.units.push(f);
      }
    });

    // ── 적 배치 ──
    var ez = spawnZone(r.enemySpawn || 'N');
    (r.garrison || []).forEach(function (g) {
      for (var i = 0; i < g[1]; i++) {
        var p = findOpenSpot(ez.x, ez.y, TS * 7);
        B.units.push(makeFighter(makeMember(g[0], g[2]), 1, p.x, p.y));
      }
    });
    if (r.midBoss) {
      var mp = findOpenSpot(ez.x - TS * 3, ez.y + TS * 2, TS * 3);
      var mb = makeFighter(makeMember(r.midBoss[0], r.midBoss[1]), 1, mp.x, mp.y);
      B.units.push(mb);
      G.codex[r.midBoss[0]] = true;
    }
    if (r.boss) {
      var bp = findOpenSpot(ez.x, ez.y - TS, TS * 2);
      B.boss = makeFighter(makeMember(r.boss[0], r.boss[1]), 1, bp.x, bp.y);
      B.units.push(B.boss);
      G.codex[r.boss[0]] = true;
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

  /* ---------- 맵 프리렌더 ---------- */
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
        c.fillStyle = 'rgba(0,0,0,.06)';
        if ((i + j) % 2 === 0) c.fillRect(x, y, TS, TS);
        if (ch === '.' || ch === 'g') {
          c.fillStyle = 'rgba(255,255,255,.08)';
          for (var k = 0; k < 3; k++) c.fillRect(x + drnd() * 28, y + drnd() * 28, 2, 4);
        } else if (ch === 'w') {
          c.fillStyle = 'rgba(255,255,255,.16)';
          c.fillRect(x + drnd() * 20, y + 8 + drnd() * 12, 10, 2);
        } else if (ch === 't') {
          c.fillStyle = '#153a14';
          c.beginPath(); c.arc(x + 16, y + 18, 13, 0, 7); c.fill();
          c.fillStyle = '#2c6a26';
          c.beginPath(); c.arc(x + 13, y + 13, 10, 0, 7); c.fill();
        } else if (ch === 'f') {
          c.fillStyle = 'rgba(15,50,15,.5)';
          c.beginPath(); c.arc(x + 8 + drnd() * 14, y + 8 + drnd() * 14, 7, 0, 7); c.fill();
          c.fillStyle = 'rgba(80,140,60,.45)';
          c.beginPath(); c.arc(x + 8 + drnd() * 14, y + 8 + drnd() * 14, 5, 0, 7); c.fill();
        } else if (ch === 'm') {
          c.fillStyle = '#57493e';
          c.beginPath(); c.moveTo(x, y + 32); c.lineTo(x + 16, y + 4); c.lineTo(x + 32, y + 32); c.closePath(); c.fill();
          c.fillStyle = 'rgba(255,255,255,.25)';
          c.beginPath(); c.moveTo(x + 16, y + 4); c.lineTo(x + 22, y + 14); c.lineTo(x + 10, y + 14); c.closePath(); c.fill();
        } else if (ch === 'W') {
          c.fillStyle = '#6f6f7c'; c.fillRect(x, y + 10, TS, 22);
          c.fillStyle = '#a5a5b5'; c.fillRect(x, y, TS, 10);
          c.strokeStyle = 'rgba(0,0,0,.35)'; c.strokeRect(x + 0.5, y + 0.5, TS - 1, 10);
          c.fillStyle = 'rgba(0,0,0,.28)';
          c.fillRect(x + 4, y + 14, 10, 6); c.fillRect(x + 18, y + 22, 10, 6);
        } else if (ch === 'x') {
          c.fillStyle = '#6b6357';
          c.beginPath(); c.ellipse(x + 16, y + 18, 12, 9, 0, 0, 7); c.fill();
          c.fillStyle = 'rgba(255,255,255,.22)';
          c.beginPath(); c.ellipse(x + 12, y + 14, 5, 3, 0, 0, 7); c.fill();
        } else if (ch === 'S') {
          c.fillStyle = 'rgba(255,255,255,.5)';
          if (drnd() < 0.3) c.fillRect(x + drnd() * 28, y + drnd() * 28, 2, 2);
        } else if (ch === 'c') {
          c.fillStyle = 'rgba(255,220,120,.2)';
          if ((i + j) % 2 === 0) c.fillRect(x + 12, y + 12, 8, 8);
        } else if (ch === 'F') {
          c.strokeStyle = 'rgba(0,0,0,.12)'; c.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        } else if (ch === 'b') {
          c.strokeStyle = 'rgba(60,40,15,.5)';
          c.beginPath(); c.moveTo(x, y + 8); c.lineTo(x + TS, y + 8);
          c.moveTo(x, y + 20); c.lineTo(x + TS, y + 20); c.stroke();
        } else if (ch === 'r') {
          c.fillStyle = 'rgba(255,255,255,.07)';
          if (drnd() < 0.4) c.fillRect(x + drnd() * 24, y + drnd() * 24, 4, 3);
        }
      }
    }
    // 지역 분위기(에드윈의 어둠, 썬리스의 보랏빛 등)
    if (B.region.tint) {
      c.fillStyle = B.region.tint;
      c.fillRect(0, 0, B.w, B.h);
    }
  }

  /* ---------- 이펙트 ---------- */
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

  /* ---------- 전투 계산 ---------- */
  function ftAtkMul(u) { return 1 - 0.4 * (u.ft / 100); }
  function ftDefMul(u) { return 1 - 0.8 * (u.ft / 100); }
  function tryHit(a, d, mult) {
    var arEff = a.ar * ftAtkMul(a);
    var drEff = d.dr * ftDefMul(d);
    if (d.petrify > 0) drEff = 0;                                   // 석화 중엔 무방비
    var chance = clamp(0.32 + (arEff - drEff) / 170, 0.12, 0.95);
    if (rnd() > chance) return -1;
    var atk = a.at * ftAtkMul(a) * (mult || 1) * (0.85 + rnd() * 0.3);
    var def = d.df * ftDefMul(d) * 0.55;
    return Math.max(1, Math.round(atk - def));
  }
  // 보스 상성: 오그의 꼬리(뒤) / 몰드레드는 바람 정령에 약함 / 골렘은 마법에 약함
  function gimmickMul(a, d) {
    var m = 1;
    if (d.weakTail) {
      var toAtt = Math.atan2(a.y - d.y, a.x - d.x);
      var diff = Math.abs(((toAtt - d.face + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff < 1.0) m *= 2;                                       // 등 뒤(꼬리)
    }
    if (d.weakWind && (a.key === 'sylph' || a.key === 'undine' || a.key === 'barthom')) m *= 2;
    if (d.magicWeak && a.bolt) m *= 1.7;
    return m;
  }
  function dealDamage(a, d, dmg) {
    d.hp -= dmg; d.hurt = 0.18;
    d.ft = clamp(d.ft + 0.7, 0, 100);
    addFloat(d.x, d.y - d.r - 8, String(dmg), d.team === 0 ? '#ff9c9c' : '#fff');
    puff(d.x, d.y, d.doll ? '#b3a184' : '#e05a4e', d.doll ? 5 : 3, 50);
    if (a && a.lifesteal && a.alive) {                              // 뱀파이어 흡혈
      a.hp = Math.min(a.maxhp, a.hp + dmg * 0.5);
      addFloat(a.x, a.y - a.r - 8, '+' + Math.round(dmg * 0.5), '#d08ae0');
    }
    // 항복 이벤트(크로비)
    if (d.surrenderAt && !d.surrendered && d.hp <= d.maxhp * d.surrenderAt) {
      d.surrendered = true; d.alive = false; d.hp = Math.max(1, d.hp);
      ringFx(d.x, d.y, 40, '#ffe27a');
      banner('★ ' + d.name + '이(가) 창을 내리고 항복했다!', '#ffe27a');
      return;
    }
    if (d.hp <= 0) killUnit(a, d);
  }
  function killUnit(killer, d) {
    d.alive = false; d.hp = 0;
    puff(d.x, d.y, d.doll ? '#c9b696' : '#933', d.big ? 26 : 14, d.big ? 150 : 110);
    if (d.boss) { B.shake = 0.5; banner(d.name + ' 격파!', '#ffd76a'); }
    if (d.key === 'vampire') banner('뱀파이어가 스러졌다…… 어딘가의 봉인이 풀리는 소리가 들린다!', '#9fd0ff');
    if (d.team === 1) {
      B.kills++;
      if (killer && killer.team === 0) grantExp(killer, d);
    } else {
      if (d.mem && !d.summonU && !d.tempU) { d.mem.alive = false; d.mem.hp = 0; }
      if (d.hero && !d.summonU && !d.tempU) {
        G.fallen.push(d.name);
        banner('★ ' + d.name + ' 전사…… (영구 이탈)', '#ff8f8f');
      }
      if (d === B.ctrl) {
        var next = B.units.find(function (u) { return u.alive && u.team === 0 && !u.summonU; });
        if (next) switchCtrl(next);
      }
    }
  }
  function grantExp(killer, dead) {
    if (killer.summonU || killer.tempU) killer = B.ctrl || killer;  // 소환수 경험치는 부대에 환원
    var base = baseOf(dead.key);
    var exp = (dead.mem.lvl || 1) * 7 + (base.boss ? 120 : (base.hero ? 40 : 0));
    killer.kills++;
    addExp(killer, exp);
    B.units.forEach(function (u) {
      if (u.team === 0 && u.alive && u !== killer && !u.summonU && !u.tempU &&
        dist2(u.x, u.y, dead.x, dead.y) < 160 * 160) addExp(u, Math.ceil(exp / 4));
    });
  }
  function addExp(u, exp) {
    if (u.summonU || u.tempU || !u.mem) return;
    var m = u.mem;
    m.exp += exp;
    var need = expNeed(m.lvl);
    while (m.exp >= need) {
      m.exp -= need; m.lvl++;
      var st = statsOf(m);
      u.at = st.at; u.df = st.df; u.ar = st.ar; u.dr = st.dr;
      u.maxhp = st.hp; u.hp = Math.min(st.hp, u.hp + Math.round(st.hp * 0.3));
      m.hp = u.hp;
      addFloat(u.x, u.y - u.r - 18, 'LEVEL UP! Lv' + m.lvl, '#ffe27a', true);
      ringFx(u.x, u.y, 40, '#ffe27a');
      need = expNeed(m.lvl);
    }
  }

  /* ---------- 특수능력 ---------- */
  var FX_COLOR = { fire: '#ff7a3c', water: '#5ab4ff', wind: '#9df0b0', earth: '#d8a850', bolt: '#fff27a', dark: '#b06aff', rally: '#ffe27a' };
  function useSpecial(u) {
    var spKey = fighterSpecial(u);
    if (!spKey || u.scd > 0 || u.petrify > 0) return;
    var sp = FQD.SPECIALS[spKey];
    if (u.team === 0 && u.ft + (sp.ft || 0) > 100) { addFloat(u.x, u.y - 20, '피로!', '#ffb0a0'); return; }
    u.scd = sp.cd;
    u.ft = clamp(u.ft + (sp.ft || 0), 0, 100);
    banner('✨ ' + u.name + ' 「' + sp.name + '」', u.team === 0 ? '#9fd0ff' : '#ffb0a0');
    var color = FX_COLOR[sp.fx] || '#fff';

    if (sp.summon) { doSummon(u, sp.summon, color); return; }
    if (sp.fx === 'shuriken') {
      for (var k = 0; k < 8; k++) {
        var a = k * Math.PI / 4;
        B.shots.push({ x: u.x, y: u.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, team: u.team, from: u, dmg: Math.round(u.at * sp.mult), life: 0.8, kind: 'shuriken' });
      }
      return;
    }
    ringFx(u.x, u.y, sp.radius, color);
    puff(u.x, u.y, color, 26, 160);
    B.shake = Math.max(B.shake, 0.3);
    B.units.forEach(function (t) {
      if (!t.alive) return;
      if (sp.ally) {                                                // 아군 지원(함성·물의 축복)
        if (t.team !== u.team || dist2(t.x, t.y, u.x, u.y) > sp.radius * sp.radius) return;
        if (sp.ally === 'ft') { t.ft = clamp(t.ft - 40, 0, 100); addFloat(t.x, t.y - t.r - 8, 'FT-40', '#ffe27a'); }
        else if (sp.ally === 'heal') { t.hp = Math.min(t.maxhp, t.hp + sp.amount); addFloat(t.x, t.y - t.r - 8, '+' + sp.amount, '#8fe0a0'); }
        return;
      }
      if (t.team === u.team || dist2(t.x, t.y, u.x, u.y) > sp.radius * sp.radius) return;
      if (sp.petrify) {                                             // 맥가이어 석화
        t.petrify = Math.max(t.petrify, sp.petrify);
        addFloat(t.x, t.y - t.r - 8, '석화!', '#d8a850');
        return;
      }
      var dmg = Math.max(1, Math.round(u.at * ftAtkMul(u) * sp.mult * (0.9 + rnd() * 0.2) * gimmickMul(u, t) - t.df * 0.4));
      dealDamage(u, t, dmg);
      var dx = t.x - u.x, dy = t.y - u.y, dd = Math.sqrt(dx * dx + dy * dy) || 1;
      t.x += dx / dd * 14; t.y += dy / dd * 14;
    });
  }
  function doSummon(u, key, color) {
    var p = findOpenSpot(u.x + Math.cos(u.face) * 40, u.y + Math.sin(u.face) * 40, TS * 2);
    var f = makeFighter(makeMember(key, u.mem ? u.mem.lvl : 5), u.team, p.x, p.y);
    f.order = B.order; f.legion = u.legion;
    B.units.push(f);
    ringFx(p.x, p.y, 60, color);
    puff(p.x, p.y, color, 30, 170);
    B.shake = Math.max(B.shake, 0.35);
    if (u.team === 0) addPortrait(f);
  }

  /* ---------- 아이템 ---------- */
  function useItem(kind) {
    if (!B || B.over || !B.ctrl || !B.ctrl.alive) return;
    if ((G.items[kind] || 0) <= 0) { banner(FQD.ITEMS[kind].name + '이(가) 없다!', '#c9d4e0'); return; }
    G.items[kind]--;
    var c = B.ctrl;
    if (kind === 'stone') {                                         // 파괴의 돌 — 원작의 광역 결전병기
      banner('💥 파괴의 돌! 대지가 뒤집힌다!', '#ffb46a');
      ringFx(c.x, c.y, 170, '#ffb46a'); ringFx(c.x, c.y, 120, '#ff7a3c');
      puff(c.x, c.y, '#ff9a5a', 60, 240);
      B.shake = 0.8;
      B.units.forEach(function (t) {
        if (!t.alive || t.team === c.team) return;
        if (dist2(t.x, t.y, c.x, c.y) > 170 * 170) return;
        dealDamage(c, t, Math.max(1, Math.round(150 - t.df * 0.5)));
      });
    } else if (kind === 'potion') {
      c.hp = Math.min(c.maxhp, c.hp + 80);
      c.ft = clamp(c.ft - 30, 0, 100);
      addFloat(c.x, c.y - c.r - 10, '+80', '#8fe0a0');
      ringFx(c.x, c.y, 30, '#8fe0a0');
    }
    updateHud(true);
  }

  /* ---------- 지원군 호출(원작 커맨드) ---------- */
  function callReinforcements() {
    if (!B || B.over) return;
    if (B.callsLeft <= 0) { banner('더 부를 지원군이 없다!', '#c9d4e0'); return; }
    if (!B.reserves.length) { banner('예비대가 없다! (출진하지 않은 부대원이 지원군이 된다)', '#c9d4e0'); return; }
    B.callsLeft--;
    var az = spawnZone(B.region.allySpawn || 'S');
    var batch = B.reserves.splice(0, 6);
    batch.forEach(function (m) {
      var p = findOpenSpot(az.x, az.y, TS * 3);
      var f = makeFighter(m, 0, p.x, p.y);
      f.legion = 0; f.order = B.order;
      B.units.push(f);
      B.joined.push(m.uid);
      ringFx(p.x, p.y, 24, '#9fd0ff');
      addPortrait(f);
    });
    banner('🎺 지원군 도착! (' + batch.length + '명)', '#9fd0ff');
    updateHud(true);
  }

  /* ---------- 교대/명령 ---------- */
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
  function switchLegion() {                                          // 원작: 군단 전환
    if (!B.leaders) return;
    var cur = B.ctrl && B.ctrl.legion;
    var other = B.leaders[cur === 0 ? 1 : 0];
    if (other && other.alive) switchCtrl(other);
    else {
      var any = B.units.find(function (u) { return u.alive && u.team === 0 && u.legion !== cur; });
      if (any) switchCtrl(any);
    }
  }
  function setOrder(o) {
    B.order = o;
    banner('부대 명령: ' + ({ free: '자유 전투', gather: '집합', charge: '돌격' }[o]), '#c9e2ff');
    B.units.forEach(function (u) { if (u.team === 0) u.order = o; });
    updateHud(true);
  }

  /* ---------- AI ---------- */
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
    var sp = u.spd * terrainSpd(u) * dt;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return;
    dx = dx / len * sp; dy = dy / len * sp;
    u.face = Math.atan2(dy, dx);
    if (walkable(u.x + dx, u.y, u.r, u)) u.x += dx;
    if (walkable(u.x, u.y + dy, u.r, u)) u.y += dy;
  }
  function meleeReach(u, t) { return u.r + t.r + 5 + (u.reach || 0); }
  function legionLeaderOf(u) {
    if (!B.leaders) return B.ctrl;
    var l = B.leaders[u.legion];
    if (l && l.alive) return l;
    l = B.leaders[u.legion === 0 ? 1 : 0];
    if (l && l.alive) return l;
    return B.ctrl;
  }

  function unitAI(u, dt) {
    if (u.petrify > 0) return;                                       // 석화: 행동 불가
    u.aiT -= dt;
    var leader = legionLeaderOf(u);
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
          var dmg = tryHit(u, t, gimmickMul(u, t));
          if (dmg < 0) addFloat(t.x, t.y - t.r - 8, 'MISS', '#bcc6cf');
          else dealDamage(u, t, dmg);
        }
      }
    } else if (u.team === 0 && u !== B.ctrl && leader && leader.alive && u !== leader) {
      var ang = (u.slot % 12) / 12 * Math.PI * 2, ring = 34 + Math.floor(u.slot / 12) * 26;
      var gx = leader.x + Math.cos(ang) * ring, gy = leader.y + Math.sin(ang) * ring;
      if (dist2(u.x, u.y, gx, gy) > 22 * 22) moveUnit(u, gx - u.x, gy - u.y, dt);
      else u.ft = clamp(u.ft - dt * 4, 0, 100);
    } else {
      u.ft = clamp(u.ft - dt * 4, 0, 100);
    }
    // 적 보스 행동: 특수기·석화·부하 소환
    if (u.team === 1 && u.scd <= 0) {
      var spKey = fighterSpecial(u);
      if (u.gaze && rnd() < 0.5) {
        var cnt0 = 0;
        B.units.forEach(function (o) { if (o.alive && o.team === 0 && dist2(o.x, o.y, u.x, u.y) < 120 * 120) cnt0++; });
        if (cnt0 >= 2) { u.scd = 4; useGaze(u); return; }
      }
      if (spKey) {
        var sp = FQD.SPECIALS[spKey], cnt = 0;
        B.units.forEach(function (o) { if (o.alive && o.team === 0 && dist2(o.x, o.y, u.x, u.y) < (sp.radius || 100) * (sp.radius || 100)) cnt++; });
        if (cnt >= 2) useSpecial(u);
      }
    }
    if (u.team === 1 && u.summonerOf && u.alive) {
      u.sumCd -= dt;
      if (u.sumCd <= 0) {
        u.sumCd = 14;
        var p = findOpenSpot(u.x, u.y, TS * 3);
        B.units.push(makeFighter(makeMember(u.summonerOf, u.mem.lvl), 1, p.x, p.y));
        ringFx(p.x, p.y, 30, '#d8a850');
        banner(u.name + '이(가) 부하를 만들어 낸다!', '#ffb0a0');
      }
    }
  }
  function useGaze(u) {
    var sp = FQD.SPECIALS.stoneGaze;
    banner('✨ ' + u.name + ' 「' + sp.name + '」', '#ffb0a0');
    ringFx(u.x, u.y, sp.radius, '#d8a850');
    B.units.forEach(function (t) {
      if (!t.alive || t.team === u.team) return;
      if (dist2(t.x, t.y, u.x, u.y) > sp.radius * sp.radius) return;
      t.petrify = Math.max(t.petrify, sp.petrify);
      addFloat(t.x, t.y - t.r - 8, '석화!', '#d8a850');
    });
  }

  /* ---------- 밀어내기 ---------- */
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
            if (walkable(u.x + dx, u.y + dy, u.r, u)) { u.x += dx; u.y += dy; }
            if (walkable(o.x - dx, o.y - dy, o.r, o)) { o.x -= dx; o.y -= dy; }
          }
        }
      }
    });
  }

  /* ---------- 지원군(적)·2차 보스 ---------- */
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
          B.units.push(makeFighter(makeMember(g[0], g[2]), 1, p.x, p.y));
          ringFx(p.x, p.y, 20, '#ff9c8a');
        }
      });
      banner('⚠️ ' + w.def.msg, '#ffb0a0');
    });
  }
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
        G.codex[r.boss2.unit[0]] = true;
        (r.boss2.escorts || []).forEach(function (g) {
          for (var i = 0; i < g[1]; i++) {
            var p = findOpenSpot(z.x, z.y, TS * 5);
            B.units.push(makeFighter(makeMember(g[0], g[2]), 1, p.x, p.y));
          }
        });
        B.shake = 0.6;
        ringFx(bp.x, bp.y, 100, '#b06aff');
        banner('가로아, 강림!', '#d0a8ff');
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

    var c = B.ctrl;
    if (c && c.alive && c.petrify <= 0) {
      var dx = 0, dy = 0;
      if (keys.ArrowLeft || keys.a) dx -= 1;
      if (keys.ArrowRight || keys.d) dx += 1;
      if (keys.ArrowUp || keys.w) dy -= 1;
      if (keys.ArrowDown || keys.s) dy += 1;
      if (joy.on) { dx += joy.dx; dy += joy.dy; }
      if (dx || dy) moveUnit(c, dx, dy, dt);
      else c.ft = clamp(c.ft - dt * 4, 0, 100);
      if (c.cd <= 0) {
        var t = nearestEnemy(c, c.range ? c.range : meleeReach(c, { r: 10 }) + 4);
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
              var dmg = tryHit(c, t, gimmickMul(c, t));
              if (dmg < 0) addFloat(t.x, t.y - t.r - 8, 'MISS', '#bcc6cf');
              else dealDamage(c, t, dmg);
            }
          }
        }
      }
    }

    B.units.forEach(function (u) {
      if (!u.alive) return;
      if (u.cd > 0) u.cd -= dt;
      if (u.scd > 0) u.scd -= dt;
      if (u.swing > 0) u.swing -= dt;
      if (u.hurt > 0) u.hurt -= dt;
      if (u.petrify > 0) u.petrify -= dt;
      // 소환수 수명
      if (u.summonU) {
        u.life -= dt;
        if (u.life <= 0) {
          u.alive = false;
          puff(u.x, u.y, u.color, 20, 120);
          if (u === B.ctrl) cycleCtrl(1);
          return;
        }
        if (u.key === 'undine') {                                    // 운디네 치유의 물결
          B.units.forEach(function (o) {
            if (o.alive && o.team === u.team && !o.summonU && dist2(o.x, o.y, u.x, u.y) < 100 * 100) {
              o.hp = Math.min(o.maxhp, o.hp + dt * 4);
            }
          });
        }
      }
      if (u.hp < u.maxhp && !nearestEnemy(u, 150)) u.hp = Math.min(u.maxhp, u.hp + dt * 1.2);
      if (u !== B.ctrl) unitAI(u, dt);
      if (u.mem && !u.summonU && !u.tempU) { u.mem.hp = Math.round(u.hp); u.mem.ft = u.ft; }
    });
    separation();

    for (var i = B.shots.length - 1; i >= 0; i--) {
      var s = B.shots[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      var hit = false;
      if (tileAt(s.x, s.y) === 'W') hit = true;
      if (!hit) {
        for (var k = 0; k < B.units.length; k++) {
          var u2 = B.units[k];
          if (!u2.alive || u2.team === s.team) continue;
          if (dist2(s.x, s.y, u2.x, u2.y) < (u2.r + 4) * (u2.r + 4)) {
            var gm = s.from ? gimmickMul(s.from, u2) : 1;
            var dmg = s.dmg ? Math.max(1, Math.round(s.dmg * gm - u2.df * 0.4)) : tryHit(s.from, u2, (s.kind === 'bolt' ? 1.15 : 1) * gm);
            if (dmg < 0) addFloat(u2.x, u2.y - u2.r - 8, 'MISS', '#bcc6cf');
            else dealDamage(s.from, u2, dmg);
            hit = true; break;
          }
        }
      }
      if (hit || s.life <= 0) B.shots.splice(i, 1);
    }

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

    if (c) {
      B.cam.x = lerp(B.cam.x, clamp(c.x - VIEW_W / 2, 0, B.w - VIEW_W), 0.12);
      B.cam.y = lerp(B.cam.y, clamp(c.y - VIEW_H / 2, 0, B.h - VIEW_H), 0.12);
    }

    if (!B.over) {
      var allies = 0, enemies = 0, aresAlive = false;
      B.units.forEach(function (u) {
        if (!u.alive) return;
        if (u.team === 0) { if (!u.summonU) allies++; if (u.key === 'ares') aresAlive = true; }
        else enemies++;
      });
      var wavesLeft = B.waves.some(function (w) { return !w.done; });
      if (!aresAlive) { B.over = 'lose'; setTimeout(endBattle, 1200); banner('아레스 전사…… 패배', '#ff8f8f'); }
      else if (enemies === 0 && !wavesLeft && !B.boss2Pending) { B.over = 'win'; setTimeout(endBattle, 1200); banner('🎉 승리! ' + B.region.name + ' 해방!', '#ffe27a'); }
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

    var list = B.units.slice().sort(function (a, b) { return a.y - b.y; });
    for (var i = 0; i < list.length; i++) drawUnit(c, list[i], camX, camY);

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

  // 거대 유닛(용·골렘·물뱀·갑옷기사·마신·정령) 전용 드로잉
  function drawBig(c, u, x, y, flash) {
    var r = u.r, col = flash ? '#fff' : u.color, trim = flash ? '#eee' : u.trim;
    c.save();
    c.translate(x, y);
    if (u.kind === 'dragon' || u.kind === 'salamander') {
      // 꼬리(등 뒤) — 오그의 약점 표현
      c.save(); c.rotate(u.face + Math.PI);
      c.strokeStyle = trim; c.lineWidth = 5;
      c.beginPath(); c.moveTo(r * 0.4, 0);
      c.quadraticCurveTo(r * 1.2, Math.sin(B.time * 4) * 6, r * 1.9, Math.sin(B.time * 3) * 10);
      c.stroke(); c.restore();
      c.fillStyle = col;
      c.beginPath(); c.ellipse(0, 0, r, r * 0.8, 0, 0, 7); c.fill();
      // 날개
      c.fillStyle = 'rgba(0,0,0,.25)';
      var wf = Math.sin(B.time * 6) * 0.3;
      c.beginPath(); c.ellipse(-r * 0.7, -r * 0.5, r * 0.8, r * 0.35, -0.6 + wf, 0, 7); c.fill();
      c.beginPath(); c.ellipse(r * 0.7, -r * 0.5, r * 0.8, r * 0.35, 0.6 - wf, 0, 7); c.fill();
      // 머리(진행 방향)
      c.save(); c.rotate(u.face);
      c.fillStyle = col;
      c.beginPath(); c.ellipse(r * 0.9, 0, r * 0.45, r * 0.3, 0, 0, 7); c.fill();
      c.fillStyle = '#ffd76a'; c.fillRect(r * 1.05, -3, 4, 2); c.fillRect(r * 1.05, 2, 4, 2);
      c.restore();
    } else if (u.kind === 'golem' || u.kind === 'armor') {
      c.fillStyle = col;
      c.fillRect(-r * 0.8, -r, r * 1.6, r * 1.7);                    // 몸통
      c.fillStyle = trim;
      c.fillRect(-r * 0.55, -r * 1.35, r * 1.1, r * 0.6);            // 머리
      c.fillStyle = u.kind === 'armor' ? '#8fd0ff' : '#ffb46a';
      c.fillRect(-r * 0.3, -r * 1.2, r * 0.22, r * 0.22);            // 눈
      c.fillRect(r * 0.1, -r * 1.2, r * 0.22, r * 0.22);
      c.fillStyle = 'rgba(0,0,0,.3)';
      c.fillRect(-r * 0.8, -r * 0.2, r * 1.6, r * 0.18);
      var sw = u.swing > 0 ? Math.sin(u.swing * 30) * 8 : 0;
      c.fillStyle = col;
      c.fillRect(-r * 1.25, -r * 0.7 + sw, r * 0.4, r * 1.1);        // 팔
      c.fillRect(r * 0.85, -r * 0.7 - sw, r * 0.4, r * 1.1);
    } else if (u.kind === 'serpent') {
      c.strokeStyle = col; c.lineWidth = r * 0.75; c.lineCap = 'round';
      c.beginPath();
      for (var s2 = 4; s2 >= 0; s2--) {
        var px = -Math.cos(u.face) * s2 * r * 0.55;
        var py = -Math.sin(u.face) * s2 * r * 0.55 + Math.sin(B.time * 5 + s2) * 5;
        if (s2 === 4) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.stroke();
      c.fillStyle = trim;
      c.beginPath(); c.arc(0, 0, r * 0.5, 0, 7); c.fill();           // 머리
      c.fillStyle = '#123';
      c.beginPath(); c.arc(Math.cos(u.face) * r * 0.25, Math.sin(u.face) * r * 0.25, 3, 0, 7); c.fill();
    } else if (u.kind === 'demon') {
      c.fillStyle = col;
      c.beginPath(); c.ellipse(0, -r * 0.2, r * 0.9, r * 1.1, 0, 0, 7); c.fill();
      c.strokeStyle = trim; c.lineWidth = 3;                          // 뿔
      c.beginPath(); c.moveTo(-r * 0.4, -r * 1.1); c.lineTo(-r * 0.7, -r * 1.6);
      c.moveTo(r * 0.4, -r * 1.1); c.lineTo(r * 0.7, -r * 1.6); c.stroke();
      c.fillStyle = '#ff5a8a';
      c.beginPath(); c.arc(-r * 0.3, -r * 0.6, 3, 0, 7); c.arc(r * 0.3, -r * 0.6, 3, 0, 7); c.fill();
      c.globalAlpha = 0.35 + Math.sin(B.time * 3) * 0.15;             // 어둠의 오라
      c.strokeStyle = '#b06aff'; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, r * 1.3, 0, 7); c.stroke();
      c.globalAlpha = 1;
    } else {
      c.fillStyle = col;
      c.beginPath(); c.ellipse(0, 0, r * 0.9, r, 0, 0, 7); c.fill();
    }
    c.restore();
  }

  function drawUnit(c, u, camX, camY) {
    var x = u.x - camX, y = u.y - camY;
    if (x < -60 || y < -60 || x > VIEW_W + 60 || y > VIEW_H + 60) return;
    if (!u.alive) return;
    var r = u.r;
    // 그림자(비행 유닛은 떠 있음)
    var hover = u.fly ? Math.sin(B.time * 3 + u.id) * 3 - 8 : 0;
    c.fillStyle = 'rgba(0,0,0,.3)';
    c.beginPath(); c.ellipse(x, y + r * 0.7, r * 0.9, r * 0.45, 0, 0, 7); c.fill();
    y += hover;
    if (u === B.ctrl) {
      c.strokeStyle = '#ffe27a'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y + 2, r + 5, 0, 7); c.stroke();
      c.fillStyle = '#ffe27a';
      c.beginPath(); c.moveTo(x, y - r - 16); c.lineTo(x - 5, y - r - 24); c.lineTo(x + 5, y - r - 24); c.closePath(); c.fill();
    }
    var flash = u.hurt > 0;
    if (u.petrify > 0) { c.save(); c.filter = 'grayscale(1)'; }

    if (u.big || u.kind) {
      drawBig(c, u, x, y, flash);
    } else {
      c.fillStyle = flash ? '#fff' : u.color;
      c.beginPath(); c.ellipse(x, y, r * 0.85, r, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(0,0,0,.45)'; c.lineWidth = 1; c.stroke();
      var doll = u.doll;
      c.fillStyle = flash ? '#fff' : (doll ? '#cbb894' : '#f0c9a0');
      c.beginPath(); c.arc(x, y - r * 0.95, r * 0.55, 0, 7); c.fill();
      c.fillStyle = flash ? '#eee' : u.trim;
      c.beginPath(); c.arc(x, y - r * 1.05, r * 0.55, Math.PI, 0); c.fill();
      if (u.boss) { c.fillStyle = '#ffd76a'; c.fillRect(x - r, y - r * 0.6, r * 2, 2); }
      if (doll) {
        c.fillStyle = '#443a28';
        c.fillRect(x - 3, y - r - 1, 2, 2); c.fillRect(x + 1, y - r - 1, 2, 2);
      }
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
      } else if (u.weapon !== 'claw') {
        c.strokeStyle = u.weapon === 'axe' || u.weapon === 'hammer' ? '#9a8a70' : '#d8dde4';
        c.lineWidth = u.weapon === 'hammer' ? 4 : 2;
        c.beginPath(); c.moveTo(x + Math.cos(wa) * r * 0.4, y + Math.sin(wa) * r * 0.4);
        c.lineTo(x + Math.cos(wa) * wl, y + Math.sin(wa) * wl); c.stroke();
      }
    }
    if (u.petrify > 0) c.restore();

    var hw = u.boss ? 34 : 18, hy = y - r - (u.boss || u.big ? 16 : 10);
    c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x - hw / 2, hy, hw, 3.5);
    var hr = u.hp / u.maxhp;
    c.fillStyle = u.team === 0 ? (hr > 0.35 ? '#5fd06a' : '#e8c84a') : '#e05a4e';
    c.fillRect(x - hw / 2, hy, hw * hr, 3.5);
    if (u.hero || u.boss || u.summonU) {
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
    c.strokeStyle = 'rgba(255,255,255,.35)';
    c.strokeRect(mx + B.cam.x / B.w * mw, my + B.cam.y / B.h * mh, VIEW_W / B.w * mw, VIEW_H / B.h * mh);
  }

  /* ---------- HUD/초상 ---------- */
  function addPortrait(u) {
    var bar = $('portraitBar');
    var d = document.createElement('div');
    d.className = 'fq-port' + (u.hero ? ' hero' : '') + (u.summonU ? ' summon' : '');
    d.style.setProperty('--c', u.color);
    d.innerHTML = '<span class="pp-nm">' + (u.hero ? '★' : (u.summonU ? '✦' : '')) + u.name.slice(0, 4) + '</span>' +
      '<span class="pp-hp"><i></i></span><span class="pp-ft"><i></i></span>';
    d.onclick = function () { if (u.alive) switchCtrl(u); };
    bar.appendChild(d);
    u.portEl = d;
  }
  function buildPortraits() {
    $('portraitBar').innerHTML = '';
    B.units.forEach(function (u) { if (u.team === 0) addPortrait(u); });
  }
  function updateHud() {
    if (!B) return;
    var c = B.ctrl;
    if (c) {
      $('hudName').textContent = (c.hero ? '★ ' : (c.summonU ? '✦ ' : '')) + c.name +
        (c.mem && !c.summonU ? '  Lv' + c.mem.lvl : '') +
        '  〔제' + (c.legion + 1) + '군단〕';
      $('hudStats').textContent = 'AT' + c.at + ' DF' + c.df + ' AR' + c.ar + ' DR' + c.dr;
      $('hudHpBar').style.width = clamp(c.hp / c.maxhp * 100, 0, 100) + '%';
      $('hudHpTxt').textContent = Math.max(0, Math.round(c.hp)) + '/' + c.maxhp;
      $('hudFtBar').style.width = clamp(c.ft, 0, 100) + '%';
      $('hudFtBar').className = 'ftfill' + (c.ft > 65 ? ' hot' : '');
      var spKey = fighterSpecial(c);
      var sp = spKey ? FQD.SPECIALS[spKey] : null;
      $('btnSpecial').textContent = sp ? ('✨ ' + sp.name + (c.scd > 0 ? ' (' + Math.ceil(c.scd) + ')' : '')) : '✨ ―';
      $('btnSpecial').disabled = !sp || c.scd > 0;
    }
    var a = 0, e = 0;
    B.units.forEach(function (u) { if (u.alive) { if (u.team === 0) a++; else e++; } });
    $('hudCount').textContent = '아군 ' + a + ' vs 적 ' + e;
    $('btnStone').textContent = '💥×' + (G.items.stone || 0);
    $('btnStone').disabled = (G.items.stone || 0) <= 0;
    $('btnPotion').textContent = '🧪×' + (G.items.potion || 0);
    $('btnPotion').disabled = (G.items.potion || 0) <= 0;
    $('btnCall').textContent = '🎺 지원군(' + B.reserves.length + '·' + B.callsLeft + '회)';
    $('btnCall').disabled = B.callsLeft <= 0 || !B.reserves.length;
    ['free', 'gather', 'charge'].forEach(function (o) {
      $('ord-' + o).classList.toggle('on', B.order === o);
    });
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
    if (win) {
      B.units.forEach(function (u) {
        if (u.team !== 0 || !u.mem || u.summonU || u.tempU) return;
        if (u.alive) {
          u.mem.hp = Math.min(maxHpOf(u.mem), Math.round(u.hp + (maxHpOf(u.mem) - u.hp) * 0.6));
          u.mem.ft = Math.round(u.ft * 0.25);
        }
      });
      G.army = G.army.filter(function (m) { return m.alive; });
      G.owners[r.id] = 0;
      G.turn++;
      var joined = [];
      var rw = r.reward || {};
      (rw.heroes || []).forEach(function (hk) {
        if (!G.army.some(function (m) { return m.key === hk; }) && G.fallen.indexOf(baseOf(hk).name) === -1) {
          G.army.push(makeMember(hk, Math.max(2, r.lvl)));
          G.codex[hk] = true;
          joined.push('★ ' + baseOf(hk).name);
        }
      });
      (rw.units || []).forEach(function (g) {
        for (var i = 0; i < g[1]; i++) G.army.push(makeMember(g[0], g[2]));
        joined.push(baseOf(g[0]).name + ' ×' + g[1]);
      });
      (rw.flags || []).forEach(function (fl) { G.flags[fl] = true; });
      if (rw.items) Object.keys(rw.items).forEach(function (k) { G.items[k] = (G.items[k] || 0) + rw.items[k]; });
      save();
      showResult(true, joined);
    } else {
      var snap = JSON.parse(preBattle);
      G.army = snap.army; G.fallen = snap.fallen; G.items = snap.items;
      showResult(false, []);
    }
  }

  function showResult(win, joined) {
    var r = B.region;
    $('rsTitle').textContent = win ? '🎉 ' + r.name + ' 해방!' : '💀 패배……';
    var dead = [];
    B.units.forEach(function (u) {
      if (u.team === 0 && !u.alive && !u.summonU && !u.tempU) dead.push((u.hero ? '★' : '') + u.name);
    });
    var h = '<p>격파한 적: <b>' + B.kills + '</b>명</p>';
    if (win) {
      h += dead.length ? '<p class="fq-warn">아군 전사: ' + dead.join(', ') + '</p>' : '<p>아군 전사자 없음 — 완벽한 승리!</p>';
      if (joined.length) h += '<p class="fq-good">부대 합류: ' + joined.join(' · ') + '</p>';
      var rw = r.reward || {};
      if (rw.items) {
        var its = Object.keys(rw.items).map(function (k) { return FQD.ITEMS[k].emoji + ' ' + FQD.ITEMS[k].name + ' ×' + rw.items[k]; });
        h += '<p class="fq-good">획득: ' + its.join(' · ') + '</p>';
      }
    } else {
      h += '<p class="fq-dim">부대를 국경까지 물렸다. 병력과 아이템은 출진 전으로 돌아간다. (부대장과 편성을 바꿔 재도전해 보자)</p>';
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
    $('rsTitle').textContent = '👑 로그리스 해방 — 바르시아 전기 완결!';
    $('rsBody').innerHTML =
      '<p>가로아는 어둠 속으로 사라지고, 제넬루 왕은 본래의 현왕으로 돌아왔다.</p>' +
      '<p>턴 수: <b>' + G.turn + '</b> · 전사한 영웅: ' + (G.fallen.length ? G.fallen.join(', ') : '없음') + '</p>' +
      '<p class="fq-dim">이 싸움의 기억은 머나먼 훗날, 「퍼스트 퀸」의 시대로 이어진다…….</p>' +
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

  /* ================= 입력 ================= */
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
      else if (e.key === 'q' || e.key === 'Q') switchLegion();
      else if (e.key === 'r' || e.key === 'R') callReinforcements();
      else if (e.key === '1') setOrder('free');
      else if (e.key === '2') setOrder('gather');
      else if (e.key === '3') setOrder('charge');
      else if (e.key === '4') useItem('stone');
      else if (e.key === '5') useItem('potion');
      else if (e.key === 'Escape') retreat();
    });
    document.addEventListener('keyup', function (e) { keys[e.key] = false; });

    $('dlgOverlay').addEventListener('click', function () { dlgStep(); });

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

    $('btnSpecial').onclick = function () { if (B && B.ctrl && B.ctrl.alive) useSpecial(B.ctrl); };
    $('btnSwitch').onclick = function () { cycleCtrl(1); };
    $('btnLegion').onclick = switchLegion;
    $('btnCall').onclick = callReinforcements;
    $('btnStone').onclick = function () { useItem('stone'); };
    $('btnPotion').onclick = function () { useItem('potion'); };
    $('ord-free').onclick = function () { setOrder('free'); };
    $('ord-gather').onclick = function () { setOrder('gather'); };
    $('ord-charge').onclick = function () { setOrder('charge'); };
    $('btnRetreat').onclick = function () {
      if (confirm('부대를 물리고 전략 맵으로 돌아갑니까? (전투 상황은 초기화됩니다)')) retreat();
    };

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

    $('dpLeader2').onchange = function () {
      leader2 = this.value;
      autoFill();
      renderDeploy();
    };
    $('dpGo').onclick = function () {
      var r = FQD.REGIONS[deployTarget];
      var go = function () { startBattle(deployTarget); };
      if (r.storyBefore) dialog(r.storyBefore, go); else go();
    };
    $('dpBack').onclick = function () { show('strategy'); };

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
    $('stCodexBtn').onclick = openCodex;
    $('codexClose').onclick = function () { $('codexModal').classList.remove('on'); };
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
