/**
 * 狹縫干涉繞射實驗紀錄 — 接收端（Google Apps Script，綁定在老師自己的試算表）
 * 網頁以表單 POST 送來參數 payload（JSON 字串），每筆附伺服器時間戳寫入對應工作表。
 */
var SHEET_DOUBLE = '雙狹縫';
var SHEET_SINGLE = '單狹縫';

var HEADERS_DOUBLE = ['收到時間', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', '狹縫間距d(mm)',
  '量了幾個間距n', 'L(mm)', '第0條到第n條亮紋總長(mm)', 'Δy(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];
var HEADERS_SINGLE = ['收到時間', '姓名', '班級', '座號', '組別', '日期', '照片編號', '狹縫片編號', '雷射顏色', '標示波長λ0(nm)', '縫寬a(mm)',
  'L(mm)', 'W(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '學生端儲存時間', '紀錄編號'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var r = JSON.parse((e && e.parameter && e.parameter.payload) || '{}');
    var isDouble = r.type === 'double';
    if (!isDouble && r.type !== 'single') return out_({ ok: false, error: 'type 錯誤' });
    var sheet = getSheet_(isDouble ? SHEET_DOUBLE : SHEET_SINGLE, isDouble ? HEADERS_DOUBLE : HEADERS_SINGLE);
    if (r.id && isDuplicate_(sheet, r.id)) return out_({ ok: true, duplicate: true }); // 重送不重複寫入
    var row = [new Date(), t_(r.name), t_(r.className), t_(r.seat), t_(r.group), t_(r.date), t_(r.photoNo), t_(r.slitId),
      t_(r.colorLabel || r.color), n_(r.lambda0)];
    if (isDouble) {
      row = row.concat([n_(r.d), n_(r.n), n_(r.L), n_(r.total), n_(r.dy)]);
    } else {
      row = row.concat([n_(r.a), n_(r.L), n_(r.W)]);
    }
    row = row.concat([n_(r.studentLambda), n_(r.lambdaNm), r.match ? '相符' : '不相符', n_(r.errorPct), t_(r.warning), t_(r.savedAt), t_(r.id)]);
    sheet.appendRow(row);
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return out_({ ok: true, msg: '狹縫實驗紀錄接收端運作中' }); }

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
