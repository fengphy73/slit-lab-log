// 開通頁（管理者）：連上總程式 → 輸入老師 email → 建好老師試算表並產生「我的教師頁」連結
(function () {
  'use strict';
  var S = window.SlitSettings;
  var KEY = 'slitLabLog.admin.v4';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var st = load();
  var teachers = [];

  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
  function newKey() {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', b = new Uint32Array(32), s = '';
    crypto.getRandomValues(b); for (var i = 0; i < b.length; i++) s += A.charAt(b[i] % A.length);
    return s;
  }
  function page(name) { return new URL(name, location.href).href.split('#')[0].split('?')[0]; }
  // 老師的「我的教師頁」連結（格式和 classrooms.js 的 setupLink 一樣）
  function teacherLink(t) {
    return page('teacher.html') + '#setup=' + S.utf8ToB64Url(JSON.stringify({ u: t.exec || st.url, t: t.tid, k: t.key, n: t.name || '' }));
  }
  function adminLink() { return page('admin.html') + '#admin=' + S.utf8ToB64Url(JSON.stringify({ u: st.url, ak: st.ak })); }
  function copy(text, out, status, msg) {
    if (out) { out.hidden = false; out.value = text; }
    function manual() { if (out) out.select(); try { document.execCommand('copy'); } catch (e) {} status.textContent = msg + '（若沒複製到，請手動複製上面的文字）'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { status.textContent = msg; }, manual);
    else manual();
  }
  function api(action, params, url) {
    var q = new URLSearchParams();
    q.set('action', action); q.set('ak', st.ak);
    Object.keys(params || {}).forEach(function (k) { q.set(k, params[k]); });
    return fetch((url || st.url) + '?' + q.toString(), { redirect: 'follow' }).then(function (res) {
      return res.text().then(function (t) {
        try { return JSON.parse(t); } catch (e) { throw { kind: /<html|<!doctype/i.test(t) ? 'html' : 'notjson' }; }
      });
    }, function () { throw { kind: 'network' }; });
  }
  function errMsg(e, res) {
    if (e && e.kind === 'html') return '收到的是 Google 登入頁：部署時「誰可以存取」要選「所有人」（部署 → 管理部署作業 → 編輯 → 改成所有人 → 部署）。';
    if (e) return '連不上總程式，請檢查網路或網址是否完整。';
    if (res && res.v !== 4) return '這個網址不是總程式 v4（可能貼到舊版的程式網址）。';
    return (res && res.error) || '不明錯誤';
  }
  function show(el, kind, html) { el.hidden = !html; el.className = 'test-result ' + kind; el.innerHTML = html; }

  // ---- 第一次連線 ----
  function connect(url) {
    var f = S.checkScriptUrl(url);
    if (!f.ok) { show($('#connResult'), f.empty ? '' : 'err', f.empty ? '' : esc(f.error)); return; }
    if (!st.ak) st.ak = newKey();
    show($('#connResult'), 'wait', '連線中…');
    api('adminHello', {}, f.url).then(function (res) {
      if (res.ok && res.v === 4) {
        st.url = f.url; save();
        $('#pasteKeyBox').hidden = true;
        show($('#connResult'), 'ok', '✅ <b>連上了！</b>' + (res.claimed ? '這個瀏覽器已登記為管理者，老師清單和資料夾也建好了。' : '') + '請到下方「換電腦：管理者連結」按一下複製，存成書籤。');
        applyList(res); enterMain();
        return;
      }
      if (res.code === 'adminmismatch') $('#pasteKeyBox').hidden = false;
      show($('#connResult'), 'err', esc(errMsg(null, res)));
    }).catch(function (e) { show($('#connResult'), 'err', esc(errMsg(e))); });
  }
  var timer = null;
  $('#execUrl').addEventListener('input', function () { var v = this.value; clearTimeout(timer); timer = setTimeout(function () { connect(v); }, 400); });
  $('#useKey').addEventListener('click', function () {
    var k = $('#adminKeyIn').value.trim();
    if (!/^[A-Za-z0-9]{16,64}$/.test(k)) { show($('#connResult'), 'err', '金鑰格式不對，請整串複製 ADMIN_KEY 的值。'); return; }
    st.ak = k; save(); connect($('#execUrl').value);
  });

  // ---- 主畫面 ----
  function enterMain() {
    ['#createCard', '#listCard', '#adminMore'].forEach(function (s) { $(s).hidden = false; });
    var bar = $('#adminBar'); bar.hidden = false; bar.className = 'conn-bar ok';
    bar.innerHTML = '✅ 已連上總程式。 <button type="button" class="linklike" id="reconnect">換一個總程式網址</button>';
  }
  function applyList(res) {
    teachers = res.teachers || [];
    $('#listCount').textContent = '（' + teachers.length + ' 位）';
    $('#listLinks').innerHTML = (res.registryUrl ? '<a href="' + esc(res.registryUrl) + '" target="_blank" rel="noopener">打開「老師清單」試算表</a>' : '') +
      (res.folderUrl ? '　<a href="' + esc(res.folderUrl) + '" target="_blank" rel="noopener">打開存放資料夾</a>' : '');
    $('#tTable tbody').innerHTML = teachers.length ? teachers.slice().reverse().map(function (t) {
      var off = t.status === '停用';
      return '<tr data-tid="' + esc(t.tid) + '" class="' + (off ? 'off' : '') + '">' +
        '<td><b>' + esc(t.name || '（未填名稱）') + '</b><br>' + esc(t.email) + '</td>' +
        '<td>' + esc(t.created ? new Date(t.created).toLocaleString('zh-TW', { hour12: false }) : '') + '</td>' +
        '<td>' + (off ? '已停用' : '使用中') + '<br><span class="hint">' + esc(t.share || '') + '</span></td>' +
        '<td><button type="button" data-act="link">複製連結</button>' +
        '<a href="' + esc(t.sheetUrl) + '" target="_blank" rel="noopener">打開試算表</a> ' +
        (off ? '<button type="button" data-act="on">重新啟用</button>' : '<button type="button" data-act="off" class="danger">停用</button>') + '</td></tr>';
    }).join('') : '<tr><td colspan="4" class="hint">還沒有開通任何老師。</td></tr>';
  }
  function refresh() {
    return api('adminList').then(function (res) {
      if (res.ok) { applyList(res); enterMain(); return; }
      $('#connectCard').hidden = false; $('#execUrl').value = st.url || '';
      if (res.code === 'adminmismatch') $('#pasteKeyBox').hidden = false;
      show($('#connResult'), 'err', esc(errMsg(null, res)));
    }).catch(function (e) {
      var bar = $('#adminBar'); bar.hidden = false; bar.className = 'conn-bar err';
      bar.textContent = '⚠️ ' + errMsg(e);
    });
  }

  $('#createBtn').addEventListener('click', function () {
    var email = $('#tEmail').value.trim(), name = $('#tName').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show($('#createResult'), 'err', '請填老師的 email。'); return; }
    var btn = this; btn.disabled = true;
    show($('#createResult'), 'wait', '開通中…（建立試算表、分享給老師，約 5～10 秒）');
    api('adminCreate', { email: email, name: name }).then(function (res) {
      if (!res.ok) { show($('#createResult'), 'err', esc(errMsg(null, res))); return; }
      var t = res.teacher, link = teacherLink(t);
      show($('#createResult'), 'ok', '✅ <b>' + (res.existed ? '這位老師之前開通過了' : '開通好了') + '：' + esc(t.name || t.email) + '</b>（' + esc(t.share || '') + '）' +
        '<div class="my-link"><b>老師的「我的教師頁」連結：</b>' +
        '<input type="text" id="newLink" class="link-out" readonly value="' + esc(link) + '" aria-label="老師的教師頁連結">' +
        '<button type="button" id="copyNew" class="primary">複製連結</button>' +
        '<p>請用 email 或 LINE 把這個連結傳給老師。老師打開就能建班級，不用任何設定。連結含老師金鑰，只給那位老師。</p>' +
        '<p class="hint" id="copyNewStatus"></p></div>');
      $('#tEmail').value = ''; $('#tName').value = '';
      refresh();
    }).catch(function (e) { show($('#createResult'), 'err', esc(errMsg(e))); })
      .then(function () { btn.disabled = false; });
  });
  $('#tEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#createBtn').click(); });
  $('#createResult').addEventListener('click', function (e) {
    if (e.target.id === 'copyNew') copy($('#newLink').value, null, $('#copyNewStatus'), '已複製，貼給老師就好。');
  });
  $('#tTable').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]'); if (!b) return;
    var tid = b.closest('tr').getAttribute('data-tid');
    var t = teachers.filter(function (x) { return x.tid === tid; })[0]; if (!t) return;
    var act = b.getAttribute('data-act');
    if (act === 'link') { copy(teacherLink(t), $('#rowLinkOut'), $('#listStatus'), '已複製「' + (t.name || t.email) + '」的教師頁連結。'); return; }
    if (act === 'off' && !confirm('停用「' + (t.name || t.email) + '」？\n停用後他的教師頁和學生都不能再送資料，試算表和資料都保留，之後可以重新啟用。')) return;
    $('#listStatus').textContent = act === 'off' ? '停用中…' : '啟用中…';
    api('adminStatus', { tid: tid, on: act === 'off' ? '0' : '1' }).then(function (res) {
      $('#listStatus').textContent = res.ok ? (act === 'off' ? '已停用。' : '已重新啟用。') : errMsg(null, res);
      refresh();
    }).catch(function (e2) { $('#listStatus').textContent = errMsg(e2); });
  });
  $('#copyAdminLink').addEventListener('click', function () { copy(adminLink(), null, $('#adminLinkStatus'), '已複製「管理者連結」，請存成書籤。'); });
  document.addEventListener('click', function (e) {
    if (e.target.id === 'reconnect') { $('#connectCard').hidden = false; $('#execUrl').value = st.url || ''; $('#execUrl').focus(); }
  });

  $('#copyCode').addEventListener('click', function () {
    var status = $('#copyCodeStatus');
    fetch('apps_script/Code.gs?v=v4a').then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (text) {
      return navigator.clipboard.writeText(text).then(function () { status.textContent = '已複製（開頭寫「總程式 v4」），到 Apps Script 編輯器全選後貼上、存檔。'; });
    }).catch(function () { status.textContent = '無法自動複製，請打開網站的 apps_script/Code.gs 全選複製。'; });
  });

  // ---- 啟動 ----
  var m = /(?:^|[#&])admin=([A-Za-z0-9_-]+)/.exec(location.hash || '');
  if (m) {
    try { var o = JSON.parse(S.b64UrlToUtf8(m[1])); if (S.checkScriptUrl(o.u).ok && /^[A-Za-z0-9]{16,64}$/.test(o.ak || '')) { st.url = S.checkScriptUrl(o.u).url; st.ak = o.ak; save(); } } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
  }
  if (st.url && st.ak) refresh();
  else $('#connectCard').hidden = false;
})();
