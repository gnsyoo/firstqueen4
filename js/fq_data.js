/* =====================================================================
   퍼스트 퀸 IV 재현 목업 — 데이터 정의
   (呉ソフトウェア工房 1994년작 「ファーストクイーンIV ~バルシア戦記~」의
    고챠캐릭(ごちゃキャラ) 시스템·맵·스토리를 웹으로 재현한 오마주)
   - 대륙: 로그리스 / 적국: 바르시아(제넬 왕·참모 자닐) / 아군: 카리온(아레스)
   - 능력치: AT(공격력)·DF(방어력)·AR(공격율)·DR(방어율)·FT(피로도)
   ===================================================================== */
var FQD = (function () {
  'use strict';

  /* ---------- 결정적 난수(맵 생성용) ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 타일 정의 ----------
     . 풀  g 짙은풀  d 흙  r 길  b 다리  f 숲(감속)  t 나무(차단)
     w 물(차단)  m 산(차단)  h 바위언덕(감속)  x 바위(차단)
     S 눈  W 성벽(차단)  F 석재바닥  c 융단  s 모래                      */
  var TILE = {
    '.': { name: '풀밭',   walk: true,  spd: 1.0 },
    'g': { name: '초원',   walk: true,  spd: 1.0 },
    'd': { name: '흙',     walk: true,  spd: 1.0 },
    'r': { name: '가도',   walk: true,  spd: 1.2 },
    'b': { name: '다리',   walk: true,  spd: 1.1 },
    'f': { name: '숲',     walk: true,  spd: 0.62 },
    't': { name: '거목',   walk: false, spd: 0 },
    'w': { name: '물',     walk: false, spd: 0 },
    'm': { name: '산',     walk: false, spd: 0 },
    'h': { name: '언덕',   walk: true,  spd: 0.7 },
    'x': { name: '바위',   walk: false, spd: 0 },
    'S': { name: '설원',   walk: true,  spd: 0.8 },
    'W': { name: '성벽',   walk: false, spd: 0 },
    'F': { name: '석재',   walk: true,  spd: 1.05 },
    'c': { name: '융단',   walk: true,  spd: 1.05 },
    's': { name: '모래',   walk: true,  spd: 0.9 }
  };

  /* ---------- 맵 빌더 ---------- */
  function Grid(w, h, fill) {
    var g = [];
    for (var y = 0; y < h; y++) { g.push(new Array(w).fill(fill)); }
    return { w: w, h: h, g: g };
  }
  function rect(M, ch, x, y, w, h) {
    for (var j = y; j < y + h; j++) for (var i = x; i < x + w; i++) {
      if (i >= 0 && j >= 0 && i < M.w && j < M.h) M.g[j][i] = ch;
    }
  }
  function blob(M, ch, cx, cy, r, rnd, skip) {
    for (var j = cy - r; j <= cy + r; j++) for (var i = cx - r; i <= cx + r; i++) {
      if (i < 1 || j < 1 || i >= M.w - 1 || j >= M.h - 1) continue;
      var dx = i - cx, dy = j - cy;
      if (dx * dx + dy * dy <= r * r * (0.55 + rnd() * 0.55)) {
        if (skip && skip.indexOf(M.g[j][i]) !== -1) continue;
        M.g[j][i] = ch;
      }
    }
  }
  function scatter(M, ch, count, rnd, on) {
    var n = 0, guard = 0;
    while (n < count && guard++ < count * 60) {
      var i = 1 + Math.floor(rnd() * (M.w - 2));
      var j = 1 + Math.floor(rnd() * (M.h - 2));
      if (on && on.indexOf(M.g[j][i]) === -1) continue;
      M.g[j][i] = ch; n++;
    }
  }
  // 세로로 구불구불한 길
  function windPath(M, ch, x0, width, rnd, yFrom, yTo) {
    var x = x0;
    for (var y = yFrom; y <= yTo; y++) {
      x += Math.round((rnd() - 0.5) * 2);
      x = Math.max(2, Math.min(M.w - 2 - width, x));
      for (var i = 0; i < width; i++) M.g[y][x + i] = ch;
    }
  }
  function border(M, ch) {
    rect(M, ch, 0, 0, M.w, 1); rect(M, ch, 0, M.h - 1, M.w, 1);
    rect(M, ch, 0, 0, 1, M.h); rect(M, ch, M.w - 1, 0, 1, M.h);
  }
  function toStrings(M) { return M.g.map(function (row) { return row.join(''); }); }

  /* ===== 1. 남부 국경 평원 — 인형병사 선봉대 ===== */
  function mapBorderPlain() {
    var rnd = mulberry32(41), M = Grid(46, 34, '.');
    scatter(M, 'g', 240, rnd, ['.']);
    blob(M, 'f', 8, 8, 5, rnd); blob(M, 'f', 38, 6, 4, rnd);
    blob(M, 'f', 6, 24, 4, rnd); blob(M, 'f', 40, 26, 5, rnd);
    blob(M, 'h', 22, 6, 3, rnd);
    scatter(M, 't', 26, rnd, ['f']);
    windPath(M, 'r', 21, 3, rnd, 1, 32);          // 남북 가도
    rect(M, 'd', 18, 27, 10, 5);                  // 남쪽 야영지(아군 출발)
    scatter(M, 'x', 8, rnd, ['.', 'g']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 2. 로그리스 대교 — 강의 요새선 (오그) ===== */
  function mapRiverBridge() {
    var rnd = mulberry32(7), M = Grid(46, 34, '.');
    scatter(M, 'g', 220, rnd, ['.']);
    blob(M, 'f', 6, 28, 4, rnd); blob(M, 'f', 40, 29, 4, rnd);
    blob(M, 'f', 5, 5, 4, rnd);
    // 대륙을 가르는 큰 강(중앙 가로) — 굴곡
    var yb = 15;
    for (var x = 0; x < 46; x++) {
      var yy = yb + Math.round(Math.sin(x * 0.35) * 1.6);
      rect(M, 'w', x, yy, 1, 5);
    }
    rect(M, 's', 0, 12, 46, 1);                    // 강변 모래톱 힌트
    for (var x2 = 0; x2 < 46; x2++) { if (M.g[12][x2] === 'w') M.g[12][x2] = 'w'; }
    windPath(M, 'r', 21, 3, rnd, 1, 32);
    rect(M, 'b', 20, 12, 5, 10);                   // 로그리스 대교(중앙)
    rect(M, 'b', 38, 13, 3, 8);                    // 동쪽 낡은 다리
    scatter(M, 't', 20, rnd, ['f']);
    scatter(M, 'x', 6, rnd, ['.', 'g']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 3. 서부 대삼림 — 바람의 장군 스리프트 ===== */
  function mapGreatForest() {
    var rnd = mulberry32(93), M = Grid(46, 34, 'f');
    // 빈터(클리어링)들
    blob(M, '.', 23, 29, 6, rnd); blob(M, '.', 10, 18, 5, rnd);
    blob(M, '.', 34, 14, 5, rnd); blob(M, '.', 22, 5, 6, rnd);
    blob(M, 'g', 23, 5, 3, rnd);
    windPath(M, 'd', 22, 2, rnd, 1, 32);          // 숲길
    scatter(M, 't', 150, rnd, ['f']);
    blob(M, 'w', 40, 28, 3, rnd);                  // 숲속 연못
    scatter(M, 'x', 5, rnd, ['.']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 4. 동부 바위고개 — 땅의 장군 가이아 ===== */
  function mapRockPass() {
    var rnd = mulberry32(55), M = Grid(46, 34, 'h');
    rect(M, 'm', 0, 0, 46, 34);
    // S자 협로 깎기
    var pts = [[23, 33], [23, 27], [10, 24], [8, 18], [22, 15], [36, 12], [37, 7], [23, 4], [23, 1]];
    for (var k = 0; k < pts.length - 1; k++) {
      var a = pts[k], b2 = pts[k + 1], steps = 26;
      for (var s = 0; s <= steps; s++) {
        var cx = Math.round(a[0] + (b2[0] - a[0]) * s / steps);
        var cy = Math.round(a[1] + (b2[1] - a[1]) * s / steps);
        blob(M, 'h', cx, cy, 4, rnd);
        blob(M, 'd', cx, cy, 2, rnd);
      }
    }
    blob(M, '.', 23, 30, 3, rnd); blob(M, '.', 23, 4, 3, rnd);
    scatter(M, 'x', 26, rnd, ['h']);
    border(M, 'm');
    return toStrings(M);
  }

  /* ===== 5. 중앙 요새 리간 — 불의 장군 모드레드 ===== */
  function mapFortress() {
    var rnd = mulberry32(12), M = Grid(46, 34, '.');
    scatter(M, 'g', 200, rnd, ['.']);
    blob(M, 'f', 5, 27, 4, rnd); blob(M, 'f', 41, 28, 4, rnd);
    windPath(M, 'r', 21, 3, rnd, 20, 32);
    // 외성벽(중단) + 성문
    rect(M, 'W', 6, 17, 34, 2);
    rect(M, 'r', 21, 17, 4, 2);                    // 성문 통로
    rect(M, 'F', 8, 4, 30, 13);                    // 성 내부 석재 마당
    rect(M, 'W', 8, 3, 30, 1);                     // 내성 북벽
    rect(M, 'W', 7, 3, 1, 16); rect(M, 'W', 38, 3, 1, 16);
    rect(M, 'c', 20, 4, 6, 8);                     // 중앙 융단
    rect(M, 'W', 14, 8, 4, 2); rect(M, 'W', 28, 8, 4, 2);  // 내부 방벽
    scatter(M, 't', 14, rnd, ['f']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 6. 북부 설원 — 인형 군단 본대 ===== */
  function mapSnowfield() {
    var rnd = mulberry32(77), M = Grid(46, 34, 'S');
    blob(M, 'w', 12, 10, 5, rnd);                  // 얼어붙다 만 호수
    blob(M, 'w', 34, 22, 4, rnd);
    blob(M, 'f', 40, 6, 4, rnd); blob(M, 'f', 6, 26, 4, rnd);
    blob(M, 'h', 24, 16, 3, rnd);
    windPath(M, 'd', 21, 2, rnd, 1, 32);
    scatter(M, 't', 22, rnd, ['S', 'f']);
    scatter(M, 'x', 12, rnd, ['S']);
    border(M, 'm');
    return toStrings(M);
  }

  /* ===== 7. 바르시아 왕도 — 제넬 왕 → 자닐 ===== */
  function mapCapital() {
    var rnd = mulberry32(3), M = Grid(46, 36, 'F');
    rect(M, '.', 0, 28, 46, 8);                    // 성 밖 남쪽 풀밭
    scatter(M, 'g', 40, rnd, ['.']);
    rect(M, 'W', 4, 26, 38, 2); rect(M, 'r', 21, 26, 4, 2);   // 외성벽+성문
    rect(M, 'r', 21, 28, 4, 8);
    rect(M, 'W', 4, 4, 1, 24); rect(M, 'W', 41, 4, 1, 24);    // 좌우 성벽
    rect(M, 'W', 4, 4, 38, 1);
    rect(M, 'c', 20, 5, 6, 21);                    // 왕좌로 이어지는 융단
    rect(M, 'W', 10, 12, 6, 2); rect(M, 'W', 30, 12, 6, 2);   // 내부 방벽
    rect(M, 'W', 10, 20, 6, 2); rect(M, 'W', 30, 20, 6, 2);
    rect(M, 'c', 17, 5, 12, 4);                    // 왕좌의 단
    rect(M, 'W', 17, 4, 12, 1);
    border(M, 'W');
    rect(M, '.', 0, 34, 46, 2); rect(M, 'r', 21, 34, 4, 2);
    return toStrings(M);
  }

  /* ---------- 병종/캐릭터 정의 ----------
     base: lvl1 능력치. AT공격력 DF방어력 AR공격율 DR방어율.
     실효 공격 = AT×(AR/100), 실효 방어 = DF×(DR/100). 피로도(FT)가 높으면
     원작처럼 방어(DF·DR)가 급락한다. hero: 이름있는 캐릭(전사 시 영구 소실)   */
  var UNITS = {
    /* --- 카리온(아군) --- */
    ares:   { name: '아레스',   cls: '카리온 왕자', hero: true, team: 0, weapon: 'sword',
              hp: 190, at: 20, df: 12, ar: 108, dr: 88, spd: 100, r: 9,
              special: 'fireNova', color: '#e0483e', trim: '#f7d774',
              bio: '카리온의 왕자이자 이 이야기의 주인공. 자신도 모르는 사이 불의 정령왕의 힘이 깃들어 있다.' },
    elaine: { name: '애레인',   cls: '닌자 부대장', hero: true, team: 0, weapon: 'dagger',
              hp: 130, at: 16, df: 8, ar: 122, dr: 96, spd: 128, r: 8,
              special: 'shuriken', color: '#7f5bd6', trim: '#e8c8ff',
              bio: '아레스의 연인. 사로잡힌 아레스를 구하기 위해 닌자 부대를 이끌고 국경을 넘었다.' },
    knight: { name: '근위기사', cls: '카리온 근위대', team: 0, weapon: 'sword',
              hp: 120, at: 14, df: 11, ar: 96, dr: 78, spd: 88, r: 9, color: '#3f6fd8', trim: '#cfd8ea' },
    sword:  { name: '검병',     cls: '카리온 보병',   team: 0, weapon: 'sword',
              hp: 85,  at: 12, df: 7,  ar: 92, dr: 66, spd: 94, r: 8, color: '#4c86c8', trim: '#a9c6e2' },
    spear:  { name: '창병',     cls: '카리온 창병',   team: 0, weapon: 'spear',
              hp: 90,  at: 13, df: 8,  ar: 90, dr: 70, spd: 90, r: 8, reach: 16, color: '#3e9d8e', trim: '#bfe5dd' },
    archer: { name: '궁병',     cls: '카리온 궁병',   team: 0, weapon: 'bow',
              hp: 62,  at: 11, df: 4,  ar: 98, dr: 58, spd: 92, r: 7, range: 175, color: '#7d9c4a', trim: '#dce8b8' },
    ninja:  { name: '닌자',     cls: '애레인 직속',   team: 0, weapon: 'dagger',
              hp: 72,  at: 13, df: 5,  ar: 112, dr: 84, spd: 122, r: 7, color: '#6b56b8', trim: '#c9baf0' },

    /* --- 바르시아(적) --- */
    puppet:  { name: '인형병사', cls: '마법 인형', team: 1, weapon: 'sword', doll: true,
               hp: 58, at: 10, df: 5, ar: 86, dr: 55, spd: 84, r: 8, color: '#9d8d76', trim: '#5d5142' },
    puppetH: { name: '중장인형', cls: '마법 인형', team: 1, weapon: 'axe', doll: true,
               hp: 130, at: 15, df: 12, ar: 84, dr: 62, spd: 66, r: 10, color: '#8a7a63', trim: '#3f382d' },
    bsword:  { name: '바르시아 검병', cls: '바르시아 정규군', team: 1, weapon: 'sword',
               hp: 88, at: 12, df: 8, ar: 92, dr: 68, spd: 92, r: 8, color: '#b4485a', trim: '#e6b8c0' },
    bspear:  { name: '바르시아 창병', cls: '바르시아 정규군', team: 1, weapon: 'spear',
               hp: 92, at: 13, df: 9, ar: 90, dr: 70, spd: 88, r: 8, reach: 16, color: '#a84472', trim: '#e2bad0' },
    barcher: { name: '바르시아 궁병', cls: '바르시아 정규군', team: 1, weapon: 'bow',
               hp: 60, at: 11, df: 4, ar: 96, dr: 56, spd: 90, r: 7, range: 175, color: '#c06a4e', trim: '#ecd0c2' },
    mage:    { name: '마도병', cls: '바르시아 마도군', team: 1, weapon: 'staff',
               hp: 66, at: 15, df: 4, ar: 100, dr: 60, spd: 80, r: 7, range: 205, bolt: true, color: '#8d55c8', trim: '#e3cdf5' },

    /* --- 바르시아 4장군 + 수뇌 --- */
    og:      { name: '오그',     cls: '물의 장군', hero: true, boss: true, team: 1, weapon: 'axe',
               hp: 420, at: 22, df: 14, ar: 104, dr: 86, spd: 84, r: 12, special: 'waterBurst',
               color: '#3d7fbe', trim: '#bfe0f5',
               bio: '바르시아 사장군 중 하나. 로그리스 강의 수문을 지배한다.' },
    thrift:  { name: '스리프트', cls: '바람의 장군', hero: true, boss: true, team: 1, weapon: 'dagger',
               hp: 360, at: 20, df: 10, ar: 122, dr: 100, spd: 138, r: 10, special: 'galeDash',
               color: '#43a06c', trim: '#c8ecd6',
               bio: '바르시아 사장군 중 하나. 바람처럼 나타나 바람처럼 사라진다.' },
    gaia:    { name: '가이아',   cls: '땅의 장군', hero: true, boss: true, team: 1, weapon: 'hammer',
               hp: 520, at: 25, df: 18, ar: 98, dr: 82, spd: 68, r: 13, special: 'quake',
               color: '#96703c', trim: '#e6d2ac',
               bio: '바르시아 사장군 중 하나. 대지를 뒤흔드는 거구의 맹장.' },
    mordred: { name: '모드레드', cls: '불의 장군', hero: true, boss: true, team: 1, weapon: 'sword',
               hp: 470, at: 24, df: 14, ar: 108, dr: 88, spd: 92, r: 12, special: 'fireNova',
               color: '#c8502e', trim: '#f5c9a8',
               bio: '바르시아 사장군의 필두. 요새 리간을 불꽃으로 지킨다.' },
    zenel:   { name: '제넬 왕',  cls: '바르시아 국왕', hero: true, boss: true, team: 1, weapon: 'sword',
               hp: 620, at: 27, df: 16, ar: 112, dr: 92, spd: 96, r: 12, special: 'lightning',
               color: '#b8973f', trim: '#f3e6b8',
               bio: '한때 현왕이라 불렸던 바르시아의 왕. 참모 자닐을 맞아들인 뒤 사람이 변했다.' },
    zanil:   { name: '자닐',     cls: '수수께끼의 마도사', hero: true, boss: true, team: 1, weapon: 'staff',
               hp: 780, at: 30, df: 14, ar: 116, dr: 96, spd: 88, r: 12, range: 230, bolt: true, special: 'darkWave',
               color: '#5a3d8f', trim: '#cdb3f0',
               bio: '다른 대륙에서 건너와 제넬 왕의 참모가 된 마도사. 그 정체는 시리즈의 숙적 가로아—.' }
  };

  /* ---------- 특수능력(스페이스 키) ---------- */
  var SPECIALS = {
    fireNova:  { name: '화염참',     desc: '주위를 불꽃으로 후려친다', cd: 8,  ft: 22, radius: 110, mult: 2.6, fx: 'fire' },
    shuriken:  { name: '수리검 난무', desc: '8방향 수리검 투척',       cd: 6,  ft: 14, mult: 1.5, fx: 'shuriken' },
    waterBurst:{ name: '수류탄파',   desc: '물의 충격파',             cd: 9,  ft: 0,  radius: 120, mult: 2.2, fx: 'water' },
    galeDash:  { name: '질풍참',     desc: '바람의 연속 베기',         cd: 7,  ft: 0,  radius: 90,  mult: 2.0, fx: 'wind' },
    quake:     { name: '대지진동',   desc: '대지를 내리쳐 광역 강타',   cd: 10, ft: 0,  radius: 140, mult: 2.4, fx: 'earth' },
    lightning: { name: '뇌격',       desc: '번개로 광역 타격',         cd: 9,  ft: 0,  radius: 130, mult: 2.5, fx: 'bolt' },
    darkWave:  { name: '암흑파동',   desc: '어둠의 파동',             cd: 8,  ft: 0,  radius: 150, mult: 2.6, fx: 'dark' }
  };

  /* ---------- 로그리스 대륙 — 지역(전략맵) ----------
     garrison: [병종, 수, 시작레벨]  waves: 전투 중 적 지원군
     reward.units: 승리 시 합류 병사 / reward.heroes: 합류 영웅          */
  var REGIONS = [
    {
      id: 0, key: 'carion', name: '카리온 왕도', owner: 0, hq: true,
      x: 460, y: 500, adj: [1],
      desc: '남부의 소국 카리온. 아레스의 조국이자 반(反)바르시아 동맹의 기치가 오른 곳.'
    },
    {
      id: 1, key: 'plain', name: '남부 국경 평원', owner: 1,
      x: 430, y: 400, adj: [0, 2], map: mapBorderPlain, lvl: 1,
      desc: '카리온과 바르시아령이 맞닿는 초원 지대. 인형병사 선봉대가 남하 중이다.',
      garrison: [['puppet', 10, 1], ['bsword', 4, 1], ['bspear', 3, 1]],
      waves: [{ at: 'half', from: 'N', units: [['puppet', 6, 1]], msg: '북쪽에서 인형병사 지원대가 나타났다!' }],
      allySpawn: 'S', enemySpawn: 'N',
      reward: { units: [['sword', 2, 1], ['spear', 1, 1]] },
      storyBefore: [
        '【아레스】 국경을 넘는다. 목표는 바르시아 왕도 — 제넬 왕의 폭주를 멈춘다.',
        '【근위기사】 전방에 인형병사 선봉대! 수는 이쪽이 불리합니다!',
        '【아레스】 상관없다. 전원, 나를 따르라!'
      ],
      storyAfter: [
        '격파된 인형병사는 나무 조각처럼 부서져 흩어졌다.',
        '【아레스】 이것이 자닐의 「병사」인가…… 사람이 아니라서 오히려 소름이 돋는군.',
        '패주병을 흡수해 부대가 조금 늘었다.'
      ]
    },
    {
      id: 2, key: 'bridge', name: '로그리스 대교', owner: 1,
      x: 430, y: 300, adj: [1, 3, 4, 5], map: mapRiverBridge, lvl: 2,
      desc: '대륙을 남북으로 가르는 큰 강. 물의 장군 오그가 대교의 수비를 맡고 있다.',
      garrison: [['bspear', 6, 2], ['bsword', 5, 2], ['barcher', 4, 2], ['puppet', 6, 2]],
      boss: ['og', 3],
      waves: [{ at: 'boss', from: 'N', units: [['puppet', 8, 2]], msg: '오그가 예비대를 불러들였다!' }],
      allySpawn: 'S', enemySpawn: 'N',
      reward: { heroes: ['elaine'], units: [['ninja', 4, 2], ['archer', 2, 2]] },
      storyBefore: [
        '【척후】 다리 건너편에 적진! 물의 장군 오그의 깃발입니다!',
        '【오그】 카리온의 애송이가 여기까지…… 강을 건너고 싶으면 힘으로 건너 보아라!',
        '다리는 좁다. 부대 명령을 활용해 한꺼번에 포위당하지 않도록 하자.'
      ],
      storyAfter: [
        '오그가 강에 잠기듯 쓰러지자, 상류에서 검은 옷의 부대가 나타났다.',
        '【애레인】 아레스! 무사했군요…… 늦어서 미안해요.',
        '【아레스】 애레인! …네 닌자 부대가 있으면 백만의 원군을 얻은 것과 같다.',
        '★ 애레인과 닌자 부대가 아군에 합류했다!'
      ]
    },
    {
      id: 3, key: 'forest', name: '서부 대삼림', owner: 1,
      x: 300, y: 230, adj: [2, 5], map: mapGreatForest, lvl: 3,
      desc: '해를 가리는 거목의 바다. 바람의 장군 스리프트가 숲 그늘에서 기다린다.',
      garrison: [['bsword', 6, 3], ['barcher', 6, 3], ['puppet', 8, 3]],
      boss: ['thrift', 4],
      waves: [{ at: 'half', from: 'W', units: [['bsword', 4, 3], ['barcher', 2, 3]], msg: '숲 속에서 복병이다!' }],
      allySpawn: 'S', enemySpawn: 'N',
      reward: { units: [['archer', 3, 3]] },
      storyBefore: [
        '【애레인】 숲에서는 활도 마법도 통하기 어려워요. 나무 사이 좁은 길을 조심해요.',
        '【스리프트】 …왔군. 바람은 보이지 않아. 너희가 쓰러지는 순간까지도.'
      ],
      storyAfter: [
        '【스리프트】 …빠르군. 바람보다도……. (쓰러진다)',
        '숲을 빠져나가는 가도가 열렸다. 중앙 요새 리간이 눈앞이다.'
      ]
    },
    {
      id: 4, key: 'pass', name: '동부 바위고개', owner: 1,
      x: 560, y: 230, adj: [2, 5], map: mapRockPass, lvl: 3,
      desc: '수레 하나가 겨우 지나는 바위 협로. 땅의 장군 가이아가 길목을 막아섰다.',
      garrison: [['puppetH', 5, 3], ['puppet', 8, 3], ['bspear', 5, 3]],
      boss: ['gaia', 4],
      waves: [{ at: 'half', from: 'N', units: [['puppetH', 3, 3]], msg: '고개 위에서 중장인형이 굴러 내려온다!' }],
      allySpawn: 'S', enemySpawn: 'N',
      reward: { units: [['knight', 2, 3]] },
      storyBefore: [
        '【근위기사】 좁은 길입니다. 대열이 늘어지면 각개격파당합니다!',
        '【가이아】 이 고개는 지나갈 수 없다. 돌아가라, 카리온의 왕자여. 그것이 자비다.'
      ],
      storyAfter: [
        '【가이아】 훌륭하다…… 그 힘, 어쩌면 정말로…….',
        '가이아는 마지막에 무언가 말하려 했지만, 인형처럼 굳어 무너져 내렸다.'
      ]
    },
    {
      id: 5, key: 'fortress', name: '중앙 요새 리간', owner: 1,
      x: 430, y: 160, adj: [2, 3, 4, 6], map: mapFortress, lvl: 5,
      desc: '바르시아 남방 방위의 핵. 불의 장군 모드레드가 성문을 걸어 잠갔다.',
      garrison: [['bsword', 6, 5], ['bspear', 5, 5], ['barcher', 5, 5], ['mage', 3, 5], ['puppetH', 4, 5]],
      boss: ['mordred', 6],
      waves: [{ at: 'boss', from: 'N', units: [['puppet', 8, 5], ['mage', 2, 5]], msg: '내성에서 마도병 예비대가 출격했다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { units: [['knight', 2, 5], ['sword', 2, 5]] },
      storyBefore: [
        '【애레인】 성문 앞은 화살비예요. 단숨에 문을 빼앗아 성 안으로!',
        '【모드레드】 잘 왔다, 불꽃의 아이여. 네 안의 「그 힘」…… 내 불로 시험해 주마!'
      ],
      storyAfter: [
        '【모드레드】 하하…… 과연. 불의 정령왕은…… 너를 택했군…….',
        '【아레스】 불의…… 정령왕? 내 안의 이 열기가, 그것인가.',
        '요새 리간 함락. 바르시아 본토로 가는 길이 열렸다.'
      ]
    },
    {
      id: 6, key: 'snow', name: '북부 설원', owner: 1,
      x: 380, y: 90, adj: [5, 7], map: mapSnowfield, lvl: 7,
      desc: '바르시아 왕도 앞에 펼쳐진 은빛 벌판. 인형 군단의 본대가 전개해 있다.',
      garrison: [['puppet', 14, 7], ['puppetH', 6, 7], ['mage', 4, 7], ['barcher', 4, 7]],
      waves: [{ at: 'half', from: 'N', units: [['puppet', 10, 7]], msg: '눈보라 너머에서 인형의 대군이 몰려온다!' }],
      allySpawn: 'S', enemySpawn: 'N',
      reward: { units: [['spear', 2, 7], ['archer', 2, 7]] },
      storyBefore: [
        '【척후】 …셀 수가 없습니다. 설원 전체가 인형병사입니다.',
        '【아레스】 여기를 넘으면 왕도다. 총력전이다 — 한 명도 헛되이 죽지 마라!'
      ],
      storyAfter: [
        '눈보라가 그치자, 부서진 인형 조각만이 은빛 벌판을 뒤덮고 있었다.',
        '지평선 너머로 바르시아 왕도의 첨탑이 보인다.'
      ]
    },
    {
      id: 7, key: 'capital', name: '바르시아 왕도', owner: 1, capital: true,
      x: 430, y: 30, adj: [6], map: mapCapital, lvl: 9,
      desc: '마법대국 바르시아의 심장. 옥좌에는 제넬 왕이, 그 그림자에는 자닐이 있다.',
      garrison: [['bsword', 6, 9], ['bspear', 5, 9], ['mage', 5, 9], ['puppetH', 5, 9], ['barcher', 4, 9]],
      boss: ['zenel', 10],
      boss2: { unit: ['zanil', 12], escorts: [['puppet', 8, 9], ['mage', 3, 9]],
        msg: [
          '【제넬 왕】 …내가, 대체 무엇을…… 아레스 왕자…… 도망쳐라, 저 자는…….',
          '【자닐】 쓸모없어진 인형이 말이 많군. — 그래, 내 이름은 가로아. 이 대륙의 「다음 왕」이다.',
          '자닐이 본모습을 드러냈다! 마지막 전투다!'
        ] },
      waves: [],
      allySpawn: 'S', enemySpawn: 'C',
      reward: {},
      storyBefore: [
        '【애레인】 왕도의 결계가 열려 있어요…… 함정이라도 상관없다는 거군요.',
        '【아레스】 제넬 왕을 쓰러뜨리는 게 아니다. 「되찾는」 거다. 가자!'
      ],
      storyAfter: [
        '가로아가 소멸하자 왕도를 뒤덮던 어두운 안개가 걷혔다.',
        '【제넬 왕】 …모든 것이 나의 약함 탓이다. 카리온의 왕자여, 이 대륙을 부탁한다.',
        '【아레스】 아니오. 함께 다시 세우는 겁니다. 사람의 손으로.',
        '이리하여 로그리스에 다시 평화가 찾아왔다. — 퍼스트 퀸 IV 재현 목업 · 完 —'
      ]
    }
  ];

  /* ---------- 시작 부대 ---------- */
  var START_ARMY = [
    ['ares', 1], ['knight', 1], ['knight', 1],
    ['sword', 1], ['sword', 1], ['sword', 1], ['sword', 1], ['sword', 1],
    ['spear', 1], ['spear', 1], ['spear', 1], ['spear', 1],
    ['archer', 1], ['archer', 1], ['archer', 1], ['archer', 1]
  ];

  var INTRO = [
    '― 가이아 대륙의 싸움으로부터 20년. ―',
    '천지의 정령이 지켜보는 대륙 로그리스는, 마법대국 바르시아를 중심으로 평화를 지켜왔다.',
    '그러나 현왕이라 불리던 제넬 왕은, 다른 대륙에서 온 마도사 「자닐」을 참모로 맞은 뒤 돌변한다.',
    '인형에 영혼을 불어넣은 「인형병사」로 군비를 늘린 바르시아는, 마침내 정복 전쟁을 일으켰다.',
    '남부의 소국 카리온의 왕자 아레스는, 제넬 왕 암살을 시도하다 실패하고—',
    '이제 정면에서, 검으로 대륙의 운명을 되돌리려 한다.'
  ];

  return {
    TILE: TILE, UNITS: UNITS, SPECIALS: SPECIALS, REGIONS: REGIONS,
    START_ARMY: START_ARMY, INTRO: INTRO,
    UNIT_CAP: 36, LEGION_SIZE: 18
  };
})();
