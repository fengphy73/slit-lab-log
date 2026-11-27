/**
 * 狹縫干涉繞射實驗紀錄 — 總程式 v4（Google Apps Script 獨立專案，由管理者部署一次）
 * 部署：網頁應用程式，執行身分「我」、誰可以存取「所有人」。
 *
 * 一個總程式服務所有老師：
 *  - 管理者（執行長）用 admin.html 開通老師：輸入 email → 程式在管理者雲端的資料夾建一份該老師專屬的試算表、分享給他，
 *    回傳老師編號與老師金鑰，開通頁組成「老師的教師頁連結」。開通紀錄在「老師清單」試算表。
 *  - 老師用 teacher.html#setup=… 建班級：每班一個分頁（分頁名＝班名），編輯、改名（保留 sheetId）、封存（隱藏分頁）、刪除（只標記）。
 *  - 學生用 GET ?action=submit 送紀錄（讀得到回應，能確認成功）；每筆帶唯一 id，後端去重；寫入只 appendRow 一次，鎖只包住「查重＋寫入」。
 *  - 所有請求都打同一個 /exec，用 tid（老師編號）＋金鑰 找到該老師的試算表。
 *  - 網址參數不要用 c（Google 會回 400）。
 */
// ====================== 帳號相關設定：搬到公司帳號時只看這一段 ======================
var CONFIG = {
  FOLDER_NAME: '狹縫實驗紀錄（各校老師）',   // 第一次打開開通頁時，在部署者的雲端硬碟自動建立；之後 ID 記在指令碼屬性 FOLDER_ID
  REGISTRY_NAME: '狹縫實驗紀錄_老師清單',     // 開通紀錄；ID 記在指令碼屬性 REGISTRY_ID
  TEACHER_SHEET_PREFIX: '狹縫實驗紀錄_',      // 老師試算表檔名＝前綴＋老師名稱（或 email）
  SHARE_ROLE: 'writer',                       // 分享給老師的權限：writer（編輯者）或 reader（檢視者）；分享時 Google 會寄通知信給老師
  RECORD_STORE: 'sheet',                      // 學生紀錄寫到哪裡：'sheet'＝老師試算表的班級分頁（目前唯一實作）；預留 'form'、'shard'
  LOCK_WAIT_MS: 4000,                         // 等鎖上限；等不到就回 busy，學生端會自動重送
  CACHE_SEC: 600                              // 老師／班級查詢的快取秒數
};
// 指令碼屬性（專案設定 → 指令碼屬性）：ADMIN_KEY（管理者金鑰，第一次打開開通頁時自動登記）、FOLDER_ID、REGISTRY_ID
// =====================================================================================

