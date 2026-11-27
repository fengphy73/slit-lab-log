/**
 * 狹縫干涉繞射實驗紀錄 — 接收端 v3（Google Apps Script，綁定在老師的「總試算表」）
 * 部署：網頁應用程式，執行身分「我」、誰可以存取「所有人」。
 *
 * v3：一個總試算表，每班一個分頁（分頁名就是班名，例如「301」）。
 *  - 同一班的雙狹縫、單狹縫放在同一頁，用「實驗」欄區分；紀錄編號固定在最後一欄（重複檢查用）。
 *  - 班級清單存在「班級清單」分頁：班級編號（不變）、班名、分頁編號（gid）、設定、狀態。
 *    改班名 = 分頁改名（資料、學生連結都不變）；封存 = 隱藏分頁（學生照樣能送）；刪除 = 只從教師頁清單拿掉，分頁和資料保留。
 *  - 教師頁用 GET 讀寫（?action=hello/list/addClass/editClass/archive/remove，都要老師金鑰）；學生頁用 GET ?action=config&id= 讀班級最新設定。
 *    注意：網址參數不要用 c（Google 會回 400）。
 *  - 學生紀錄仍用表單 POST（payload=JSON）：
 *      帶 classId → 寫進該班分頁；
 *      帶 v2 的 classCode → 照 v2 寫進「課堂名稱-雙狹縫」等分頁（若有同編號的班級就寫進該班分頁）；
 *      都沒有（舊長連結）→ 照舊寫進「雙狹縫」「單狹縫」，欄位與 v1/v2 相同。
 *  - 老師金鑰：第一次 hello 時登記在指令碼屬性「TEACHER_KEY:<試算表ID>」，複製範本後的新試算表會重新登記。
 */
var V = 3;
var SHEET_DOUBLE = '雙狹縫';
var SHEET_SINGLE = '單狹縫';
var SHEET_CLASSES = '課堂設定';   // v2 留下的，v3 只讀
var SHEET_ROSTER = '班級清單';
var RESERVED = [SHEET_DOUBLE, SHEET_SINGLE, SHEET_CLASSES, SHEET_ROSTER];

