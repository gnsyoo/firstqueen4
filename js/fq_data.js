/* =====================================================================
   퍼스트 퀸 IV 재현 목업 — 데이터 정의 (원작 고증판)
   (呉ソフトウェア工房 1994 「ファーストクイーンIV ~バルシア戦記~」 팬 오마주)

   원작 고증 요소
   - 무대: 로그리스 대륙 / 마법대국 바르시아(제넬루 왕, 참모 자닐=가로아)
   - 주인공: 카리온의 젊은 왕 아레스(암살 실패→투옥→의문의 마법사가 구출)
   - 아군: 애레인(닌자 부대)·카이·라딘칼·얀후레트(아이라 여왕의 아들)·카라·
           니먼(물의 요정왕)·바르톰(바람의 정령왕)·크로비(동마시아 왕자)
   - 사천왕: 오그(불·벨더성·용·약점 꼬리) / 맥가이어(흙·리스레이성·골렘) /
             몰드레드(물·모로시아성·물뱀·바람에 약함) / 스리후트(바람·에드윈성)
   - 소환: 사라만다(아레스)·용(카라)·실프(바르톰)·운디네(니먼)
   - 능력치: AT/DF + AR/DR, 피로도(FT), 리더십(부대 인원수)
   ※ 대사는 원작 전개를 따라 새로 쓴 창작 텍스트입니다.
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

  /* ---------- 타일 정의 ---------- */
  var TILE = {
    '.': { name: '풀밭', walk: true,  spd: 1.0 },
    'g': { name: '초원', walk: true,  spd: 1.0 },
    'd': { name: '흙',   walk: true,  spd: 1.0 },
    'r': { name: '가도', walk: true,  spd: 1.2 },
    'b': { name: '다리', walk: true,  spd: 1.1 },
    'f': { name: '숲',   walk: true,  spd: 0.62 },
    't': { name: '거목', walk: false, spd: 0 },
    'w': { name: '물',   walk: false, spd: 0 },
    'm': { name: '산',   walk: false, spd: 0 },
    'h': { name: '언덕', walk: true,  spd: 0.7 },
    'x': { name: '바위', walk: false, spd: 0 },
    'S': { name: '설원', walk: true,  spd: 0.8 },
    'W': { name: '성벽', walk: false, spd: 0 },
    'F': { name: '석재', walk: true,  spd: 1.05 },
    'c': { name: '융단', walk: true,  spd: 1.05 },
    's': { name: '모래', walk: true,  spd: 0.9 }
  };

  /* ---------- 맵 빌더 ---------- */
  function Grid(w, h, fill) {
    var g = [];
    for (var y = 0; y < h; y++) g.push(new Array(w).fill(fill));
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
  // 성(마당+성벽+성문+융단) 공통 골격
  function castle(M, opts) {
    var cx = opts.cx, top = opts.top, w = opts.w, h = opts.h;
    var x0 = Math.round(cx - w / 2);
    rect(M, 'F', x0, top, w, h);
    rect(M, 'W', x0 - 1, top - 1, w + 2, 1);
    rect(M, 'W', x0 - 1, top - 1, 1, h + 2);
    rect(M, 'W', x0 + w, top - 1, 1, h + 2);
    rect(M, 'W', x0 - 1, top + h, w + 2, 1);
    rect(M, 'r', cx - 2, top + h, 4, 1);
    if (opts.carpet !== false) rect(M, 'c', cx - 2, top + 1, 4, h - 1);
    if (opts.inner) {
      rect(M, 'W', x0 + 3, top + Math.floor(h / 2), 4, 1);
      rect(M, 'W', x0 + w - 7, top + Math.floor(h / 2), 4, 1);
    }
  }
  function toStrings(M) { return M.g.map(function (row) { return row.join(''); }); }

  /* ===== 1. 바르시아 국경 요새 ===== */
  function mapBorderFort() {
    var rnd = mulberry32(41), M = Grid(46, 34, '.');
    scatter(M, 'g', 240, rnd, ['.']);
    blob(M, 'f', 7, 8, 5, rnd); blob(M, 'f', 39, 7, 4, rnd);
    blob(M, 'f', 6, 25, 4, rnd); blob(M, 'f', 40, 27, 5, rnd);
    windPath(M, 'r', 21, 3, rnd, 1, 32);
    castle(M, { cx: 23, top: 6, w: 18, h: 8, carpet: false });
    rect(M, 'd', 18, 27, 10, 5);                                 // 카리온군 야영지
    scatter(M, 't', 22, rnd, ['f']);
    scatter(M, 'x', 7, rnd, ['.', 'g']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 2. 벨더성 — 불의 장군 오그 ===== */
  function mapBelder() {
    var rnd = mulberry32(12), M = Grid(46, 34, '.');
    scatter(M, 'g', 200, rnd, ['.']);
    blob(M, 'h', 8, 8, 4, rnd); blob(M, 'h', 38, 10, 4, rnd);
    blob(M, 's', 12, 15, 4, rnd); blob(M, 's', 34, 19, 4, rnd);  // 불에 그을린 자국
    windPath(M, 'r', 21, 3, rnd, 19, 32);
    castle(M, { cx: 23, top: 4, w: 30, h: 13, inner: true });
    rect(M, 'W', 6, 18, 12, 2); rect(M, 'W', 28, 18, 12, 2);     // 외성벽
    scatter(M, 'x', 10, rnd, ['.', 'g', 's']);
    scatter(M, 't', 8, rnd, ['f', '.']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 3. 썬리스의 탑 — 거대한 갑옷기사 ===== */
  function mapSunless() {
    var rnd = mulberry32(88), M = Grid(42, 34, 'F');
    rect(M, 'W', 4, 4, 34, 1); rect(M, 'W', 4, 28, 34, 1);
    rect(M, 'W', 4, 4, 1, 25); rect(M, 'W', 37, 4, 1, 25);
    rect(M, 'F', 19, 28, 4, 1);                                  // 입구
    rect(M, 'W', 9, 9, 24, 1); rect(M, 'F', 27, 9, 3, 1);
    rect(M, 'W', 9, 9, 1, 15); rect(M, 'W', 32, 9, 1, 15);
    rect(M, 'W', 9, 23, 24, 1); rect(M, 'F', 12, 23, 3, 1);
    rect(M, 'W', 14, 13, 14, 1); rect(M, 'F', 15, 13, 3, 1);
    rect(M, 'W', 14, 13, 1, 7); rect(M, 'W', 27, 13, 1, 7);
    rect(M, 'W', 14, 19, 14, 1); rect(M, 'F', 24, 19, 3, 1);
    rect(M, 'c', 17, 14, 8, 4);                                  // 최상층 제단
    scatter(M, 'x', 8, rnd, ['F']);
    rect(M, '.', 1, 29, 40, 4);                                  // 탑 밖 풀밭
    rect(M, 'r', 19, 29, 4, 4);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 4. 리스레이성 — 흙의 장군 맥가이어 ===== */
  function mapLisley() {
    var rnd = mulberry32(55), M = Grid(46, 34, 'h');
    blob(M, 'd', 23, 26, 9, rnd); blob(M, 'd', 23, 12, 8, rnd);
    scatter(M, 'x', 30, rnd, ['h']);
    blob(M, 'm', 5, 6, 4, rnd); blob(M, 'm', 41, 7, 4, rnd);
    blob(M, 'm', 4, 28, 3, rnd); blob(M, 'm', 42, 27, 3, rnd);
    windPath(M, 'r', 21, 3, rnd, 16, 32);
    castle(M, { cx: 23, top: 4, w: 26, h: 11, inner: true, carpet: false });
    rect(M, 'd', 21, 5, 6, 9);                                   // 골렘 공방(흙바닥)
    border(M, 'm');
    return toStrings(M);
  }

  /* ===== 5. 링커 마을 — 자경단과의 공동 전선 ===== */
  function mapLinker() {
    var rnd = mulberry32(29), M = Grid(46, 34, '.');
    scatter(M, 'g', 260, rnd, ['.']);
    rect(M, 's', 4, 22, 10, 6); rect(M, 's', 33, 23, 9, 5);      // 밭
    windPath(M, 'r', 21, 3, rnd, 1, 32);
    rect(M, 'r', 6, 15, 34, 2);                                  // 마을 십자로
    [[8, 9], [15, 8], [28, 8], [35, 10], [9, 19], [34, 18], [16, 20], [27, 20]].forEach(function (p) {
      rect(M, 'W', p[0], p[1], 3, 2);                            // 민가
    });
    blob(M, 'f', 5, 4, 3, rnd); blob(M, 'f', 41, 4, 3, rnd);
    blob(M, 'w', 41, 30, 3, rnd);                                // 연못
    scatter(M, 't', 10, rnd, ['f', '.']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 6. 모로시아성 — 물의 장군 몰드레드 ===== */
  function mapMorosia() {
    var rnd = mulberry32(7), M = Grid(46, 34, '.');
    scatter(M, 'g', 180, rnd, ['.']);
    var yb = 16;                                                 // 해자
    for (var x = 0; x < 46; x++) {
      var yy = yb + Math.round(Math.sin(x * 0.3) * 1.4);
      rect(M, 'w', x, yy, 1, 4);
    }
    rect(M, 'b', 21, 14, 4, 8);                                  // 중앙 다리
    rect(M, 'b', 38, 15, 3, 6);                                  // 동쪽 낡은 다리
    castle(M, { cx: 23, top: 3, w: 28, h: 10, inner: true });
    blob(M, 'w', 8, 8, 3, rnd); blob(M, 'w', 40, 27, 3, rnd);    // 늪
    windPath(M, 'r', 21, 3, rnd, 23, 32);
    blob(M, 'f', 6, 28, 4, rnd); blob(M, 'f', 40, 30, 3, rnd);
    scatter(M, 't', 14, rnd, ['f']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 7. 동마시아성 — 크로비 왕자 ===== */
  function mapDongmasia() {
    var rnd = mulberry32(63), M = Grid(46, 34, '.');
    scatter(M, 'g', 200, rnd, ['.']);
    windPath(M, 'r', 21, 3, rnd, 20, 32);
    rect(M, 'W', 5, 18, 36, 1); rect(M, 'r', 21, 18, 4, 1);      // 외벽+성문
    rect(M, 'F', 6, 5, 34, 13);                                  // 시가지
    [[9, 13], [16, 13], [27, 13], [33, 13], [9, 8], [33, 8]].forEach(function (p) {
      rect(M, 'W', p[0], p[1], 4, 2);                            // 시가 건물
    });
    castle(M, { cx: 23, top: 3, w: 14, h: 8 });                  // 내성(왕궁)
    rect(M, 'W', 5, 4, 1, 15); rect(M, 'W', 40, 4, 1, 15);
    rect(M, 'W', 5, 4, 36, 1);
    blob(M, 'f', 6, 27, 4, rnd); blob(M, 'f', 40, 28, 4, rnd);
    scatter(M, 't', 10, rnd, ['f']);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 8. 에드윈성 — 바람의 장군 스리후트와 뱀파이어 ===== */
  function mapEdwin() {
    var rnd = mulberry32(93), M = Grid(46, 34, 'g');
    scatter(M, '.', 160, rnd, ['g']);
    blob(M, 'f', 7, 9, 5, rnd); blob(M, 'f', 39, 8, 5, rnd);
    blob(M, 'f', 6, 26, 4, rnd); blob(M, 'f', 41, 27, 4, rnd);
    scatter(M, 't', 30, rnd, ['f', 'g']);                        // 어두운 숲
    windPath(M, 'd', 21, 2, rnd, 19, 32);
    castle(M, { cx: 23, top: 4, w: 26, h: 12, inner: true });
    scatter(M, 'x', 14, rnd, ['g', '.']);                        // 묘비처럼 선 바위들
    blob(M, 'w', 40, 19, 2, rnd);
    border(M, 't');
    return toStrings(M);
  }

  /* ===== 9. 바르시아 왕성 — 제넬루 → 가로아 ===== */
  function mapCapital() {
    var rnd = mulberry32(3), M = Grid(46, 36, 'F');
    rect(M, '.', 0, 28, 46, 8);
    scatter(M, 'g', 40, rnd, ['.']);
    rect(M, 'W', 4, 26, 38, 2); rect(M, 'r', 21, 26, 4, 2);
    rect(M, 'r', 21, 28, 4, 8);
    rect(M, 'W', 4, 4, 1, 24); rect(M, 'W', 41, 4, 1, 24);
    rect(M, 'W', 4, 4, 38, 1);
    rect(M, 'c', 20, 5, 6, 21);
    rect(M, 'W', 10, 12, 6, 2); rect(M, 'W', 30, 12, 6, 2);
    rect(M, 'W', 10, 20, 6, 2); rect(M, 'W', 30, 20, 6, 2);
    rect(M, 'c', 17, 5, 12, 4);                                  // 옥좌의 단
    rect(M, 'W', 17, 4, 12, 1);
    border(M, 'W');
    rect(M, '.', 0, 34, 46, 2); rect(M, 'r', 21, 34, 4, 2);
    return toStrings(M);
  }

  /* ---------- 병종/캐릭터 ----------
     ldr: 리더십 — 부대장일 때 이끌 수 있는 인원 = min(18, ldr×1.5) (원작 재현)
     hero: 네임드(전사 시 영구 이탈)  fly: 비행  big: 거대 유닛  kind: 거대 유닛 외형
     special / specialUp: 기본 특수능력 / 조건(flag) 충족 시 교체되는 특수능력   */
  var UNITS = {
    /* ═══ 카리온 해방군(아군 영웅) ═══ */
    ares: { name: '아레스', cls: '카리온의 왕', hero: true, team: 0, weapon: 'sword', ldr: 8,
      hp: 200, at: 21, df: 13, ar: 108, dr: 90, spd: 100, r: 9,
      special: 'fireball', specialUp: { flag: 'salamander', special: 'sumSalamander' },
      color: '#e0483e', trim: '#f7d774',
      bio: '카리온의 젊은 왕. 제넬루 암살에 실패해 투옥됐으나 의문의 마법사에게 구출됐다. 검과 마법을 함께 쓰지만 큰 부대를 이끄는 재능은 없다(리더십 낮음). 몰드레드를 쓰러뜨리면 불의 정령 사라만다를 소환할 수 있다.' },
    elaine: { name: '애레인', cls: '닌자 부대장', hero: true, team: 0, weapon: 'dagger', ldr: 10,
      hp: 135, at: 16, df: 8, ar: 122, dr: 96, spd: 128, r: 8,
      special: 'shuriken', color: '#7f5bd6', trim: '#e8c8ff',
      bio: '아레스의 연인. 돌아오지 않는 아레스를 찾아 닌자들을 이끌고 바르시아 곳곳을 들쑤시고 다녔다.' },
    kai: { name: '카이', cls: '닌자', hero: true, team: 0, weapon: 'dagger', ldr: 7,
      hp: 110, at: 15, df: 6, ar: 118, dr: 94, spd: 126, r: 7,
      special: 'shuriken', color: '#5d6bb0', trim: '#c2cdf2',
      bio: '애레인 부대의 닌자. 동마시아성 왕궁에서 부대와 떨어져 홀로 낙오해 있었다.' },
    radincal: { name: '라딘칼', cls: '기사단장', hero: true, team: 0, weapon: 'sword', ldr: 12,
      hp: 170, at: 18, df: 12, ar: 104, dr: 84, spd: 96, r: 9,
      special: 'spinSlash', color: '#3f6fd8', trim: '#cfd8ea',
      bio: '아이라 여왕이 보낸 지원군의 기사단장. 리더십 12 — 가장 많은 병사를 이끌 수 있는, 초반 주력 부대의 믿음직한 부대장.' },
    yanhuret: { name: '얀후레트', cls: '아이라의 아들', hero: true, team: 0, weapon: 'sword', ldr: 6,
      hp: 100, at: 12, df: 8, ar: 94, dr: 78, spd: 94, r: 8,
      special: 'rally', color: '#4c9a6a', trim: '#cfe8d6',
      bio: '가이아 대륙의 영웅 아이라 여왕의 아들. 어머니의 이름값에는 아직 미치지 못하지만, 그의 함성은 지친 병사들을 다시 일으켜 세운다.' },
    kara: { name: '카라', cls: '소환술사', hero: true, team: 0, weapon: 'staff', ldr: 7,
      hp: 105, at: 14, df: 5, ar: 102, dr: 72, spd: 86, r: 7, range: 190, bolt: true,
      special: 'sumDragon', color: '#b0567a', trim: '#f0c8d8',
      bio: '지원군과 함께 온 소환술사. 그녀가 부르는 용은 사라만다에 버금가는 든든한 방패다.' },
    nieman: { name: '니먼', cls: '물의 요정왕', hero: true, team: 0, weapon: 'staff', ldr: 8,
      hp: 230, at: 15, df: 10, ar: 100, dr: 108, spd: 88, r: 9, range: 180, bolt: true,
      special: 'waterHeal', specialUp: { flag: 'undine', special: 'sumUndine' },
      color: '#3d8fbe', trim: '#c8e8f5',
      bio: '물의 요정왕. 벨더성이 해방되자 카리온군에 힘을 보탰다. 방어율이 대단히 높고 생명력도 깊다. 에드윈성에 갇힌 정령 운디네를 해방하면 소환할 수 있다.' },
    barthom: { name: '바르톰', cls: '바람의 정령왕', hero: true, team: 0, weapon: 'hammer', ldr: 8,
      hp: 260, at: 20, df: 14, ar: 102, dr: 112, spd: 84, r: 11,
      special: 'gale', specialUp: { flag: 'sylph', special: 'sumSylph' },
      color: '#43a06c', trim: '#c8ecd6',
      bio: '바람의 정령왕. 자닐의 술법에 사로잡혀 썬리스의 탑 최상층에서 거대한 갑옷기사가 되어 있었다. 리스레이가 해방되면 바람의 정령 실프를 소환한다.' },
    krovi: { name: '크로비', cls: '동마시아의 왕자', hero: true, team: 0, weapon: 'spear', ldr: 9,
      hp: 150, at: 16, df: 11, ar: 100, dr: 86, spd: 92, r: 9, reach: 16,
      special: 'spinSlash', color: '#c08a3a', trim: '#f0dcb0',
      bio: '바르시아에 복속됐던 동마시아의 왕자. 아레스의 설득에 항복하고 중갑보병들과 함께 해방군에 합류했다.' },

    /* --- 카리온 병사 --- */
    knight: { name: '기사', cls: '카리온 기사단', team: 0, weapon: 'sword',
      hp: 120, at: 14, df: 11, ar: 96, dr: 78, spd: 88, r: 9, color: '#3f6fd8', trim: '#cfd8ea' },
    heavy: { name: '중갑보병', cls: '동마시아 정예', team: 0, weapon: 'axe',
      hp: 145, at: 15, df: 14, ar: 92, dr: 74, spd: 74, r: 10, color: '#8a6d3f', trim: '#e0cba0' },
    sword: { name: '검병', cls: '카리온 보병', team: 0, weapon: 'sword',
      hp: 85, at: 12, df: 7, ar: 92, dr: 66, spd: 94, r: 8, color: '#4c86c8', trim: '#a9c6e2' },
    spear: { name: '창병', cls: '카리온 창병', team: 0, weapon: 'spear',
      hp: 90, at: 13, df: 8, ar: 90, dr: 70, spd: 90, r: 8, reach: 16, color: '#3e9d8e', trim: '#bfe5dd' },
    archer: { name: '궁수', cls: '카리온 궁수대', team: 0, weapon: 'bow',
      hp: 62, at: 11, df: 4, ar: 98, dr: 58, spd: 92, r: 7, range: 175, color: '#7d9c4a', trim: '#dce8b8' },
    mageA: { name: '마법사', cls: '카리온 마법대', team: 0, weapon: 'staff',
      hp: 60, at: 15, df: 4, ar: 100, dr: 60, spd: 82, r: 7, range: 200, bolt: true, color: '#7a5ac8', trim: '#d8c8f5' },
    ninja: { name: '닌자', cls: '애레인 직속', team: 0, weapon: 'dagger',
      hp: 72, at: 13, df: 5, ar: 112, dr: 84, spd: 122, r: 7, color: '#6b56b8', trim: '#c9baf0' },
    militia: { name: '자경단원', cls: '링커 마을 자경단', team: 0, weapon: 'spear', temp: true,
      hp: 70, at: 11, df: 6, ar: 88, dr: 62, spd: 90, r: 8, color: '#9a8a4a', trim: '#e8dcae' },

    /* ═══ 소환수(전투 중 소환·비영속) ═══ */
    salamander: { name: '사라만다', cls: '불의 정령', summon: true, weapon: 'claw', big: true, kind: 'salamander',
      hp: 320, at: 30, df: 14, ar: 112, dr: 88, spd: 96, r: 14, color: '#e86a30', trim: '#ffd27a' },
    dragon: { name: '용', cls: '카라의 소환수', summon: true, weapon: 'claw', big: true, kind: 'dragon',
      hp: 290, at: 26, df: 15, ar: 106, dr: 84, spd: 88, r: 15, color: '#7a4ab0', trim: '#e0c8ff' },
    sylph: { name: '실프', cls: '바람의 정령', summon: true, fly: true, weapon: 'claw', kind: 'sylph',
      hp: 190, at: 22, df: 8, ar: 120, dr: 104, spd: 150, r: 10, color: '#6fe0a0', trim: '#eafff2' },
    undine: { name: '운디네', cls: '물의 정령', summon: true, fly: true, weapon: 'claw', kind: 'undine', healAura: true,
      hp: 210, at: 18, df: 10, ar: 108, dr: 100, spd: 120, r: 10, color: '#5ab4ff', trim: '#e0f4ff' },

    /* ═══ 바르시아군(적) ═══ */
    puppet: { name: '인형병사', cls: '자닐의 마법 인형', team: 1, weapon: 'sword', doll: true,
      hp: 58, at: 10, df: 5, ar: 86, dr: 55, spd: 84, r: 8, color: '#9d8d76', trim: '#5d5142' },
    puppetH: { name: '중장인형', cls: '자닐의 마법 인형', team: 1, weapon: 'axe', doll: true,
      hp: 135, at: 15, df: 12, ar: 84, dr: 62, spd: 66, r: 10, color: '#8a7a63', trim: '#3f382d' },
    bsword: { name: '바르시아 검병', cls: '바르시아 정규군', team: 1, weapon: 'sword',
      hp: 88, at: 12, df: 8, ar: 92, dr: 68, spd: 92, r: 8, color: '#b4485a', trim: '#e6b8c0' },
    bspear: { name: '바르시아 창병', cls: '바르시아 정규군', team: 1, weapon: 'spear',
      hp: 92, at: 13, df: 9, ar: 90, dr: 70, spd: 88, r: 8, reach: 16, color: '#a84472', trim: '#e2bad0' },
    barcher: { name: '바르시아 궁병', cls: '바르시아 정규군', team: 1, weapon: 'bow',
      hp: 60, at: 11, df: 4, ar: 96, dr: 56, spd: 90, r: 7, range: 175, color: '#c06a4e', trim: '#ecd0c2' },
    bmage: { name: '마도병', cls: '바르시아 마도군', team: 1, weapon: 'staff',
      hp: 66, at: 15, df: 4, ar: 100, dr: 60, spd: 80, r: 7, range: 205, bolt: true, color: '#8d55c8', trim: '#e3cdf5' },
    golemS: { name: '돌 골렘', cls: '맥가이어의 피조물', team: 1, weapon: 'claw', doll: true, magicWeak: true,
      hp: 160, at: 17, df: 15, ar: 82, dr: 58, spd: 58, r: 11, color: '#8d8478', trim: '#4f4a40' },
    snake: { name: '물뱀', cls: '몰드레드의 권속', team: 1, weapon: 'claw', waterMove: true,
      hp: 95, at: 14, df: 7, ar: 96, dr: 72, spd: 104, r: 9, color: '#4a8aa0', trim: '#b8e2ee' },

    /* ═══ 바르시아 사천왕과 수뇌 ═══ */
    og: { name: '오그', cls: '불의 장군', hero: true, boss: true, team: 1, weapon: 'claw',
      hp: 520, at: 24, df: 15, ar: 106, dr: 86, spd: 82, r: 17, big: true, kind: 'dragon', weakTail: true,
      special: 'fireball', color: '#c8502e', trim: '#f5c9a8',
      bio: '바르시아 사천왕, 불의 장군. 벨더성에서 거대한 용의 모습으로 싸운다. 약점은 꼬리 — 등 뒤에서 공격하면 큰 피해를 준다.' },
    mcguire: { name: '맥가이어', cls: '흙의 장군', hero: true, boss: true, team: 1, weapon: 'claw',
      hp: 600, at: 26, df: 20, ar: 100, dr: 84, spd: 62, r: 18, big: true, kind: 'golem',
      special: 'quake', gaze: true, summoner: 'golemS',
      color: '#96703c', trim: '#e6d2ac',
      bio: '바르시아 사천왕, 흙의 장군. 리스레이성의 강철 골렘. 지진과 석화의 눈빛, 골렘 소환까지 부리는 난적. 부하 골렘들은 마법에 약하다.' },
    mordred: { name: '몰드레드', cls: '물의 장군', hero: true, boss: true, team: 1, weapon: 'claw',
      hp: 560, at: 25, df: 14, ar: 108, dr: 92, spd: 96, r: 16, big: true, kind: 'serpent', weakWind: true, waterMove: true,
      special: 'waterBurst', color: '#3d7fbe', trim: '#bfe0f5',
      bio: '바르시아 사천왕, 물의 장군. 모로시아성의 해자를 헤엄치는 거대한 물뱀. 바람의 정령에게 약하다. 그를 쓰러뜨리면 아레스 안의 「불」이 눈을 뜬다.' },
    srihut: { name: '스리후트', cls: '바람의 장군', hero: true, boss: true, team: 1, weapon: 'dagger',
      hp: 480, at: 23, df: 11, ar: 124, dr: 102, spd: 140, r: 11,
      special: 'galeDash', color: '#43a06c', trim: '#c8ecd6',
      bio: '바르시아 사천왕, 바람의 장군. 에드윈성의 주인. 바람처럼 나타나 바람처럼 사라진다.' },
    vampire: { name: '뱀파이어', cls: '스리후트의 부하', hero: true, boss: true, team: 1, weapon: 'claw',
      hp: 380, at: 22, df: 10, ar: 116, dr: 96, spd: 118, r: 11, lifesteal: true, kind: 'vampire', fly: true,
      special: 'darkWave', color: '#6a3a5a', trim: '#e0b8d0',
      bio: '에드윈성에 사는 흡혈귀. 물의 정령 운디네를 가두고 있다. 그를 쓰러뜨리면 운디네가 해방된다.' },
    guardian: { name: '갑옷기사', cls: '탑의 수호자', hero: true, boss: true, team: 1, weapon: 'hammer',
      hp: 550, at: 26, df: 18, ar: 104, dr: 108, spd: 70, r: 16, big: true, kind: 'armor',
      special: 'quake', color: '#5a6a7a', trim: '#c8d8e8',
      bio: '썬리스의 탑 최상층을 지키는 거대한 갑옷기사. 그 정체는 자닐의 술법에 사로잡힌 바람의 정령왕 바르톰—.' },
    kroviE: { name: '크로비', cls: '동마시아의 왕자', hero: true, boss: true, team: 1, weapon: 'spear',
      hp: 300, at: 18, df: 12, ar: 102, dr: 88, spd: 92, r: 10, reach: 16, surrender: 0.35,
      special: 'spinSlash', color: '#c08a3a', trim: '#f0dcb0',
      bio: '바르시아의 위세에 눌려 복속한 동마시아의 왕자. 싸울 뜻은 없어 보인다 — 몰아붙이면 항복할지도 모른다.' },
    zenelu: { name: '제넬루 왕', cls: '바르시아 국왕', hero: true, boss: true, team: 1, weapon: 'sword',
      hp: 650, at: 27, df: 16, ar: 112, dr: 94, spd: 96, r: 12,
      special: 'lightning', color: '#b8973f', trim: '#f3e6b8',
      bio: '모든 왕과 영주를 대표하던 바르시아의 현왕. 참모 자닐을 맞아들인 뒤 사람이 변해 폭정을 휘두른다.' },
    garoa: { name: '가로아', cls: '어둠의 마도사', hero: true, boss: true, team: 1, weapon: 'staff',
      hp: 880, at: 31, df: 15, ar: 118, dr: 98, spd: 90, r: 16, big: true, kind: 'demon', range: 230, bolt: true,
      special: 'darkWave', summoner: 'puppet',
      color: '#5a3d8f', trim: '#cdb3f0',
      bio: '참모 「자닐」의 정체. 제넬루를 조종해 대륙을 어둠에 빠뜨린 원흉이자, 퍼스트 퀸 시리즈를 관통하는 숙적.' }
  };

  /* ---------- 특수능력(스페이스) ---------- */
  var SPECIALS = {
    fireball:    { name: '화염구',       desc: '불꽃을 터뜨린다',           cd: 8,  ft: 20, radius: 105, mult: 2.4, fx: 'fire' },
    shuriken:    { name: '수리검 난무',   desc: '8방향 수리검 투척',         cd: 6,  ft: 14, mult: 1.5, fx: 'shuriken' },
    spinSlash:   { name: '회전참',       desc: '주위를 휩쓰는 회전 베기',    cd: 7,  ft: 18, radius: 85,  mult: 2.0, fx: 'wind' },
    rally:       { name: '함성',         desc: '주위 아군의 피로를 씻는다',  cd: 12, ft: 0,  radius: 130, fx: 'rally', ally: 'ft' },
    waterHeal:   { name: '물의 축복',     desc: '주위 아군을 치유한다',      cd: 11, ft: 15, radius: 120, fx: 'water', ally: 'heal', amount: 45 },
    gale:        { name: '회오리',       desc: '바람의 충격파',             cd: 8,  ft: 15, radius: 115, mult: 2.2, fx: 'wind' },
    quake:       { name: '대지진동',     desc: '대지를 내리쳐 광역 강타',    cd: 10, ft: 0,  radius: 140, mult: 2.3, fx: 'earth' },
    waterBurst:  { name: '수류탄파',     desc: '물의 충격파',               cd: 9,  ft: 0,  radius: 120, mult: 2.2, fx: 'water' },
    galeDash:    { name: '질풍참',       desc: '바람의 연속 베기',           cd: 7,  ft: 0,  radius: 95,  mult: 2.1, fx: 'wind' },
    lightning:   { name: '뇌격',         desc: '번개로 광역 타격',           cd: 9,  ft: 0,  radius: 130, mult: 2.5, fx: 'bolt' },
    darkWave:    { name: '암흑파동',     desc: '어둠의 파동',               cd: 8,  ft: 0,  radius: 150, mult: 2.5, fx: 'dark' },
    stoneGaze:   { name: '석화의 눈빛',   desc: '주위의 적을 돌로 굳힌다',    cd: 13, ft: 0,  radius: 120, fx: 'earth', petrify: 2.6 },
    /* 소환 */
    sumSalamander: { name: '사라만다 소환', desc: '불의 정령을 부른다',   cd: 26, ft: 30, summon: 'salamander', fx: 'fire' },
    sumDragon:     { name: '용 소환',       desc: '용을 부른다',         cd: 26, ft: 28, summon: 'dragon',     fx: 'dark' },
    sumSylph:      { name: '실프 소환',     desc: '바람의 정령을 부른다', cd: 24, ft: 24, summon: 'sylph',      fx: 'wind' },
    sumUndine:     { name: '운디네 소환',   desc: '물의 정령을 부른다',   cd: 24, ft: 24, summon: 'undine',     fx: 'water' }
  };

  /* ---------- 아이템 ---------- */
  var ITEMS = {
    stone:  { name: '파괴의 돌', desc: '주위의 적을 통째로 날려버리는 마법의 돌', emoji: '💥' },
    potion: { name: '회복약',   desc: '조작 중인 부대원의 상처를 치유한다',     emoji: '🧪' }
  };

  /* ---------- 로그리스 대륙 — 지역 ---------- */
  var REGIONS = [
    {
      id: 0, key: 'carion', name: '카리온성', owner: 0, hq: true,
      x: 430, y: 520, adj: [1],
      desc: '남부의 소국 카리온. 탈옥한 아레스가 돌아와 반(反)바르시아의 기치를 올린 해방군의 본거지.'
    },
    {
      id: 1, key: 'fort', name: '바르시아 국경 요새', owner: 1,
      x: 430, y: 445, adj: [0, 2], map: mapBorderFort, lvl: 1,
      desc: '카리온을 겨누는 바르시아의 전초기지. 인형병사 선봉대가 주둔 중이다. 지도상으론 벨더성으로 직행할 수 있어 보이지만, 실제로는 반드시 이 요새를 거쳐야 한다.',
      garrison: [['puppet', 10, 1], ['bsword', 4, 1], ['bspear', 3, 1]],
      waves: [{ at: 'half', from: 'N', units: [['puppet', 6, 1]], msg: '요새 안쪽에서 인형병사 지원대가 쏟아져 나온다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { heroes: ['elaine'], units: [['ninja', 4, 1], ['sword', 2, 1]], items: { potion: 1 } },
      storyBefore: [
        '【라딘칼】 국경 요새입니다. 저곳을 넘지 못하면 바르시아 본토는 꿈도 못 꿉니다.',
        '【아레스】 감옥에서 보낸 나날의 빚, 여기서부터 갚아 주지. — 전군, 진격!'
      ],
      storyAfter: [
        '요새를 지키던 인형병사들이 나무 조각처럼 부서져 흩어졌다.',
        '【아레스】 이것이 자닐의 「인형병사」…… 사람이 아니라서 오히려 소름이 돋는군.',
        '그때, 검은 옷의 무리가 요새 그늘에서 스르륵 나타났다.',
        '【애레인】 ……겨우 찾았어요. 감옥에서 사라졌다길래, 바르시아를 통째로 뒤집고 다녔잖아요.',
        '【아레스】 애레인! …미안하다. 그리고 고맙다. 네 닌자들이라면 백만 원군보다 든든하지.',
        '★ 애레인과 닌자 부대가 합류했다!'
      ]
    },
    {
      id: 2, key: 'belder', name: '벨더성', owner: 1,
      x: 300, y: 375, adj: [1, 3, 4], map: mapBelder, lvl: 2,
      desc: '남서부의 견성. 불의 장군 오그가 거대한 용의 모습으로 지킨다. 용의 약점은 꼬리 — 등 뒤를 노려라.',
      garrison: [['bsword', 5, 2], ['bspear', 5, 2], ['barcher', 4, 2], ['puppet', 6, 2]],
      boss: ['og', 3],
      waves: [{ at: 'boss', from: 'C', units: [['puppet', 7, 2]], msg: '오그가 포효하자 성 안쪽에서 인형병사가 몰려나온다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { heroes: ['nieman'], units: [['mageA', 2, 2], ['archer', 2, 2]], items: { potion: 1 } },
      storyBefore: [
        '【척후】 성벽 위에…… 요, 용입니다! 불의 장군 오그가 용의 모습으로 나타났습니다!',
        '【오그】 크하하! 잘 왔다, 카리온의 애송이! 내 불꽃에 뼈까지 녹여 주마!',
        '【라딘칼】 정면은 불벼락입니다. 발 빠른 자로 등 뒤 — 꼬리를 노리십시오!'
      ],
      storyAfter: [
        '【오그】 이…… 꼬리가…… 크아아아!! (거대한 몸이 무너져 내린다)',
        '불길이 잦아든 성문 앞에, 물빛 옷자락의 남자가 조용히 서 있었다.',
        '【니먼】 물의 요정왕 니먼이라 하오. 정령들을 가두는 자닐의 술법, 더는 두고 볼 수 없소.',
        '★ 물의 요정왕 니먼이 합류했다! (그의 정령 운디네는 어딘가에 붙잡혀 있다……)'
      ]
    },
    {
      id: 3, key: 'sunless', name: '썬리스의 탑', owner: 1, optional: true,
      x: 560, y: 360, adj: [2, 4], map: mapSunless, lvl: 3, tint: 'rgba(20,16,50,0.28)',
      desc: '(우회 가능) 고탑의 최상층에 거대한 갑옷기사가 배회한다는 소문. 그 정체는 자닐의 술법에 사로잡힌 「무언가」라고 하는데…….',
      garrison: [['puppet', 8, 3], ['puppetH', 4, 3], ['bmage', 3, 3]],
      boss: ['guardian', 4],
      waves: [],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { heroes: ['barthom'], items: { potion: 1 } },
      storyBefore: [
        '【애레인】 탑 전체가 이상한 바람으로 울고 있어요…… 위층으로 갈수록 강해져요.',
        '【???】 …………떠나라…… 이곳에…… 오지…… 마라…….'
      ],
      storyAfter: [
        '갑옷이 깨져 흩어지자, 그 안에서 초록빛 바람이 사람의 형상을 이뤘다.',
        '【바르톰】 …고맙다. 나는 바람의 정령왕 바르톰. 자닐의 술법에 사로잡혀 탑의 파수꾼이 되어 있었다.',
        '【바르톰】 이 빚은 검으로 갚지. 다만 실프를 부르려면, 리스레이를 덮은 흙의 술법부터 걷어내야 한다.',
        '★ 바람의 정령왕 바르톰이 합류했다!'
      ]
    },
    {
      id: 4, key: 'lisley', name: '리스레이성', owner: 1,
      x: 430, y: 305, adj: [2, 3, 5], map: mapLisley, lvl: 4,
      desc: '바위 황무지의 성. 흙의 장군 맥가이어가 강철 골렘의 몸으로 군림한다. 지진·석화·골렘 소환을 쓰는 난적 — 다행히 부하 골렘들은 마법에 약하다.',
      garrison: [['golemS', 5, 4], ['puppetH', 4, 4], ['bspear', 5, 4], ['barcher', 4, 4]],
      boss: ['mcguire', 5],
      waves: [{ at: 'half', from: 'N', units: [['golemS', 3, 4]], msg: '성벽 뒤에서 새 골렘이 걸어 나온다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { units: [['mageA', 2, 4], ['knight', 2, 4]], flags: ['sylph'], items: { stone: 1 } },
      storyBefore: [
        '【니먼】 골렘에게 칼은 잘 듣지 않소. 마법사들을 아끼지 마시오 — 놈들은 마법에 약하니.',
        '【맥가이어】 침입자. 배제한다. (땅울림과 함께 강철의 거인이 몸을 일으킨다)'
      ],
      storyAfter: [
        '【맥가이어】 연산…… 불능…… 흙으로…… 돌아간다…….',
        '대지를 덮었던 흙의 술법이 걷히자, 바르톰의 몸에 초록빛 바람이 감돌기 시작했다.',
        '【바르톰】 …바람이 돌아왔다. 이제 실프를 부를 수 있다!',
        '★ (바르톰 합류 시) 특수능력이 「실프 소환」으로 바뀐다! 창고에서 「파괴의 돌」을 손에 넣었다!'
      ]
    },
    {
      id: 5, key: 'linker', name: '링커 마을', owner: 1,
      x: 330, y: 250, adj: [4, 6], map: mapLinker, lvl: 5,
      desc: '모로시아로 가는 길목의 마을. 바르시아의 수탈에 맞서 자경단이 봉기했다 — 그들과 함께 마을을 되찾자.',
      garrison: [['bsword', 6, 5], ['bspear', 5, 5], ['barcher', 4, 5], ['puppet', 8, 5]],
      militia: [['militia', 6, 4]],
      waves: [{ at: 'half', from: 'N', units: [['puppet', 8, 5]], msg: '마을 북쪽 가도에서 바르시아 증원이 들이닥친다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { units: [['spear', 2, 5], ['archer', 2, 5]], items: { potion: 1 } },
      storyBefore: [
        '【자경단장】 카리온의 왕이시여! 우리도 싸우겠습니다 — 이 마을은 우리 손으로 지킵니다!',
        '【아레스】 좋다. 허나 무리는 마라. 그대들이 살아 있어야 마을도 사는 것이다.'
      ],
      storyAfter: [
        '마을에 남아 있던 바르시아 병사들이 무기를 버리고 달아났다.',
        '【자경단장】 모로시아로 가는 길은 우리가 열어 두겠습니다. 부디…… 물의 장군을 조심하십시오.',
        '해자에 잠긴 모로시아성으로 가는 길이 열렸다.'
      ]
    },
    {
      id: 6, key: 'morosia', name: '모로시아성', owner: 1,
      x: 430, y: 195, adj: [5, 7, 8], map: mapMorosia, lvl: 6,
      desc: '해자에 둘러싸인 물의 요새. 물의 장군 몰드레드가 거대한 물뱀의 모습으로 해자를 헤엄친다. 바람의 정령이 있다면 유리하다.',
      garrison: [['snake', 6, 6], ['bspear', 5, 6], ['barcher', 4, 6], ['bmage', 3, 6], ['puppet', 6, 6]],
      boss: ['mordred', 7],
      waves: [{ at: 'boss', from: 'C', units: [['snake', 4, 6]], msg: '해자의 수면이 끓어오르며 물뱀 떼가 기어오른다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { flags: ['salamander'], items: { potion: 1 } },
      storyBefore: [
        '【니먼】 해자의 물이 살아 있소. 다리 위에서 오래 버티지 마시오 — 아래에서 「그것」이 올라온다.',
        '【몰드레드】 …이 해자를 산 채로 건넌 자는 없다. 물거품이 되어라, 카리온의 왕이여.'
      ],
      storyAfter: [
        '【몰드레드】 이 몸이…… 마르다니…… 그 불꽃은…… 설마…….',
        '물뱀이 스러지는 순간, 아레스의 몸에서 진홍의 불길이 조용히 피어올랐다.',
        '【아레스】 …뜨겁지 않아. 이것이, 감옥에서 나를 꺼내 준 「그 힘」인가.',
        '★ 아레스의 특수능력이 「사라만다 소환」으로 바뀐다!'
      ]
    },
    {
      id: 7, key: 'dongmasia', name: '동마시아성', owner: 1, optional: true,
      x: 580, y: 215, adj: [6, 8], map: mapDongmasia, lvl: 6,
      desc: '(우회 가능) 바르시아에 복속된 성곽 도시. 성주 크로비 왕자는 싸울 뜻이 없어 보인다 — 몰아붙이면 항복할지도 모른다.',
      garrison: [['bsword', 6, 6], ['heavy', 3, 6], ['barcher', 4, 6], ['puppet', 6, 6]],
      boss: ['kroviE', 7],
      waves: [],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { heroes: ['krovi', 'kai'], units: [['heavy', 2, 6]], items: { potion: 1 } },
      storyBefore: [
        '【크로비】 …물러가 주지 않겠나, 카리온의 왕이여. 나는 백성을 전화(戰火)에 밀어 넣고 싶지 않다.',
        '【아레스】 그렇다면 그 창을 내려라. 바르시아의 사슬을 끊으면, 그대의 백성은 자유다.'
      ],
      storyAfter: [
        '【크로비】 …졌다. 아니, 처음부터 지고 싶었는지도 모르지. 동마시아는 그대와 함께 가겠다.',
        '왕궁 구석에서, 낯익은 검은 옷이 뛰쳐나와 애레인에게 매달렸다.',
        '【카이】 부대장님!! 얼마나 찾았는데요…… 성에 갇혀서 꼼짝도 못 했다고요!',
        '★ 크로비 왕자와 중갑보병, 그리고 낙오해 있던 닌자 카이가 합류했다!'
      ]
    },
    {
      id: 8, key: 'edwin', name: '에드윈성', owner: 1,
      x: 300, y: 150, adj: [6, 7, 9], map: mapEdwin, lvl: 8, tint: 'rgba(30,16,50,0.3)',
      desc: '해가 들지 않는 북서부의 고성. 바람의 장군 스리후트의 거성으로, 그 부하 뱀파이어가 물의 정령 운디네를 가두고 있다.',
      garrison: [['bsword', 5, 8], ['bmage', 4, 8], ['puppetH', 4, 8], ['barcher', 4, 8]],
      midBoss: ['vampire', 8],
      boss: ['srihut', 9],
      waves: [{ at: 'boss', from: 'C', units: [['puppet', 8, 8]], msg: '스리후트가 손을 들자 성 전체의 그림자가 일어선다!' }],
      allySpawn: 'S', enemySpawn: 'C',
      reward: { flags: ['undine'], items: { stone: 1 } },
      storyBefore: [
        '【니먼】 …느껴지오. 운디네가 이 성 어딘가에서 울고 있소. 부디, 부디 구해 주시오.',
        '【스리후트】 …왔군. 바람은 보이지 않아. 너희가 쓰러지는 그 순간까지도.'
      ],
      storyAfter: [
        '【스리후트】 …빠르군. 바람보다도…… (녹빛 바람이 되어 흩어진다)',
        '지하 뇌옥의 봉인이 풀리고, 푸른 물의 정령이 니먼의 곁으로 날아들었다.',
        '【니먼】 운디네…! 무사했구나. …고맙소, 카리온의 왕이여. 이 은혜는 전장에서 갚겠소.',
        '★ 니먼의 특수능력이 「운디네 소환」으로 바뀐다! 이제 남은 것은 바르시아 왕성뿐——'
      ]
    },
    {
      id: 9, key: 'capital', name: '바르시아 왕성', owner: 1, capital: true,
      x: 430, y: 55, adj: [8], map: mapCapital, lvl: 10,
      desc: '마법대국 바르시아의 심장. 옥좌에는 조종당하는 제넬루 왕이, 그 그림자에는 모든 어둠의 원흉 「자닐」이 도사리고 있다.',
      garrison: [['bsword', 6, 10], ['bspear', 5, 10], ['bmage', 5, 10], ['puppetH', 5, 10], ['barcher', 4, 10]],
      boss: ['zenelu', 11],
      boss2: {
        unit: ['garoa', 13], escorts: [['puppet', 8, 10], ['bmage', 3, 10]],
        msg: [
          '【제넬루 왕】 크윽…… 머리가…… 내가, 대체 무엇을…… 카리온의 왕이여…… 도망쳐라, 그 자는——',
          '【자닐】 다 쓴 인형은 조용히 하라. …그래. 「자닐」이라는 이름도 이제 필요 없지.',
          '검은 로브가 찢어지며, 그 안에서 어둠 그 자체가 일어섰다.',
          '【가로아】 내 이름은 가로아. 이 대륙도, 다음 대륙도, 역사조차도 — 전부 나의 것이 된다.',
          '자닐의 정체는 마도사 가로아! 로그리스의 운명을 건 마지막 전투다!'
        ]
      },
      waves: [],
      allySpawn: 'S', enemySpawn: 'C',
      reward: {},
      storyBefore: [
        '【바르톰】 왕성의 결계가 열려 있다…… 함정이라도 상관없다는 뜻이겠지.',
        '【아레스】 제넬루 왕을 베러 가는 게 아니다. 「되찾으러」 가는 거다. — 전군, 최후의 진격이다!'
      ],
      storyAfter: [
        '가로아의 육신이 어둠 속으로 무너져 내렸다. …그러나 그 웃음소리만은 바람 끝에 오래 남았다.',
        '【가로아】 …기억해 두어라. 어둠은 베어도 사라지지 않는다. 언젠가, 반드시——',
        '【제넬루 왕】 …모든 것이 내 약함 탓이다. 카리온의 왕이여, 이 대륙을 부탁한다.',
        '【아레스】 아니오. 함께 다시 세우는 겁니다. 사람의 손으로, 사람의 시간으로.',
        '이리하여 로그리스에 평화가 돌아왔다. 정령왕들은 각자의 자리로, 사람들은 저마다의 고향으로.',
        '…그리고 이 싸움의 기억은, 머나먼 훗날 「퍼스트 퀸」의 시대로 이어진다. — 完 —'
      ]
    }
  ];

  /* ---------- 시작 부대 ----------
     탈옥한 아레스 + 카리온군 + 아이라 여왕의 지원군(라딘칼·얀후레트·카라) */
  var START_ARMY = [
    ['ares', 1], ['radincal', 1], ['yanhuret', 1], ['kara', 1],
    ['knight', 1], ['knight', 1],
    ['sword', 1], ['sword', 1], ['sword', 1], ['sword', 1],
    ['spear', 1], ['spear', 1], ['spear', 1],
    ['archer', 1], ['archer', 1], ['archer', 1],
    ['mageA', 1]
  ];

  var START_ITEMS = { stone: 1, potion: 2 };

  var INTRO = [
    '― 가이아 대륙의 싸움으로부터 20년. 그리고 「퍼스트 퀸」의 시대로부터는 아득한 옛날. ―',
    '대륙 로그리스는, 중앙에서 북으로 넓은 땅을 가진 마법대국 바르시아를 중심으로 평화를 지켜왔다.',
    '그러나 현왕이라 불리던 제넬루는, 다른 대륙에서 온 마도사 「자닐」을 참모로 맞은 뒤 돌변한다.',
    '사람을 조종하고, 인형에 혼을 불어넣은 「인형병사」로 군비를 불린 바르시아는 마침내 대륙을 삼키기 시작했다.',
    '남부의 소국 카리온의 젊은 왕 아레스는 제넬루 암살을 시도하지만 — 실패하고 지하 뇌옥에 갇힌다.',
    '……그를 어둠 속에서 꺼내 준 것은, 정체 모를 마법사의 손길이었다.',
    '카리온으로 돌아온 아레스에게, 가이아의 영웅 아이라 여왕이 보낸 지원군이 당도한다.',
    '기사단장 라딘칼, 여왕의 아들 얀후레트, 소환술사 카라 — 이제, 카리온의 반격이 시작된다.'
  ];

  return {
    TILE: TILE, UNITS: UNITS, SPECIALS: SPECIALS, ITEMS: ITEMS, REGIONS: REGIONS,
    START_ARMY: START_ARMY, START_ITEMS: START_ITEMS, INTRO: INTRO,
    LEGION_MAX: 18
  };
})();