var V = 4;
var SHEET_ROSTER = '班級清單';
var SHEET_NOTICE = '使用說明';
var RESERVED = [SHEET_ROSTER, SHEET_NOTICE];
var HEADERS_CLASS = ['收到時間', '實驗', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', 'L(mm)',
  '狹縫間距d(mm)', '量了幾個間距n', '第0條到第n條亮紋總長(mm)', 'Δy(mm)', '縫寬a(mm)', 'W(mm)',
  '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
var COL_RID = HEADERS_CLASS.length;   // 紀錄編號固定在最後一欄
var HEADERS_ROSTER = ['班級編號', '班名', '分頁編號', '設定(JSON)', '狀態', '更新時間'];
var HEADERS_REG = ['老師編號', '老師名稱', 'email', '試算表ID', '試算表網址', '老師金鑰', '狀態', '分享方式', '接收程式網址(預留)', '開通時間', '更新時間'];
var ID_RE = /^[A-Za-z0-9]{4,16}$/;     // 班級編號（教師頁產生）
var TID_RE = /^T[A-Za-z0-9]{6,20}$/;   // 老師編號
var KEY_RE = /^[A-Za-z0-9]{16,64}$/;
var RID_RE = /^[A-Za-z0-9_-]{6,40}$/;  // 學生紀錄編號
var EMAIL_RE = /^[^\s@,;<>"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
var NOTICE = [
  ['狹縫干涉繞射實驗紀錄：資料使用說明（草稿）'],
  ['1. 存放位置：這份試算表由「狹縫實驗紀錄」網站的管理者建立，存放在管理者的 Google 雲端硬碟，並分享給您。'],
  ['2. 只存座號與實驗數據：班級、座號、組別、日期、量測值與計算結果；不收學生姓名、電話、email。'],
  ['3. 用途：僅供課堂教學與學習評量，不做其他用途，不提供給第三方。'],
  ['4. 刪除：老師可隨時要求管理者刪除某一班或全部資料，也可以自己刪除這份試算表中的列。'],
  ['5. 保存期限：建議學期結束後一年內刪除。'],
  ['每個班級一個分頁，請不要改「班級清單」分頁；要改班名請在教師頁的「編輯」改。']
];

// ---------- 入口 ----------
function doGet(e) { return out_(route_((e && e.parameter) || {})); }
function doPost(e) {  // 相容：表單 POST payload=JSON 也當成學生送出
  var p = (e && e.parameter) || {};
  if (p.payload && !p.action) p = { action: 'submit', p: p.payload, tid: p.tid };
  return out_(route_(p));
}
function route_(p) {
  var a = String(p.action || '');
  try {
    if (!a) return { ok: true, msg: '狹縫實驗紀錄總程式運作中', v: V };
    if (a === 'submit') return submit_(p);
    if (a === 'config') return withTeacher_(p, false, function () { return config_(String(p.id || '')); });
    if (a.indexOf('admin') === 0) return admin_(a, p);
    var T = { hello: 1, list: 1, addClass: 1, editClass: 1, archive: 1, remove: 1 };
    if (!T[a]) return { ok: false, v: V, error: '不認得的動作' };
    return withTeacher_(p, true, function (t) {
      if (a === 'hello' || a === 'list') return list_(t);
      return locked_(function () {
        if (a === 'addClass') return addClass_(p);
        if (a === 'editClass') return editClass_(p);
        if (a === 'archive') return setStatus_(p, p.on === '0' ? '' : '封存');
        return setStatus_(p, '移除');
      });
    });
  } catch (err) {
    return { ok: false, v: V, error: String(err && err.message || err), retry: true };
  }
}
function locked_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.LOCK_WAIT_MS)) return { ok: false, v: V, busy: true, retry: true, error: '伺服器忙碌，請稍後再試' };
  try { return fn(); } finally { lock.releaseLock(); }
}

// ---------- 老師路由：tid ＋ 金鑰 → 該老師的試算表 ----------
var CUR = null;   // 這次請求的老師試算表
function ss_() { return CUR; }
function withTeacher_(p, needKey, fn) {
  var t = teacher_(String(p.tid || ''));
  if (!t) return { ok: false, v: V, code: 'noteacher', error: '找不到這位老師（連結可能不完整）' };
  if (needKey && (!KEY_RE.test(String(p.key || '')) || String(p.key) !== t.key)) return { ok: false, v: V, code: 'badkey', error: '老師金鑰不符，請向管理者重新取得「我的教師頁」連結' };
  if (t.status === '停用') return { ok: false, v: V, code: 'disabled', error: '這位老師的帳號已停用，請洽管理者' };
  CUR = SpreadsheetApp.openById(t.ssId);
  return fn(t);
}
// 依老師編號查老師清單（有快取，學生送出時不用每次讀表）
function teacher_(tid) {
  if (!TID_RE.test(tid)) return null;
  var cache = CacheService.getScriptCache();
  var hit = cache.get('T:' + tid);
  if (hit) return JSON.parse(hit);
  var rows = registryRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].tid === tid) {
    cache.put('T:' + tid, JSON.stringify(rows[i]), CONFIG.CACHE_SEC);
    return rows[i];
  }
  return null;
}

