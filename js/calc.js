// 狹縫干涉繞射實驗紀錄 — 計算函式（網頁與 Node 測試共用）
(function (root) {
  'use strict';
  var VISIBLE_MIN = 380, VISIBLE_MAX = 780;
  var DEFAULT_REF = { red: 650, green: 532 };
  var DEFAULT_LABEL = { red: '紅光', green: '綠光' };
  var DEFAULT_TOL = 2;

  function nodeConfig() {
    if (typeof require === 'function' && typeof module !== 'undefined') {
      try { return require('./config.js'); } catch (e) { return null; }
    }
    return null;
  }
  function getLaserRefs() {
    if (typeof LASER_REF !== 'undefined') return LASER_REF;
    var cfg = nodeConfig();
    return (cfg && cfg.LASER_REF) ? cfg.LASER_REF : DEFAULT_REF;
  }
  function getLaserLabels() {
    if (typeof LASER_LABEL !== 'undefined') return LASER_LABEL;
    var cfg = nodeConfig();
    return (cfg && cfg.LASER_LABEL) ? cfg.LASER_LABEL : DEFAULT_LABEL;
  }
  function getMatchTolPct() {
    if (typeof LAMBDA_MATCH_TOL_PCT === 'number') return LAMBDA_MATCH_TOL_PCT;
    var cfg = nodeConfig();
    return (cfg && typeof cfg.LAMBDA_MATCH_TOL_PCT === 'number') ? cfg.LAMBDA_MATCH_TOL_PCT : DEFAULT_TOL;
  }

  // 解析單一正數：回傳 {ok, value, error}
  function parsePositive(raw, label) {
    var s = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (s === '') return { ok: false, error: label + '：請填寫' };
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { ok: false, error: label + '：請輸入數字' };
    var v = Number(s);
    if (!isFinite(v)) return { ok: false, error: label + '：請輸入數字' };
    if (v === 0) return { ok: false, error: label + '：不能為 0' };
    if (v < 0) return { ok: false, error: label + '：不能為負數' };
    return { ok: true, value: v };
  }

  // 量了幾個間距 n：1 到 20 的正整數
  function parseCountN(raw) {
    var s = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (s === '') return { ok: false, error: '量了幾個間距 n：請填寫' };
    if (!/^\d+$/.test(s)) return { ok: false, error: '量了幾個間距 n：請輸入 1 到 20 的正整數' };
    var v = Number(s);
    if (v < 1 || v > 20) return { ok: false, error: '量了幾個間距 n：請輸入 1 到 20 的正整數' };
    return { ok: true, value: v };
  }

  function parseColor(raw) {
    var s = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (s === '') return { ok: false, error: '雷射顏色：請選擇' };
    if (s !== 'red' && s !== 'green') return { ok: false, error: '雷射顏色：請選擇紅光或綠光' };
    return { ok: true, value: s, label: getLaserLabels()[s], lambda0: getLaserRefs()[s] };
  }

  function errorPercent(lambda, lambda0) { return Math.abs(lambda - lambda0) / lambda0 * 100; }
  function warningFor(lambdaNm) {
    return (lambdaNm < VISIBLE_MIN || lambdaNm > VISIBLE_MAX) ? '請檢查單位或量測（λ 不在 380–780 nm）' : '';
  }

  // 去掉多餘的 0，方便代入學生的數字顯示
  function fmtSmart(v, maxDec) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    var s = n.toFixed(maxDec);
    if (s.indexOf('.') >= 0) s = s.replace(/\.?0+$/, '');
    return s;
  }

  function lambdaFromDouble(d, total, L, n) {
    var dy = total / n;
    var lambdaMm = d * dy / L;
    var lambdaNm = lambdaMm * 1e6;
    return { dy: dy, lambdaMm: lambdaMm, lambdaNm: lambdaNm };
  }
  function lambdaFromSingle(a, W, L) {
    var lambdaMm = a * W / (2 * L);
    var lambdaNm = lambdaMm * 1e6;
    return { lambdaMm: lambdaMm, lambdaNm: lambdaNm };
  }

  // 逐步算法（代入學生的量測值、含單位換算）。之後若要改成只顯示對錯，仍可重用這段。
  function stepsDouble(d, L, total, n, dy, lambdaMm, lambdaNm) {
    return [
      'n = ' + n + '（量了 ' + n + ' 個間距）',
      'Δy = 總長 ÷ n = ' + fmtSmart(total, 6) + ' ÷ ' + n + ' = ' + fmtSmart(dy, 6) + ' mm',
      'λ = d × Δy / L',
      '　= ' + fmtSmart(d, 6) + ' × ' + fmtSmart(dy, 6) + ' ÷ ' + fmtSmart(L, 6),
      '　= ' + fmtSmart(lambdaMm, 10) + ' mm',
      '單位換算：1 mm = 10⁶ nm = 1 000 000 nm',
      'λ = ' + fmtSmart(lambdaMm, 10) + ' × 1 000 000 = ' + Number(lambdaNm).toFixed(1) + ' nm'
    ];
  }
  function stepsSingle(a, L, W, lambdaMm, lambdaNm) {
    return [
      'λ = a × W / (2 × L)',
      '　= ' + fmtSmart(a, 6) + ' × ' + fmtSmart(W, 6) + ' ÷ (2 × ' + fmtSmart(L, 6) + ')',
      '　= ' + fmtSmart(lambdaMm, 10) + ' mm',
      '單位換算：1 mm = 10⁶ nm = 1 000 000 nm',
      'λ = ' + fmtSmart(lambdaMm, 10) + ' × 1 000 000 = ' + Number(lambdaNm).toFixed(1) + ' nm'
    ];
  }

  // 學生答案與正確值是否相符（相對誤差 ≤ 容許百分比，預設 2%）
  function matchStudentLambda(student, correct, tolPct) {
    var s = parsePositive(student, '你算出的波長');
    if (!s.ok) return s;
    if (!isFinite(correct) || correct === 0) return { ok: false, error: '正確波長無效，無法核對' };
    var tol = (tolPct === undefined || tolPct === null) ? getMatchTolPct() : Number(tolPct);
    var relPct = Math.abs(s.value - correct) / Math.abs(correct) * 100;
    return { ok: true, value: s.value, match: relPct <= tol, relPct: relPct, tolPct: tol };
  }

  function parseColorAndMeas(inp, kind) {
    var errors = [];
    var col = parseColor(inp && inp.color); if (!col.ok) errors.push(col.error);
    var d, a, L, T, W, n;
    L = parsePositive(inp && inp.L, '縫到屏距離 L'); if (!L.ok) errors.push(L.error);
    if (kind === 'double') {
      d = parsePositive(inp && inp.d, '縫間距 d'); if (!d.ok) errors.push(d.error);
      n = parseCountN(inp && inp.n); if (!n.ok) errors.push(n.error);
      T = parsePositive(inp && inp.total, '亮紋總長'); if (!T.ok) errors.push(T.error);
    } else {
      a = parsePositive(inp && inp.a, '縫寬 a'); if (!a.ok) errors.push(a.error);
      W = parsePositive(inp && inp.W, '中央亮紋寬度 W'); if (!W.ok) errors.push(W.error);
    }
    if (errors.length) return { ok: false, errors: errors };
    var out = { ok: true, color: col.value, colorLabel: col.label, lambda0: col.lambda0, L: L.value };
    if (kind === 'double') { out.d = d.value; out.n = n.value; out.total = T.value; }
    else { out.a = a.value; out.W = W.value; }
    return out;
  }

  // 雙狹縫：只算正確波長（不需學生答案）。inp = {color, d, n, L, total}，長度單位 mm
  function calcDouble(inp) {
    var p = parseColorAndMeas(inp, 'double');
    if (!p.ok) return p;
    var r = lambdaFromDouble(p.d, p.total, p.L, p.n);
    return {
      ok: true, color: p.color, colorLabel: p.colorLabel, lambda0: p.lambda0,
      d: p.d, n: p.n, L: p.L, total: p.total, dy: r.dy,
      lambdaNm: r.lambdaNm,
      errorPct: errorPercent(r.lambdaNm, p.lambda0),
      warning: warningFor(r.lambdaNm),
      steps: stepsDouble(p.d, p.L, p.total, p.n, r.dy, r.lambdaMm, r.lambdaNm)
    };
  }

  // 單狹縫：inp = {color, a, L, W}，長度單位 mm
  function calcSingle(inp) {
    var p = parseColorAndMeas(inp, 'single');
    if (!p.ok) return p;
    var r = lambdaFromSingle(p.a, p.W, p.L);
    return {
      ok: true, color: p.color, colorLabel: p.colorLabel, lambda0: p.lambda0,
      a: p.a, L: p.L, W: p.W,
      lambdaNm: r.lambdaNm,
      errorPct: errorPercent(r.lambdaNm, p.lambda0),
      warning: warningFor(r.lambdaNm),
      steps: stepsSingle(p.a, p.L, p.W, r.lambdaMm, r.lambdaNm)
    };
  }

  // 核對：量測算出正確值後，與學生自算波長比對
  function attachVerify(base, studentLambda) {
    if (!base.ok) {
      var s0 = parsePositive(studentLambda, '你算出的波長');
      if (!s0.ok) base.errors = (base.errors || []).concat([s0.error]);
      return base;
    }
    var s = matchStudentLambda(studentLambda, base.lambdaNm);
    if (!s.ok) return { ok: false, errors: [s.error] };
    base.studentLambda = s.value;
    base.match = s.match;
    base.matchRelPct = s.relPct;
    base.matchTolPct = s.tolPct;
    return base;
  }
  function verifyDouble(inp) { return attachVerify(calcDouble(inp), inp && inp.studentLambda); }
  function verifySingle(inp) { return attachVerify(calcSingle(inp), inp && inp.studentLambda); }

  // 同一組、同一種狹縫，紅與綠都有紀錄時的比較（用正確波長）
  function compareColors(redLambda, greenLambda) {
    var red = Number(redLambda), green = Number(greenLambda);
    if (!(red > 0) || !(green > 0)) return { ok: false, errors: ['紅光與綠光的波長都必須是正數才能比較'] };
    var ratio = green / red;
    var longer;
    if (red === green) longer = 'equal';
    else longer = red > green ? 'red' : 'green';
    return { ok: true, redLambda: red, greenLambda: green, ratio: ratio, longer: longer };
  }

  // 找出同一組（同班級，且座號或組別相同）同一種狹縫的紅綠配對
  function findColorPairs(records) {
    var groups = {};
    (records || []).forEach(function (r) {
      if (!r || (r.type !== 'double' && r.type !== 'single')) return;
      if (r.color !== 'red' && r.color !== 'green') return;
      if (!isFinite(Number(r.lambdaNm)) || Number(r.lambdaNm) <= 0) return;
      var className = String(r.className || '').trim();
      if (!className) return;
      var seat = String(r.seat || '').trim();
      var group = String(r.group || '').trim();
      if (!seat && !group) return;
      var keys = [];
      if (group) keys.push(r.type + '|班級:' + className + '|組別:' + group);
      if (seat) keys.push(r.type + '|班級:' + className + '|座號:' + seat);
      keys.forEach(function (k) {
        if (!groups[k]) groups[k] = { key: k, type: r.type, className: className, seat: seat, group: group, red: null, green: null };
        // 同一顏色多筆時採較新的（清單通常新的在前，仍以 savedAt 為準）
        var cur = groups[k][r.color];
        if (!cur || String(r.savedAt || '') >= String(cur.savedAt || '')) groups[k][r.color] = r;
        if (!groups[k].seat && seat) groups[k].seat = seat;
        if (!groups[k].group && group) groups[k].group = group;
      });
    });
    var pairs = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.red && g.green) {
        var cmp = compareColors(g.red.lambdaNm, g.green.lambdaNm);
        if (cmp.ok) pairs.push({ key: k, type: g.type, className: g.className, seat: g.seat, group: g.group, red: g.red, green: g.green, compare: cmp });
      }
    });
    // 同一對可能因「座號」「組別」各產生一次，去重
    var seen = {}, uniq = [];
    pairs.forEach(function (p) {
      var id = [p.type, p.red.id, p.green.id].join('|');
      if (seen[id]) return;
      seen[id] = true;
      uniq.push(p);
    });
    return uniq;
  }

  // CSV：UTF-8 含 BOM
  function csvEscape(v) {
    var s = (v === undefined || v === null) ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // 防 Excel 公式注入
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(headers, rows) {
    var lines = [headers.map(csvEscape).join(',')];
    rows.forEach(function (r) { lines.push(r.map(csvEscape).join(',')); });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  // 基本資料：姓名、班級、日期必填；座號與組別至少填一個；照片編號選填
  function validateBasic(b) {
    b = b || {};
    var errors = [];
    var t = function (v) { return (v === undefined || v === null) ? '' : String(v).trim(); };
    if (!t(b.name)) errors.push('姓名：請填寫');
    if (t(b.name).length > 50) errors.push('姓名：最多 50 字');
    if (!t(b.className)) errors.push('班級：請填寫');
    if (!t(b.seat) && !t(b.group)) errors.push('座號與組別至少填一個');
    if (t(b.seat) && !/^\d{1,3}$/.test(t(b.seat))) errors.push('座號：請填 1–3 位數字');
    if (!t(b.date)) errors.push('日期：請填寫');
    if (t(b.photoNo).length > 50) errors.push('照片編號：最多 50 字');
    return { ok: errors.length === 0, errors: errors };
  }

  var api = {
    validateBasic: validateBasic, parsePositive: parsePositive, parseCountN: parseCountN, parseColor: parseColor,
    calcDouble: calcDouble, calcSingle: calcSingle,
    verifyDouble: verifyDouble, verifySingle: verifySingle,
    matchStudentLambda: matchStudentLambda,
    compareColors: compareColors, findColorPairs: findColorPairs,
    errorPercent: errorPercent, warningFor: warningFor,
    toCSV: toCSV, csvEscape: csvEscape, fmtSmart: fmtSmart,
    getLaserRefs: getLaserRefs, getLaserLabels: getLaserLabels, getMatchTolPct: getMatchTolPct,
    lambdaFromDouble: lambdaFromDouble, lambdaFromSingle: lambdaFromSingle
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SlitCalc = api;
})(this);
