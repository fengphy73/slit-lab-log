// 課堂清單：本機儲存、短代碼、學生連結、備份（教師頁與簡報共用）
(function (root) {
  'use strict';
  var S = root.SlitSettings || (typeof require === 'function' ? require('./settings.js') : null);
  var KEY = 'slitLabLog.classrooms.v1';
  var OLD_KEY = 'slitLabLog.teacherConfig.v1';
  var SHEET_PREFIX = 'https://docs.google.com/spreadsheets/';

  function randomString(chars, n) {
    var buf = null, out = '';
    var cr = root.crypto || (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (cr && cr.getRandomValues) { buf = new Uint32Array(n); cr.getRandomValues(buf); }
    for (var i = 0; i < n; i++) out += chars.charAt((buf ? buf[i] : Math.floor(Math.random() * 4294967296)) % chars.length);
    return out;
  }
  function newKey() { return randomString('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 24); }
  function findClass(store, code) {
    for (var i = 0; i < store.classrooms.length; i++) if (store.classrooms[i].code === code) return store.classrooms[i];
    return null;
  }
  function newCode(store) {
    var c;
    do { c = randomString(S.CODE_CHARS, 4); } while (findClass(store, c));
    return c;
  }
  // 課堂只存縫的設定（雷射、實驗、L、狹縫片），老師名稱與網址是全域
  function cleanConfig(raw) {
    var n = S.normalize(raw || {});
    return { lasers: n.lasers, experiments: n.experiments, suggestedL: n.suggestedL, slits: n.slits };
  }
  function str(v, max) { return (v == null ? '' : String(v)).trim().slice(0, max); }
  function normalizeStore(raw) {
    raw = raw || {};
    var t = raw.teacher || {};
    var store = {
      v: 1,
      teacher: {
        name: str(t.name, 80),
        scriptUrl: S.isValidScriptUrl(t.scriptUrl).ok ? str(t.scriptUrl, 500) : '',
        sheetUrl: str(t.sheetUrl, 500).indexOf(SHEET_PREFIX) === 0 ? str(t.sheetUrl, 500) : '',
        key: /^[A-Za-z0-9]{16,64}$/.test(t.key || '') ? t.key : newKey()
      },
      classrooms: [],
      wizardDone: !!raw.wizardDone
    };
    (raw.classrooms || []).forEach(function (c) {
      if (!c) return;
      var code = S.isClassCode(c.code) && !findClass(store, c.code) ? c.code : newCode(store);
      store.classrooms.push({ code: code, name: str(c.name, 40) || ('課堂 ' + code), config: cleanConfig(c.config), synced: !!c.synced });
    });
    return store;
  }
  function fromOldConfig(old) {
    var store = normalizeStore({ teacher: { name: old.teacherName, scriptUrl: old.scriptUrl } });
    store.classrooms.push({ code: newCode(store), name: '我的課堂', config: cleanConfig(old), synced: false });
    store.wizardDone = true;
    return store;
  }
  function load(ls) {
    ls = ls || root.localStorage;
    try {
      var raw = ls.getItem(KEY);
      if (raw) return normalizeStore(JSON.parse(raw));
      var old = ls.getItem(OLD_KEY); // 舊版教師頁的單一設定 → 第一個課堂
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
  // 給學生頁的完整設定（長連結 #c= 與試算表登記共用）
  function classSettings(store, cls) {
    var c = cls.config;
    return { teacherName: displayName(store, cls), scriptUrl: store.teacher.scriptUrl,
      lasers: c.lasers, experiments: c.experiments, suggestedL: c.suggestedL, slits: c.slits,
      classCode: cls.code, classroomName: cls.name };
  }
  // 學生連結：已同步到試算表 → 短連結 ?t=&c=；否則長連結 #c=（離線也能用）
  function linkFor(store, cls, pageUrl) {
    var base = String(pageUrl).split('#')[0].split('?')[0];
    var id = S.deploymentId(store.teacher.scriptUrl);
    if (id && cls.synced) return { ok: true, short: true, url: base + '?t=' + id + '&c=' + cls.code };
    var v = S.buildStudentUrl(classSettings(store, cls), base);
    return v.ok ? { ok: true, short: false, url: v.url } : v;
  }
  function savePayload(store, cls) {
    var s = classSettings(store, cls);
    delete s.scriptUrl;
    return { action: 'saveClass', code: cls.code, name: cls.name, config: s, key: store.teacher.key };
  }
  // 備份：JSON 檔或 teacher.html#backup=…
  function exportJson(store) {
    return JSON.stringify({ app: 'slit-lab-log', v: 1, teacher: store.teacher, classrooms: store.classrooms.map(function (c) {
      return { code: c.code, name: c.name, config: c.config };
    }) }, null, 2);
  }
  function backupLink(store, pageUrl) {
    return String(pageUrl).split('#')[0].split('?')[0] + '#backup=' + S.utf8ToB64Url(JSON.stringify(JSON.parse(exportJson(store))));
  }
  // 匯入：備份檔 JSON、備份連結，或舊的學生連結（#c=）
  function parseImport(text) {
    var s = String(text || '').trim();
    try {
      var i = s.indexOf('#backup=');
      if (i >= 0) s = S.b64UrlToUtf8(s.slice(i + 8).split('&')[0]);
      if (s.charAt(0) === '{') {
        var raw = JSON.parse(s);
        if (!raw || !raw.classrooms) return { ok: false, error: '不是課堂清單的備份' };
        return { ok: true, backup: normalizeStore(raw) };
      }
    } catch (e) { return { ok: false, error: '備份內容無效或不完整' }; }
    var r = S.extractStudentUrl(s);
    if (r.ok && r.settings) return { ok: true, settings: r.settings };
    return { ok: false, error: '看不懂這個內容，請貼備份連結、備份檔內容或學生連結' };
  }
  // 合併：同代碼的課堂以匯入的為準，其餘保留；老師設定有填的才覆蓋
  function merge(store, incoming) {
    var t = incoming.teacher;
    if (t.name) store.teacher.name = t.name;
    if (t.scriptUrl) store.teacher.scriptUrl = t.scriptUrl;
    if (t.sheetUrl) store.teacher.sheetUrl = t.sheetUrl;
    store.teacher.key = t.key;
    var added = 0, replaced = 0;
    incoming.classrooms.forEach(function (c) {
      var hit = findClass(store, c.code);
      c.synced = false;
      if (hit) { store.classrooms[store.classrooms.indexOf(hit)] = c; replaced++; }
      else { store.classrooms.push(c); added++; }
    });
    store.wizardDone = true;
    return { added: added, replaced: replaced };
  }

  var api = {
    KEY: KEY, OLD_KEY: OLD_KEY, SHEET_PREFIX: SHEET_PREFIX,
    load: load, save: save, normalizeStore: normalizeStore, newCode: newCode, findClass: findClass,
    cleanConfig: cleanConfig, classSettings: classSettings, linkFor: linkFor, savePayload: savePayload,
    exportJson: exportJson, backupLink: backupLink, parseImport: parseImport, merge: merge
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SlitClassrooms = api;
})(this);
