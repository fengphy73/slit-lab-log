// 老師設定的編碼／解碼（學生頁網址 #c=，不送到伺服器）
(function (root) {
  'use strict';
  var SCRIPT_PREFIX = 'https://script.google.com/';
  var DEFAULT_LABEL = { red: '紅光', green: '綠光' };
  // 學生畫面用的顏色標示（兩個常見值並列，不暗示一定是哪一個）
  var COLOR_CAPTION = {
    red: '紅光（650 nm 或 635 nm）',
    green: '綠光（532 nm 或 520 nm）'
  };
  var DEFAULT_LAMBDAS = { red: 650, green: 532 };

  function utf8ToB64Url(str) {
    var b64;
    if (typeof Buffer !== 'undefined') b64 = Buffer.from(str, 'utf8').toString('base64');
    else b64 = btoa(unescape(encodeURIComponent(str)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64UrlToUtf8(s) {
    s = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    if (typeof Buffer !== 'undefined') return Buffer.from(s, 'base64').toString('utf8');
    return decodeURIComponent(escape(atob(s)));
  }

  function isValidScriptUrl(raw) {
    var u = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (u === '') return { ok: true, value: '' };
    if (u.indexOf(SCRIPT_PREFIX) !== 0) {
      return { ok: false, error: '試算表網址必須是 https://script.google.com/ 開頭（或留空）' };
    }
    if (u.length > 500) return { ok: false, error: '試算表網址太長' };
    return { ok: true, value: u };
  }

  function parseLaser(row) {
    if (!row || (row.color !== 'red' && row.color !== 'green')) return null;
    var lam = Number(row.lambda0);
    if (!isFinite(lam) || lam <= 0) lam = DEFAULT_LAMBDAS[row.color];
    return { color: row.color, lambda0: lam };
  }
  function parseSlit(row) {
    if (!row) return null;
    var id = (row.id === undefined || row.id === null) ? '' : String(row.id).trim();
    var type = row.type === 'single' ? 'single' : (row.type === 'double' ? 'double' : '');
    var value = Number(row.value);
    if (!id && type === '' && (row.value === undefined || row.value === '' || row.value === null)) return null;
    if (!id || !type || !isFinite(value) || value <= 0) return { error: true, id: id };
    return { id: id.slice(0, 30), type: type, value: value };
  }

  function normalize(raw) {
    raw = raw || {};
    var warnings = [];
    var url = isValidScriptUrl(raw.scriptUrl);
    var scriptUrl = '';
    if (url.ok) scriptUrl = url.value;
    else warnings.push('連結裡的試算表網址無效，已略過；資料只會存在這台裝置，可下載 CSV。');

    var lasers = [];
    var seen = {};
    (raw.lasers || []).forEach(function (row) {
      var L = parseLaser(row);
      if (L && !seen[L.color]) { seen[L.color] = true; lasers.push(L); }
    });
    if (!lasers.length) {
      lasers = [{ color: 'red', lambda0: 650 }, { color: 'green', lambda0: 532 }];
    }

    var experiments = [];
    (raw.experiments || []).forEach(function (e) {
      if ((e === 'double' || e === 'single') && experiments.indexOf(e) < 0) experiments.push(e);
    });
    if (!experiments.length) experiments = ['double', 'single'];

    var slits = [], slitError = false;
    (raw.slits || []).forEach(function (row) {
      var s = parseSlit(row);
      if (!s) return;
      if (s.error) slitError = true;
      else slits.push(s);
    });
    if (slitError && !slits.length && (raw.slits || []).length) {
      warnings.push('部分狹縫片資料不完整，已略過。');
    }

    var suggestedL = Number(raw.suggestedL);
    if (!isFinite(suggestedL) || suggestedL <= 0) suggestedL = 1000;

    var teacherName = (raw.teacherName === undefined || raw.teacherName === null) ? '' : String(raw.teacherName).trim().slice(0, 80);

    return {
      v: 1,
      scriptUrl: scriptUrl,
      teacherName: teacherName,
      suggestedL: suggestedL,
      experiments: experiments,
      lasers: lasers,
      slits: slits,
      warnings: warnings
    };
  }

  function validateForGenerate(raw) {
    var errors = [];
    var url = isValidScriptUrl(raw && raw.scriptUrl);
    if (!url.ok) errors.push(url.error);
    var lasers = [];
    (raw && raw.lasers || []).forEach(function (row) {
      if (!row || (row.color !== 'red' && row.color !== 'green')) return;
      var lam = Number(row.lambda0);
      if (!isFinite(lam) || lam <= 0) errors.push((row.color === 'red' ? '紅光' : '綠光') + '的標示波長請填正數');
      else lasers.push({ color: row.color, lambda0: lam });
    });
    if (!lasers.length) errors.push('請至少勾選一種雷射顏色');
    var experiments = (raw && raw.experiments || []).filter(function (e) { return e === 'double' || e === 'single'; });
    if (!experiments.length) errors.push('請至少開一種實驗（雙狹縫或單狹縫）');
    var suggestedL = Number(raw && raw.suggestedL);
    if (raw && raw.suggestedL !== undefined && String(raw.suggestedL).trim() !== '' && (!isFinite(suggestedL) || suggestedL <= 0)) {
      errors.push('建議 L 請填正數（mm）');
    }
    (raw && raw.slits || []).forEach(function (row, i) {
      var empty = !row || ((!row.id || !String(row.id).trim()) && !row.type && (row.value === undefined || row.value === '' || row.value === null));
      if (empty) return;
      var s = parseSlit(row);
      if (!s || s.error) errors.push('第 ' + (i + 1) + ' 列狹縫片請填齊編號、類型與標示值');
    });
    if (errors.length) return { ok: false, errors: errors };
    return { ok: true, settings: normalize(raw) };
  }

  function encode(settings) {
    var s = normalize(settings);
    delete s.warnings;
    return utf8ToB64Url(JSON.stringify(s));
  }
  function decodeToken(token) {
    try {
      var json = b64UrlToUtf8(token);
      var raw = JSON.parse(json);
      if (!raw || typeof raw !== 'object') return { ok: false, error: '設定格式不正確' };
      return { ok: true, settings: normalize(raw) };
    } catch (e) {
      return { ok: false, error: '設定連結無效或已損壞' };
    }
  }
  function tokenFromHash(hash) {
    var h = String(hash || '');
    if (h.charAt(0) === '#') h = h.slice(1);
    if (!h) return '';
    var parts = h.split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i];
      var eq = kv.indexOf('=');
      var key = eq < 0 ? kv : kv.slice(0, eq);
      if (key === 'c') return eq < 0 ? '' : kv.slice(eq + 1);
    }
    return '';
  }
  function fromHash(hash) {
    var token = tokenFromHash(hash);
    if (!token) return { ok: true, settings: null };
    var r = decodeToken(token);
    if (!r.ok) return r;
    return r;
  }
  function buildStudentUrl(settings, pageUrl) {
    var v = validateForGenerate(settings);
    if (!v.ok) return v;
    var base = String(pageUrl || '').split('#')[0];
    return { ok: true, url: base + '#c=' + encode(v.settings), settings: v.settings };
  }
  function extractStudentUrl(text) {
    var s = String(text || '').trim();
    var hash = '';
    var i = s.indexOf('#');
    if (i >= 0) hash = s.slice(i);
    else if (/^[A-Za-z0-9_-]+$/.test(s)) hash = '#c=' + s;
    return fromHash(hash);
  }
  function laserRefs(settings) {
    var refs = {}, labels = {};
    (settings && settings.lasers || []).forEach(function (L) {
      refs[L.color] = L.lambda0;
      labels[L.color] = DEFAULT_LABEL[L.color];
    });
    return { refs: refs, labels: labels };
  }
  function colorCaption(color) { return COLOR_CAPTION[color] || color; }
  function allowedColors(settings) {
    if (!settings || !settings.lasers || !settings.lasers.length) return ['red', 'green'];
    return settings.lasers.map(function (L) { return L.color; });
  }
  function slitsFor(settings, type) {
    return (settings && settings.slits || []).filter(function (s) { return s.type === type; });
  }
  function formatSlitValue(v) {
    var n = Number(v);
    if (!isFinite(n)) return String(v);
    var s = String(n);
    var dec = s.indexOf('.') >= 0 ? s.split('.')[1].length : 0;
    if (dec === 1) return n.toFixed(2);
    return s;
  }
  function slitOptionLabel(s) {
    var unit = s.type === 'double' ? 'd' : 'a';
    return '第 ' + s.id + ' 片（' + unit + '=' + formatSlitValue(s.value) + ' mm）';
  }

  // 老師設定頁防呆：只提醒、不阻擋產生連結
  var HINT_SLIT_UNIT = '單位是 mm（片子若印 µm，例如 40 µm 請填 0.04）';
  var HINT_LAMBDA_NM = '請填 nm，例如 650';
  function slitValueHint(raw) {
    var s = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (s === '') return '';
    var n = Number(s);
    if (!isFinite(n)) return '';
    if (n < 0.01 || n > 2) return HINT_SLIT_UNIT;
    return '';
  }
  function laserLambdaHint(raw) {
    var s = (raw === undefined || raw === null) ? '' : String(raw).trim();
    if (s === '') return '';
    var n = Number(s);
    if (!isFinite(n)) return '';
    if (n < 400 || n > 700) return HINT_LAMBDA_NM;
    return '';
  }

  var api = {
    SCRIPT_PREFIX: SCRIPT_PREFIX,
    COLOR_CAPTION: COLOR_CAPTION,
    isValidScriptUrl: isValidScriptUrl,
    normalize: normalize,
    validateForGenerate: validateForGenerate,
    encode: encode,
    decodeToken: decodeToken,
    tokenFromHash: tokenFromHash,
    fromHash: fromHash,
    buildStudentUrl: buildStudentUrl,
    extractStudentUrl: extractStudentUrl,
    laserRefs: laserRefs,
    colorCaption: colorCaption,
    allowedColors: allowedColors,
    slitsFor: slitsFor,
    formatSlitValue: formatSlitValue,
    slitOptionLabel: slitOptionLabel,
    HINT_SLIT_UNIT: HINT_SLIT_UNIT,
    HINT_LAMBDA_NM: HINT_LAMBDA_NM,
    slitValueHint: slitValueHint,
    laserLambdaHint: laserLambdaHint
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlitSettings = api;
})(this);