var HEADERS_DOUBLE = ['收到時間', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', '狹縫間距d(mm)',
  '量了幾個間距n', 'L(mm)', '第0條到第n條亮紋總長(mm)', 'Δy(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
var HEADERS_SINGLE = ['收到時間', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', '縫寬a(mm)',
  'L(mm)', 'W(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
// 班級分頁：共同欄＋雙縫欄＋單縫欄，不適用的留空
var HEADERS_CLASS = ['收到時間', '實驗', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', 'L(mm)',
  '狹縫間距d(mm)', '量了幾個間距n', '第0條到第n條亮紋總長(mm)', 'Δy(mm)', '縫寬a(mm)', 'W(mm)',
  '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
var HEADERS_ROSTER = ['班級編號', '班名', '分頁編號', '設定(JSON)', '狀態', '更新時間'];
var CODE_RE = /^[2-9A-HJKMNP-Z]{4,6}$/;     // v2 課堂代碼
var ID_RE = /^[A-Za-z0-9]{4,16}$/;          // v3 班級編號（教師頁產生）
var KEY_RE = /^[A-Za-z0-9]{16,64}$/;

// ---------- 學生紀錄 ----------
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var r = JSON.parse((e && e.parameter && e.parameter.payload) || '{}');
    var isDouble = r.type === 'double';
    if (!isDouble && r.type !== 'single') return out_({ ok: false, error: 'type 錯誤' });
    var cls = null;
    if (ID_RE.test(String(r.classId || ''))) cls = findRoster_(String(r.classId));
    var code = CODE_RE.test(String(r.classCode || '')) ? String(r.classCode) : '';
    if (!cls && code) cls = findRoster_(code);  // 舊教師頁的課堂搬到 v3 時沿用代碼當班級編號
    if (cls) return out_(writeClassRow_(cls, r, isDouble));
    var base = isDouble ? SHEET_DOUBLE : SHEET_SINGLE;
    var headers = isDouble ? HEADERS_DOUBLE : HEADERS_SINGLE;
    var sheet;
    if (code) {  // v2 的課堂連結：照 v2 寫法
      var found = findV2Class_(code);
      var cname = (found && found.name) || r.classroomName || code;
      sheet = getSheet_(v2Tab_(cname, base), headers.slice(0, -1).concat(['課堂代碼', headers[headers.length - 1]]));
    } else {
      sheet = getSheet_(base, headers);
    }
    if (r.id && isDuplicate_(sheet, r.id)) return out_({ ok: true, duplicate: true });
    var row = [new Date(), t_(r.name), t_(r.className), t_(r.seat), t_(r.group), t_(r.date), t_(r.photoNo), t_(r.slitId),
      t_(r.colorLabel || r.color), n_(r.lambda0)];
    if (isDouble) row = row.concat([n_(r.d), n_(r.n), n_(r.L), n_(r.total), n_(r.dy)]);
    else row = row.concat([n_(r.a), n_(r.L), n_(r.W)]);
    row = row.concat([n_(r.studentLambda), n_(r.lambdaNm), r.match ? '相符' : '不相符', n_(r.errorPct), t_(r.warning), t_(r.savedAt)]);
    if (code) row.push(code);
    row.push(t_(r.id));
    sheet.appendRow(row);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function writeClassRow_(cls, r, isDouble) {
  var sheet = classSheet_(cls);
  if (r.id && isDuplicate_(sheet, r.id)) return { ok: true, duplicate: true };
  var row = [new Date(), isDouble ? '雙狹縫' : '單狹縫', t_(r.name), t_(r.className), t_(r.seat), t_(r.group), t_(r.date), t_(r.photoNo),
    t_(r.slitId), t_(r.colorLabel || r.color), n_(r.lambda0), n_(r.L)];
  if (isDouble) row = row.concat([n_(r.d), n_(r.n), n_(r.total), n_(r.dy), '', '']);
  else row = row.concat(['', '', '', '', n_(r.a), n_(r.W)]);
  row = row.concat([n_(r.studentLambda), n_(r.lambdaNm), r.match ? '相符' : '不相符', n_(r.errorPct), t_(r.warning), t_(r.savedAt), t_(r.id)]);
  sheet.appendRow(row);
  return { ok: true };
}

// ---------- 教師頁與學生頁的 GET ----------
function doGet(e) {
  var p = (e && e.parameter) || {};
  var a = String(p.action || '');
  if (a === 'config') return out_(config_(String(p.id || p.code || '')));
  if (!a) return out_({ ok: true, msg: '狹縫實驗紀錄接收端運作中', v: V });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var auth = checkKey_(String(p.key || ''), a === 'hello');
    if (!auth.ok) return out_(auth);
    if (a === 'hello' || a === 'list') return out_(list_());
    if (a === 'addClass') return out_(addClass_(p));
    if (a === 'editClass') return out_(editClass_(p));
    if (a === 'archive') return out_(setStatus_(p, p.on === '0' ? '' : '封存'));
    if (a === 'remove') return out_(setStatus_(p, '移除'));
    return out_({ ok: false, error: '不認得的動作' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function keyProp_() { return 'TEACHER_KEY:' + SpreadsheetApp.getActive().getId(); }
// hello 時若還沒有金鑰就登記這一把；之後所有寫入都要同一把
function checkKey_(key, mayClaim) {
  if (!KEY_RE.test(key)) return { ok: false, v: V, error: '老師金鑰格式錯誤', code: 'badkey' };
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(keyProp_());
  if (!saved && mayClaim) { props.setProperty(keyProp_(), key); return { ok: true }; }
  if (saved !== key) return { ok: false, v: V, error: '這份試算表已經由另一個教師頁設定過，金鑰不符', code: 'keymismatch' };
  return { ok: true };
}

function list_() {
  var ss = SpreadsheetApp.getActive();
  var classes = readRoster_().filter(function (c) { return c.status !== '移除'; }).map(publicClass_);
  return { ok: true, v: V, sheetUrl: ss.getUrl(), classes: classes };
}
function publicClass_(c) {
  return { id: c.id, name: c.name, gid: c.gid, config: c.config, archived: c.status === '封存' };
}
function config_(id) {
  var c = ID_RE.test(id) ? findRoster_(id) : null;
  if (!c || c.status === '移除') return { ok: false, v: V, error: '找不到這個班級' };
  return { ok: true, v: V, id: c.id, name: c.name, config: c.config, archived: c.status === '封存' };
}

function checkName_(raw, exceptId) {
  var name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return { ok: false, error: '請填班名' };
  if (name.length > 40) return { ok: false, error: '班名最多 40 個字' };
  if (/[\[\]\*\?\/\\:']/.test(name)) return { ok: false, error: '班名不能有 [ ] * ? / \\ : \' 這些符號' };
  if (RESERVED.indexOf(name) >= 0) return { ok: false, error: '「' + name + '」是系統用的分頁名稱，請換一個' };
  var roster = readRoster_();
  for (var i = 0; i < roster.length; i++) {
    if (roster[i].id !== exceptId && roster[i].name === name && roster[i].status !== '移除') return { ok: false, error: '已經有叫「' + name + '」的班級' };
  }
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (sh) {
    var mine = null;
    for (var k = 0; k < roster.length; k++) if (roster[k].id === exceptId) mine = roster[k];
    if (!mine || sh.getSheetId() !== mine.gid) return { ok: false, error: '試算表裡已經有叫「' + name + '」的分頁（可能是刪除過的班級），請換個班名' };
  }
  return { ok: true, name: name };
}
function parseCfg_(s) {
  var cfg = {};
  try { cfg = JSON.parse(String(s || '{}')) || {}; } catch (err) { return null; }
  var json = JSON.stringify(cfg);
  return json.length > 20000 ? null : json;
}

function addClass_(p) {
  var id = String(p.id || '');
  if (!ID_RE.test(id)) return { ok: false, error: '班級編號格式錯誤' };
  var have = findRoster_(id);
  if (have) return { ok: true, v: V, cls: publicClass_(have), existed: true };  // 重送不重建
  var nm = checkName_(p.name, '');
  if (!nm.ok) return nm;
  var cfg = parseCfg_(p.cfg);
  if (cfg === null) return { ok: false, error: '設定格式錯誤或太大' };
  var sh = getSheet_(nm.name, HEADERS_CLASS);
  var c = { id: id, name: nm.name, gid: sh.getSheetId(), config: JSON.parse(cfg), status: '' };
  writeRoster_(c);
  return { ok: true, v: V, cls: publicClass_(c) };
}
function editClass_(p) {
  var c = findRoster_(String(p.id || ''));
  if (!c) return { ok: false, error: '找不到這個班級' };
  if (p.name !== undefined && String(p.name).trim() !== c.name) {
    var nm = checkName_(p.name, c.id);
    if (!nm.ok) return nm;
    var sh = classSheet_(c);
    sh.setName(nm.name);
    c.name = nm.name;
  }
  if (p.cfg !== undefined) {
    var cfg = parseCfg_(p.cfg);
    if (cfg === null) return { ok: false, error: '設定格式錯誤或太大' };
    c.config = JSON.parse(cfg);
  }
  writeRoster_(c);
  return { ok: true, v: V, cls: publicClass_(c) };
}
function setStatus_(p, status) {
  var c = findRoster_(String(p.id || ''));
  if (!c) return { ok: false, error: '找不到這個班級' };
  var ss = SpreadsheetApp.getActive();
  var sh = classSheet_(c);
  if (status === '') sh.showSheet();
  else if (status === '封存' && !sh.isSheetHidden() && visibleCount_(ss) > 1) sh.hideSheet();  // 試算表至少要留一個看得見的分頁
  c.status = status;
  writeRoster_(c);
  return { ok: true, v: V, cls: publicClass_(c) };
}
function visibleCount_(ss) { return ss.getSheets().filter(function (s) { return !s.isSheetHidden(); }).length; }

// ---------- 班級清單分頁 ----------
function rosterSheet_() { return getSheet_(SHEET_ROSTER, HEADERS_ROSTER); }
function readRoster_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_ROSTER);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().map(function (v, i) {
    var cfg = {};
    try { cfg = JSON.parse(String(v[3] || '{}')); } catch (err) {}
    return { row: i + 2, id: String(v[0]), name: String(v[1]).replace(/^'/, ''), gid: Number(v[2]), config: cfg, status: String(v[4] || '') };
  }).filter(function (c) { return ID_RE.test(c.id); });
}
function findRoster_(id) {
  var all = readRoster_();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}
function writeRoster_(c) {
  var sh = rosterSheet_();
  var values = [c.id, t_(c.name), c.gid, JSON.stringify(c.config || {}), c.status || '', new Date()];
  if (c.row) sh.getRange(c.row, 1, 1, values.length).setValues([values]);
  else { sh.appendRow(values); c.row = sh.getLastRow(); }
}
// 依分頁編號找班級分頁；老師手動刪掉分頁時以班名重建
function classSheet_(c) {
  var ss = SpreadsheetApp.getActive();
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getSheetId() === c.gid) return all[i];
  var sh = ss.getSheetByName(c.name);
  if (!sh) sh = getSheet_(c.name, HEADERS_CLASS);
  c.gid = sh.getSheetId();
  writeRoster_(c);
  return sh;
}

// ---------- v2 相容 ----------
function findV2Class_(code) {
  var sh = SpreadsheetApp.getActive().getSheetByName(SHEET_CLASSES);
  if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]) === code) return { code: code, name: String(v[i][1]).replace(/^'/, '') };
  return null;
}
function v2Tab_(name, suffix) {
  var s = String(name || '').replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (s || '課堂') + '-' + suffix;
}

// ---------- 共用 ----------
function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name, ss.getSheets().length);  // 加在最後面（不指定位置時 Google 會插在最前面附近，班級順序會反過來）
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function isDuplicate_(sh, id) {
  var last = sh.getLastRow(); if (last < 2) return false;
  var col = sh.getLastColumn();
  var ids = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return true;
  return false;
}
// 文字欄：截斷並防公式注入
function t_(v) { var s = (v === undefined || v === null) ? '' : String(v).slice(0, 100); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function n_(v) { var x = Number(v); return isFinite(x) ? x : ''; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
