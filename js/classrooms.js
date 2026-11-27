// 班級清單：本機快取＋總試算表（雲端）、學生長連結、「我的教師頁」連結（教師頁與簡報共用）
(function (root) {
  'use strict';
  var S = root.SlitSettings || (typeof require === 'function' ? require('./settings.js') : null);
  var KEY = 'slitLabLog.classrooms.v1';
  var OLD_KEY = 'slitLabLog.teacherConfig.v1';
  var SHEET_PREFIX = 'https://docs.google.com/spreadsheets/';
  // 範本試算表（已裝好 v3 程式）。之後換成真的範本 ID。
  var TEMPLATE_SHEET_ID = 'TEMPLATE_SHEET_ID';
  var RESERVED = ['雙狹縫', '單狹縫', '課堂設定', '班級清單'];

  function randomString(chars, n) {
    var buf = null, out = '';
    var cr = root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (cr && cr.getRandomValues) { buf = new Uint32Array(n); cr.getRandomValues(buf); }
    for (var i = 0; i < n; i++) out += chars.charAt((buf ? buf[i] : Math.floor(Math.random() * 4294967296)) % chars.length);
    return out;
  }
  var ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function newKey() { return randomString(ALNUM, 24); }
  function findClass(store, id) {
    for (var i = 0; i < store.classrooms.length; i++) if (store.classrooms[i].id === id) return store.classrooms[i];
    return null;
  }
  function newId(store) {
    var c;
    do { c = randomString(ALNUM, 8); } while (findClass(store, c));
    return c;
  }
  function templateCopyUrl() { return 'https://docs.google.com/spreadsheets/d/' + TEMPLATE_SHEET_ID + '/copy'; }
  // 班級只存縫的設定（雷射、實驗、L、狹縫片），老師名稱與網址是全域
  function cleanConfig(raw) {
    var n = S.normalize(raw || {});
    return { lasers: n.lasers, experiments: n.experiments, suggestedL: n.suggestedL, slits: n.slits };
  }
  function str(v, max) { return (v == null ? '' : String(v)).trim().slice(0, max); }
  function normalizeClass(c) {
    var gid = Number(c.gid);
    return { id: c.id, name: str(c.name, 40), config: cleanConfig(c.config),
      gid: (c.gid === null || c.gid === undefined || c.gid === '' || !isFinite(gid)) ? null : gid, archived: !!c.archived };
  }
  function normalizeStore(raw) {
    raw = raw || {};
    var t = raw.teacher || {};
    var url = S.checkScriptUrl(t.scriptUrl);
    var store = {
      v: 3,
      teacher: {
        name: str(t.name, 80),
        scriptUrl: url.ok ? url.url : '',
        sheetUrl: str(t.sheetUrl, 500).indexOf(SHEET_PREFIX) === 0 ? str(t.sheetUrl, 500) : '',
        key: /^[A-Za-z0-9]{16,64}$/.test(t.key || '') ? t.key : newKey(),
        connected: !!(url.ok && t.connected)
      },
      classrooms: [],
      setupSkipped: !!raw.setupSkipped
    };
    (raw.classrooms || []).forEach(function (c) {
      if (!c) return;
      var id = S.isClassId(c.id) ? c.id : (S.isClassCode(c.code) ? c.code : '');  // 舊版的課堂代碼沿用成班級編號
      if (!id || findClass(store, id)) id = newId(store);
      var n = normalizeClass({ id: id, name: c.name, config: c.config, gid: c.gid, archived: c.archived });
      if (!n.name) n.name = '班級 ' + id.slice(0, 4);
      store.classrooms.push(n);
    });
    return store;
  }
  function fromOldConfig(old) {
    var store = normalizeStore({ teacher: { name: old.teacherName, scriptUrl: old.scriptUrl } });
    store.classrooms.push(normalizeClass({ id: newId(store), name: '我的課堂', config: old }));
    return store;
  }
  function load(ls) {
    ls = ls || root.localStorage;
    try {
      var raw = ls.getItem(KEY);
      if (raw) return normalizeStore(JSON.parse(raw));
      var old = ls.getItem(OLD_KEY); // 更舊版教師頁的單一設定 → 第一個班級
      if (old) { var st = fromOldConfig(JSON.parse(old)); save(st, ls); return st; }
    } catch (e) {}
    return normalizeStore({});
  }
  function save(store, ls) {
    ls = ls || root.localStorage;
    try { ls.setItem(KEY, JSON.stringify(store)); return true; } catch (e) { return false; }
  }
  function displayName(store, cls) {
    return [store.teacher.name, cls.name].filter(function (s) { return s; }).join('　');
  }
  // 給學生頁的完整設定（長連結 #c=）
  function classSettings(store, cls) {
    var c = cls.config;
    return { teacherName: displayName(store, cls), scriptUrl: store.teacher.scriptUrl,
      lasers: c.lasers, experiments: c.experiments, suggestedL: c.suggestedL, slits: c.slits,
      classId: cls.id, classroomName: cls.name };
  }
  // 存到雲端的班級設定（學生頁用 ?action=config 讀回最新的）
  function cloudConfig(store, cls) {
    var s = classSettings(store, cls);
    return { teacherName: s.teacherName, lasers: s.lasers, experiments: s.experiments, suggestedL: s.suggestedL, slits: s.slits };
  }
  // 學生連結一律是長連結 #c=（離線也能用，換程式也不怕）
  function linkFor(store, cls, pageUrl) {
    var base = String(pageUrl).split('#')[0].split('?')[0];
    var v = S.buildStudentUrl(classSettings(store, cls), base);
    return v.ok ? { ok: true, short: false, url: v.url } : v;
  }
  function dataUrl(store, cls) {
    if (!store.teacher.sheetUrl) return '';
    var u = store.teacher.sheetUrl.split('#')[0];
    return cls && cls.gid !== null ? u + '#gid=' + cls.gid : u;
  }
  // 班名檢查（與 Code.gs 相同規則）
  function checkName(store, raw, exceptId) {
    var name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) return { ok: false, error: '請填班名，例如「301」' };
    if (name.length > 40) return { ok: false, error: '班名最多 40 個字' };
    if (/[\[\]\*\?\/\\:']/.test(name)) return { ok: false, error: '班名不能有 [ ] * ? / \\ : \' 這些符號（分頁名稱不允許）' };
    if (RESERVED.indexOf(name) >= 0) return { ok: false, error: '「' + name + '」是系統用的分頁名稱，請換一個' };
    for (var i = 0; i < store.classrooms.length; i++) {
      var c = store.classrooms[i];
      if (c.id !== exceptId && c.name === name) return { ok: false, error: '已經有叫「' + name + '」的班級' + (c.archived ? '（在「已封存」裡）' : '') + '，請換個名稱' };
    }
    return { ok: true, name: name };
  }
  // 雲端清單為準；本機還沒建好分頁的班級（gid 為 null）保留，之後補建
  function applyCloud(store, res) {
    if (res.sheetUrl && String(res.sheetUrl).indexOf(SHEET_PREFIX) === 0) store.teacher.sheetUrl = String(res.sheetUrl).slice(0, 500);
    var cloud = (res.classes || []).filter(function (c) { return c && S.isClassId(c.id); }).map(normalizeClass);
    var pending = store.classrooms.filter(function (c) {
      return c.gid === null && !cloud.some(function (k) { return k.id === c.id; });
    });
    store.classrooms = cloud.concat(pending);
    return pending;
  }
  // 「我的教師頁」連結：teacher.html#setup=…（程式網址＋老師金鑰＋名稱），換電腦打開就好
  function setupLink(store, pageUrl) {
    var o = { u: store.teacher.scriptUrl, k: store.teacher.key, n: store.teacher.name };
    return String(pageUrl).split('#')[0].split('?')[0] + '#setup=' + S.utf8ToB64Url(JSON.stringify(o));
  }
  function parseSetup(hash) {
    var m = /(?:^|[#&])setup=([A-Za-z0-9_-]+)/.exec(String(hash || ''));
    if (!m) return null;
    try {
      var o = JSON.parse(S.b64UrlToUtf8(m[1]));
      var url = S.checkScriptUrl(o.u);
      if (!url.ok || !/^[A-Za-z0-9]{16,64}$/.test(o.k || '')) return { ok: false, error: '「我的教師頁」連結不完整，請從原本的電腦重新複製一次。' };
      return { ok: true, scriptUrl: url.url, key: o.k, name: str(o.n, 80) };
    } catch (e) { return { ok: false, error: '「我的教師頁」連結損壞，請從原本的電腦重新複製一次。' }; }
  }

  var api = {
    KEY: KEY, OLD_KEY: OLD_KEY, SHEET_PREFIX: SHEET_PREFIX, TEMPLATE_SHEET_ID: TEMPLATE_SHEET_ID, RESERVED: RESERVED,
    load: load, save: save, normalizeStore: normalizeStore, normalizeClass: normalizeClass, newId: newId, findClass: findClass,
    cleanConfig: cleanConfig, classSettings: classSettings, cloudConfig: cloudConfig, linkFor: linkFor, dataUrl: dataUrl,
    checkName: checkName, applyCloud: applyCloud, setupLink: setupLink, parseSetup: parseSetup, templateCopyUrl: templateCopyUrl
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlitClassrooms = api;
})(this);