// ---------- 學生送出（GET，讀得到回應）----------
function submit_(p) {
  var r;
  try { r = JSON.parse(String(p.p || '{}')); } catch (err) { return { ok: false, v: V, retry: false, error: '資料格式錯誤' }; }
  var isDouble = r.type === 'double';
  if (!isDouble && r.type !== 'single') return { ok: false, v: V, retry: false, error: '實驗種類錯誤' };
  if (!RID_RE.test(String(r.id || ''))) return { ok: false, v: V, retry: false, error: '紀錄編號錯誤' };
  var tid = String(p.tid || r.tid || '');
  var t = teacher_(tid);
  if (!t) return { ok: false, v: V, retry: false, code: 'noteacher', error: '找不到老師，請向老師重新取得連結' };
  if (t.status === '停用') return { ok: false, v: V, retry: false, code: 'disabled', error: '老師的帳號已停用' };
  var cache = CacheService.getScriptCache();
  var dupKey = 'R:' + tid + ':' + r.id;
  if (cache.get(dupKey)) return { ok: true, v: V, duplicate: true, id: r.id };
  var store = RECORD_STORES[CONFIG.RECORD_STORE];
  var res = store(t, r, isDouble);
  if (res.ok) cache.put(dupKey, '1', 21600);
  return res;
}
// 學生紀錄寫到哪裡（之後要改成 Google 表單或分散到多個帳號，換這裡即可）
var RECORD_STORES = {
  sheet: function (t, r, isDouble) {
    CUR = SpreadsheetApp.openById(t.ssId);
    var gid = classGid_(t.ssId, String(r.classId || ''));
    if (gid === null) return { ok: false, v: V, retry: false, code: 'noclass', error: '找不到這個班級，請向老師重新取得連結' };
    var row = classRow_(r, isDouble);   // 鎖外先組好列、找好分頁；鎖裡只有「查重＋appendRow」
    var sh = sheetByGid_(gid);
    return locked_(function () {
      if (!sh) sh = classSheet_(findRoster_(String(r.classId)));   // 分頁被手動刪掉：照班名重建（少見）
      var last = sh.getLastRow();
      if (last > 1 && sh.getRange(2, COL_RID, last - 1, 1).createTextFinder(String(r.id)).matchEntireCell(true).findNext()) {
        return { ok: true, v: V, duplicate: true, id: r.id };
      }
      sh.appendRow(row);
      return { ok: true, v: V, id: r.id };
    });
  },
  form: function () { throw new Error('預留：改寫進自動建立的 Google 表單（尚未實作）'); },
  shard: function () { throw new Error('預留：依老師分散到其他帳號的接收程式（尚未實作，見老師清單「接收程式網址」欄）'); }
};
function classGid_(ssId, classId) {
  if (!ID_RE.test(classId)) return null;
  var cache = CacheService.getScriptCache(), k = 'G:' + ssId + ':' + classId;
  var hit = cache.get(k);
  if (hit) return Number(hit);
  var c = findRoster_(classId);
  if (!c) return null;
  cache.put(k, String(c.gid), CONFIG.CACHE_SEC);
  return c.gid;
}
function classRow_(r, isDouble) {
  var row = [new Date(), isDouble ? '雙狹縫' : '單狹縫', t_(r.className), t_(r.seat), t_(r.group), t_(r.date), t_(r.photoNo),
    t_(r.slitId), t_(r.colorLabel || r.color), n_(r.lambda0), n_(r.L)];
  if (isDouble) row = row.concat([n_(r.d), n_(r.n), n_(r.total), n_(r.dy), '', '']);
  else row = row.concat(['', '', '', '', n_(r.a), n_(r.W)]);
  return row.concat([n_(r.studentLambda), n_(r.lambdaNm), r.match ? '相符' : '不相符', n_(r.errorPct), t_(r.warning), t_(r.savedAt), t_(r.id)]);
}

