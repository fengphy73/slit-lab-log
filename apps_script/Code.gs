/**
 * 狹縫干涉繞射實驗紀錄 — 接收端 v2（Google Apps Script，綁定在老師自己的試算表）
 * 網頁以表單 POST 送來參數 payload（JSON 字串），每筆附伺服器時間戳寫入對應工作表。
 * v2：
 *  - 沒有課堂代碼的紀錄（舊連結）照舊寫入「雙狹縫」「單狹縫」。
 *  - 有課堂代碼的紀錄寫入各課堂的分頁，例如「301 基礎版-雙狹縫」。
 *  - 教師頁儲存課堂時送 action=saveClass，設定存在「課堂設定」分頁；學生短連結用 GET ?action=config&c=代碼 讀回。
 *  - 第一次 saveClass 會記下老師金鑰（專案設定 → 指令碼屬性 TEACHER_KEY），之後金鑰不同就拒絕修改。
 */
var SHEET_DOUBLE = '雙狹縫';
var SHEET_SINGLE = '單狹縫';
var SHEET_CLASSES = '課堂設定';

var HEADERS_DOUBLE = ['收到時間', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', '狹縫間距d(mm)',
  '量了幾個間距n', 'L(mm)', '第0條到第n條亮紋總長(mm)', 'Δy(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
var HEADERS_SINGLE = ['收到時間', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', '縫寬a(mm)',
  'L(mm)', 'W(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
var HEADERS_CLASSES = ['課堂代碼', '課堂名稱', '設定(JSON)', '更新時間'];
var CODE_RE = /^[2-9A-HJKMNP-Z]{4,6}$/;

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var r = JSON.parse((e && e.parameter && e.parameter.payload) || '{}');
    if (r.action === 'saveClass') return out_(saveClass_(r));
    var isDouble = r.type === 'double';
    if (!isDouble && r.type !== 'single') return out_({ ok: false, error: 'type 錯誤' });
    var base = isDouble ? SHEET_DOUBLE : SHEET_SINGLE;
    var headers = isDouble ? HEADERS_DOUBLE : HEADERS_SINGLE;
    var code = CODE_RE.test(String(r.classCode || '')) ? String(r.classCode) : '';
    var sheet;
    if (code) {
      var found = findClass_(code);
      var cname = (found && found.name) || r.classroomName || code;
      // 課堂分頁多一欄「課堂代碼」，放在「紀錄編號」前面（紀錄編號維持最後一欄，供重複檢查）
      sheet = getSheet_(classTab_(cname, base), headers.slice(0, -1).concat(['課堂代碼', headers[headers.length - 1]]));
    } else {
      sheet = getSheet_(base, headers);
    }
    if (r.id && isDuplicate_(sheet, r.id)) return out_({ ok: true, duplicate: true }); // 重送不重複寫入
    var row = [new Date(), t_(r.name), t_(r.className), t_(r.seat), t_(r.group), t_(r.date), t_(r.photoNo), t_(r.slitId),
      t_(r.colorLabel || r.color), n_(r.lambda0)];
    if (isDouble) {
      row = row.concat([n_(r.d), n_(r.n), n_(r.L), n_(r.total), n_(r.dy)]);
    } else {
      row = row.concat([n_(r.a), n_(r.L), n_(r.W)]);
    }
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

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'config') {
    var code = String(p.c || '');
    var found = CODE_RE.test(code) ? findClass_(code) : null;
    if (!found) return out_({ ok: false, error: '找不到這個課堂代碼' });
    var config = null;
    try { config = JSON.parse(found.config); } catch (err) { return out_({ ok: false, error: '課堂設定損壞' }); }
    return out_({ ok: true, code: code, name: found.name, config: config, updated: found.updated });
  }
  return out_({ ok: true, msg: '狹縫實驗紀錄接收端運作中', v: 2 });
}

// 教師頁儲存課堂：檢查老師金鑰後，新增或更新「課堂設定」分頁的一列
function saveClass_(r) {
  var code = String(r.code || '');
  if (!CODE_RE.test(code)) return { ok: false, error: '課堂代碼格式錯誤' };
  var key = String(r.key || '');
  if (!/^[A-Za-z0-9]{16,64}$/.test(key)) return { ok: false, error: '老師金鑰格式錯誤' };
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('TEACHER_KEY');
  if (!saved) props.setProperty('TEACHER_KEY', key);
  else if (saved !== key) return { ok: false, error: '老師金鑰不符，不能修改課堂設定' };
  var config = JSON.stringify(r.config || {});
  if (config.length > 20000) return { ok: false, error: '設定太大' };
  var sh = getSheet_(SHEET_CLASSES, HEADERS_CLASSES);
  var values = [code, t_(String(r.name || '').slice(0, 40)), config, new Date()];
  var rowNo = findClassRow_(sh, code);
  if (rowNo) sh.getRange(rowNo, 1, 1, values.length).setValues([values]);
  else sh.appendRow(values);
  return { ok: true, code: code };
}

function findClassRow_(sh, code) {
  var last = sh.getLastRow(); if (last < 2) return 0;
  var codes = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < codes.length; i++) if (String(codes[i][0]) === code) return i + 2;
  return 0;
}
function findClass_(code) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLASSES);
  if (!sh) return null;
  var rowNo = findClassRow_(sh, code);
  if (!rowNo) return null;
  var v = sh.getRange(rowNo, 1, 1, 4).getValues()[0];
  return { code: code, name: String(v[1]).replace(/^'/, ''), config: String(v[2]), updated: v[3] };
}
// 分頁名稱：去掉試算表不允許的字元、限制長度
function classTab_(name, suffix) {
  var s = String(name || '').replace(/[\[\]\*\?\/\\:]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return (s || '課堂') + '-' + suffix;
}

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
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