// ---------- 管理者（開通頁）----------
function admin_(a, p) {
  var ak = String(p.ak || '');
  if (!KEY_RE.test(ak)) return { ok: false, v: V, code: 'badadmin', error: '管理者金鑰格式錯誤' };
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('ADMIN_KEY');
  if (!saved) {
    if (a !== 'adminHello') return { ok: false, v: V, code: 'badadmin', error: '請先打開開通頁完成第一次連線' };
    return locked_(function () {
      if (props.getProperty('ADMIN_KEY')) return { ok: false, v: V, code: 'adminmismatch', error: '管理者金鑰已由別的瀏覽器登記' };
      props.setProperty('ADMIN_KEY', ak);
      registry_();   // 建好資料夾與老師清單
      return adminList_({ claimed: true });
    });
  }
  if (saved !== ak) return { ok: false, v: V, code: 'adminmismatch', error: '管理者金鑰不符。請用之前存的「管理者連結」打開，或到 Apps Script「專案設定 → 指令碼屬性」複製 ADMIN_KEY 的值貼上。' };
  if (a === 'adminHello' || a === 'adminList') return adminList_({});
  return locked_(function () {
    if (a === 'adminCreate') return adminCreate_(p);
    if (a === 'adminStatus') return adminStatus_(p);
    return { ok: false, v: V, error: '不認得的動作' };
  });
}
function adminList_(extra) {
  var reg = registry_();
  var list = registryRows_().map(function (t) {
    return { tid: t.tid, name: t.name, email: t.email, sheetUrl: t.sheetUrl, key: t.key, status: t.status, share: t.share, exec: t.exec, created: t.created };
  });
  var o = { ok: true, v: V, registryUrl: reg.getUrl(), folderUrl: folder_().getUrl(), teachers: list };
  for (var k in extra) o[k] = extra[k];
  return o;
}
function adminCreate_(p) {
  var email = String(p.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, v: V, error: 'email 格式不對' };
  var name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  var rows = registryRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].email === email && rows[i].status !== '停用') {
    return { ok: true, v: V, existed: true, teacher: rows[i] };   // 同一位老師按兩次不會建兩份
  }
  var tid = 'T' + uid_(10), key = uid_(24);
  var ss = SpreadsheetApp.create(CONFIG.TEACHER_SHEET_PREFIX + (name || email));
  var file = DriveApp.getFileById(ss.getId());
  file.moveTo(folder_());
  var first = ss.getSheets()[0];
  first.setName(SHEET_NOTICE);
  first.getRange(1, 1, NOTICE.length, 1).setValues(NOTICE);
  var share = share_(file, email);
  var now = new Date();
  var t = { tid: tid, name: name, email: email, ssId: ss.getId(), sheetUrl: ss.getUrl(), key: key, status: '', share: share, exec: '', created: now };
  registry_().getSheets()[0].appendRow([tid, t_(name), email, t.ssId, t.sheetUrl, key, '', share, '', now, now]);
  return { ok: true, v: V, teacher: t };
}
function adminStatus_(p) {
  var tid = String(p.tid || '');
  var sh = registry_().getSheets()[0];
  var rows = registryRows_();
  for (var i = 0; i < rows.length; i++) if (rows[i].tid === tid) {
    var st = p.on === '0' ? '停用' : '';
    sh.getRange(rows[i].row, 7, 1, 1).setValues([[st]]);
    sh.getRange(rows[i].row, 11, 1, 1).setValues([[new Date()]]);
    CacheService.getScriptCache().remove('T:' + tid);
    rows[i].status = st;
    return { ok: true, v: V, teacher: rows[i] };
  }
  return { ok: false, v: V, error: '找不到這位老師' };
}
// 分享給老師：用 addEditor／addViewer，Google 會寄一封「已與您共用」的通知信給老師（老師從信裡也能找到試算表）
function share_(file, email) {
  if (CONFIG.SHARE_ROLE === 'reader') file.addViewer(email); else file.addEditor(email);
  return '已分享（Google 已寄通知信）';
}
function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) {} }
  var f = DriveApp.createFolder(CONFIG.FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}
function registry_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('REGISTRY_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) {} }
  var ss = SpreadsheetApp.create(CONFIG.REGISTRY_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder_());
  var sh = ss.getSheets()[0];
  sh.setName('老師清單'); sh.appendRow(HEADERS_REG); sh.setFrozenRows(1);
  props.setProperty('REGISTRY_ID', ss.getId());
  return ss;
}
function registryRows_() {
  var id = PropertiesService.getScriptProperties().getProperty('REGISTRY_ID');
  if (!id) return [];
  var sh = SpreadsheetApp.openById(id).getSheets()[0];
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, HEADERS_REG.length).getValues().map(function (v, i) {
    return { row: i + 2, tid: String(v[0]), name: String(v[1]).replace(/^'/, ''), email: String(v[2]), ssId: String(v[3]), sheetUrl: String(v[4]),
      key: String(v[5]), status: String(v[6] || ''), share: String(v[7] || ''), exec: String(v[8] || ''), created: v[9] };
  }).filter(function (t) { return TID_RE.test(t.tid); });
}
function uid_(n) { var s = ''; while (s.length < n) s += Utilities.getUuid().replace(/-/g, ''); return s.slice(0, n); }

// ---------- 搬到公司帳號（在新帳號的編輯器手動執行一次，見「搬到公司帳號.md」）----------
// 先在指令碼屬性加 OLD_REGISTRY_ID＝舊帳號「老師清單」試算表的 ID（舊帳號要先把整個資料夾分享給新帳號）。
// 每位老師：複製他的試算表到新資料夾（分頁和 gid 照舊）、重新分享給老師、沿用同一個老師編號和金鑰。
// 老師只要改用新的「我的教師頁」連結（開通頁 → 複製連結）；已存在的老師不會重複搬。
function migrateFromOldRegistry() {
  var props = PropertiesService.getScriptProperties();
  var oldId = props.getProperty('OLD_REGISTRY_ID');
  if (!oldId) throw new Error('請先在指令碼屬性加 OLD_REGISTRY_ID');
  var old = SpreadsheetApp.openById(oldId).getSheets()[0];
  var have = {};
  registryRows_().forEach(function (t) { have[t.tid] = true; });
  var reg = registry_().getSheets()[0], n = 0;
  old.getRange(2, 1, Math.max(1, old.getLastRow() - 1), HEADERS_REG.length).getValues().forEach(function (v) {
    var tid = String(v[0]);
    if (!TID_RE.test(tid) || have[tid]) return;
    var copy = DriveApp.getFileById(String(v[3])).makeCopy(CONFIG.TEACHER_SHEET_PREFIX + (v[1] || v[2]), folder_());
    var share = share_(copy, String(v[2]));
    var now = new Date();
    reg.appendRow([tid, v[1], v[2], copy.getId(), copy.getUrl(), v[5], v[6], share, '', v[9] || now, now]);
    n++;
  });
  Logger.log('搬好 ' + n + ' 位老師');
  return n;
}

// ---------- 老師：班級 ----------
function list_(t) {
  var classes = readRoster_().filter(function (c) { return c.status !== '移除'; }).map(publicClass_);
  return { ok: true, v: V, sheetUrl: ss_().getUrl(), teacherName: t.name, classes: classes };
}
function publicClass_(c) { return { id: c.id, name: c.name, gid: c.gid, config: c.config, archived: c.status === '封存' }; }
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
  var sh = ss_().getSheetByName(name);
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
    classSheet_(c).setName(nm.name);
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
  var ss = ss_();
  var sh = classSheet_(c);
  if (status === '') sh.showSheet();
  else if (status === '封存' && !sh.isSheetHidden() && visibleCount_(ss) > 1) sh.hideSheet();  // 至少留一個看得見的分頁
  c.status = status;
  writeRoster_(c);
  return { ok: true, v: V, cls: publicClass_(c) };
}
function visibleCount_(ss) { return ss.getSheets().filter(function (s) { return !s.isSheetHidden(); }).length; }

// ---------- 班級清單分頁 ----------
function readRoster_() {
  var sh = ss_().getSheetByName(SHEET_ROSTER);
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
  var sh = getSheet_(SHEET_ROSTER, HEADERS_ROSTER);
  var values = [c.id, t_(c.name), c.gid, JSON.stringify(c.config || {}), c.status || '', new Date()];
  if (c.row) sh.getRange(c.row, 1, 1, values.length).setValues([values]);
  else { sh.appendRow(values); c.row = sh.getLastRow(); }
}
function sheetByGid_(gid) {
  var all = ss_().getSheets();
  for (var i = 0; i < all.length; i++) if (all[i].getSheetId() === gid) return all[i];
  return null;
}
// 依分頁編號找班級分頁；老師手動刪掉分頁時以班名重建
function classSheet_(c) {
  var sh = sheetByGid_(c.gid);
  if (sh) return sh;
  sh = ss_().getSheetByName(c.name) || getSheet_(c.name, HEADERS_CLASS);
  c.gid = sh.getSheetId();
  writeRoster_(c);
  CacheService.getScriptCache().remove('G:' + ss_().getId() + ':' + c.id);
  return sh;
}

// ---------- 共用 ----------
function getSheet_(name, headers) {
  var ss = ss_();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name, ss.getSheets().length);  // 加在最後面
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
// 文字欄：截斷並防公式注入
function t_(v) { var s = (v === undefined || v === null) ? '' : String(v).slice(0, 100); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function n_(v) { var x = Number(v); return isFinite(x) ? x : ''; }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
