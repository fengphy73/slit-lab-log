// 狹縫干涉繞射實驗紀錄 — 網頁互動
(function () {
  'use strict';
  var C = window.SlitCalc;
  var KEY_RECORDS = 'slitLabLog.records.v2';
  var KEY_BASIC = 'slitLabLog.basic.v1';
  var SCRIPT_URL = (typeof TEACHER_SCRIPT_URL === 'string') ? TEACHER_SCRIPT_URL.trim() : '';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var fmt = function (v, n) { return Number(v).toFixed(n); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };

  function fillColorLabels() {
    var refs = C.getLaserRefs(), labels = C.getLaserLabels();
    $$('[data-color-label]').forEach(function (el) {
      var c = el.getAttribute('data-color-label');
      el.textContent = (labels[c] || c) + '（' + refs[c] + ' nm）';
    });
  }

  // ---- 本機儲存 ----
  function loadRecords() { try { return JSON.parse(localStorage.getItem(KEY_RECORDS)) || []; } catch (e) { return []; } }
  function saveRecords(list) { localStorage.setItem(KEY_RECORDS, JSON.stringify(list)); }

  // ---- 基本資料 ----
  var basicIds = ['className', 'seat', 'group', 'date'];
  function getBasic() { var b = {}; basicIds.forEach(function (id) { b[id] = $('#' + id).value.trim(); }); return b; }
  function initBasic() {
    var saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY_BASIC)) || {}; } catch (e) {}
    basicIds.forEach(function (id) {
      var el = $('#' + id);
      if (saved[id]) el.value = saved[id];
      el.addEventListener('input', function () { localStorage.setItem(KEY_BASIC, JSON.stringify(getBasic())); renderCompareAndHint(); });
    });
    if (!$('#date').value) {
      var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      $('#date').value = d.toISOString().slice(0, 10);
    }
  }

  // ---- 讀取分頁輸入 ----
  function readPanel(panel) {
    var o = {};
    $$('input[data-f]', panel).forEach(function (el) {
      var f = el.dataset.f;
      if (el.type === 'radio') { if (el.checked) o[f] = el.value; return; }
      o[f] = el.value;
    });
    return o;
  }
  function compute(type, inp) { return type === 'double' ? C.calcDouble(inp) : C.calcSingle(inp); }
  function verify(type, inp) { return type === 'double' ? C.verifyDouble(inp) : C.verifySingle(inp); }

  function markBad(panel) {
    $$('input[data-f]', panel).forEach(function (el) {
      if (el.dataset.f === 'photoNo' || el.type === 'radio') return;
      if (el.dataset.f === 'n') {
        el.classList.toggle('bad', el.value.trim() !== '' && !C.parseCountN(el.value).ok);
        return;
      }
      el.classList.toggle('bad', el.value.trim() !== '' && !C.parsePositive(el.value, '').ok);
    });
  }

  function updateNLabel(panel) {
    var parsed = C.parseCountN(readPanel(panel).n);
    var nText = parsed.ok ? String(parsed.value) : 'n';
    $$('[data-n-label]', panel).forEach(function (el) { el.textContent = nText; });
  }

  function renderIdle(panel) {
    var type = panel.dataset.type, inp = readPanel(panel), box = $('.result', panel);
    markBad(panel);
    var meas = compute(type, inp);
    var hasStudent = String(inp.studentLambda || '').trim() !== '';
    if (!meas.ok) {
      // 尚未填齊時用簡短提示，不列出每一個「請填寫」，以免未開始就一大串紅字
      var missingOnly = meas.errors.every(function (e) { return /請填寫$|請選擇$/.test(e); });
      if (missingOnly && !hasAnyMeas(inp, type)) {
        box.innerHTML = '<div>請選擇雷射顏色、填寫量測數據與你算出的波長，再按「核對」。</div>';
      } else {
        box.innerHTML = '<div>尚未核對，請檢查：</div><ul>' + meas.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      }
      return;
    }
    if (!hasStudent) {
      box.innerHTML = '<div>量測數據已齊，請填寫你算出的波長，再按「核對」。</div>';
      return;
    }
    var s = C.parsePositive(inp.studentLambda, '你算出的波長');
    if (!s.ok) {
      box.innerHTML = '<div>尚未核對，請檢查：</div><ul><li>' + esc(s.error) + '</li></ul>';
      return;
    }
    box.innerHTML = '<div>請按「核對」查看正確算法與結果。</div>';
  }

  function hasAnyMeas(inp, type) {
    if (inp.color || String(inp.studentLambda || '').trim()) return true;
    if (String(inp.L || '').trim()) return true;
    if (type === 'double') return String(inp.d || '').trim() !== '' || String(inp.total || '').trim() !== '';
    return String(inp.a || '').trim() !== '' || String(inp.W || '').trim() !== '';
  }
  function renderVerified(panel, r) {
    var box = $('.result', panel);
    if (!r.ok) {
      box.innerHTML = '<div>尚未核對，請檢查：</div><ul>' + r.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
      return r;
    }
    var h = '<div class="steps-title">正確算法（代入你的量測值）</div>';
    h += '<ul class="steps">' + r.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
    h += '<div>你算出的波長：' + fmt(r.studentLambda, 1) + ' nm</div>';
    h += '<div class="big">正確結果：' + fmt(r.lambdaNm, 1) + ' nm</div>';
    if (r.match) h += '<div class="ok">✓ 相符（允許 ±' + r.matchTolPct + '% 的四捨五入誤差）</div>';
    else h += '<div class="ng">✗ 不相符（允許 ±' + r.matchTolPct + '% 的四捨五入誤差）</div>';
    h += '<div>相對' + esc(r.colorLabel) + '參考值 ' + r.lambda0 + ' nm，誤差 = ' + fmt(r.errorPct, 2) + ' %</div>';
    if (r.warning) h += '<div class="warn">⚠️ ' + esc(r.warning) + '</div>';
    h += otherColorHint(panel, r);
    box.innerHTML = h;
    return r;
  }

  function otherColorHint(panel, r) {
    var basic = getBasic();
    var list = loadRecords().filter(function (rec) {
      return rec.type === panel.dataset.type && rec.color && rec.className === basic.className &&
        ((basic.group && rec.group === basic.group) || (basic.seat && rec.seat === basic.seat));
    });
    var hasOther = list.some(function (rec) { return rec.color !== r.color; });
    if (hasOther) return '';
    var other = r.color === 'red' ? '綠光' : '紅光';
    return '<p class="hint">同一組再記一筆' + other + '的紀錄，就可以比較紅光和綠光的波長。</p>';
  }

  function onFormChange(panel) {
    panel.dataset.checked = '';
    updateNLabel(panel);
    renderIdle(panel);
  }

  function checkPanel(panel) {
    var inp = readPanel(panel);
    markBad(panel);
    var r = verify(panel.dataset.type, inp);
    if (r.ok) panel.dataset.checked = '1';
    else panel.dataset.checked = '';
    renderVerified(panel, r);
    return r;
  }

  // ---- 儲存一筆 ----
  function saveRecord(panel) {
    var basic = getBasic(), inp = readPanel(panel);
    basic.photoNo = inp.photoNo || '';
    var vb = C.validateBasic(basic);
    var ul = $('#basicErrors');
    ul.innerHTML = vb.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('');
    var r = checkPanel(panel);
    if (!vb.ok) { $('#basic').scrollIntoView({ behavior: 'smooth' }); return; }
    if (!r.ok) { alert('量測資料或你算出的波長有誤，請先修正再儲存。'); return; }
    var type = panel.dataset.type;
    var rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: type, savedAt: new Date().toISOString(), status: 'local',
      className: basic.className, seat: basic.seat, group: basic.group, date: basic.date,
      photoNo: (inp.photoNo || '').trim(),
      color: r.color, colorLabel: r.colorLabel, lambda0: r.lambda0,
      L: r.L, studentLambda: r.studentLambda, lambdaNm: r.lambdaNm,
      match: r.match, errorPct: r.errorPct, warning: r.warning
    };
    if (type === 'double') { rec.d = r.d; rec.n = r.n; rec.total = r.total; rec.dy = r.dy; }
    else { rec.a = r.a; rec.W = r.W; }
    var list = loadRecords(); list.unshift(rec); saveRecords(list);
    renderList();
    // 儲存後再畫一次結果，讓「再記一筆另一色」或比較提示更新
    renderVerified(panel, r);
    $('#sendStatus').textContent = '已儲存在這台裝置。';
  }

  // ---- 紀錄列表與紅綠比較 ----
  var TYPE_NAME = { double: '雙狹縫', single: '單狹縫' };
  var ST_NAME = { local: '未送出', sent: '已送出', failed: '送出失敗（可重送）' };
  function longerText(cmp) {
    if (cmp.longer === 'equal') return '兩個波長一樣長';
    return (cmp.longer === 'red' ? '紅光' : '綠光') + '波長比較長';
  }
  function renderCompareAndHint() {
    var box = $('#compareBox');
    var pairs = C.findColorPairs(loadRecords());
    if (!pairs.length) { box.innerHTML = ''; return; }
    box.innerHTML = pairs.map(function (p) {
      var who = '班級 ' + esc(p.className) + (p.seat ? '　座號 ' + esc(p.seat) : '') + (p.group ? '　組別 ' + esc(p.group) : '');
      var c = p.compare;
      return '<div class="compare">' +
        '<h3>這一組的' + TYPE_NAME[p.type] + '比較</h3>' +
        '<div class="meta">' + who + '</div>' +
        '<div>紅光 λ = ' + fmt(c.redLambda, 1) + ' nm</div>' +
        '<div>綠光 λ = ' + fmt(c.greenLambda, 1) + ' nm</div>' +
        '<div>綠/紅比值 = ' + fmt(c.ratio, 3) + '</div>' +
        '<div class="big">' + longerText(c) + '</div>' +
        '</div>';
    }).join('');
  }
  function renderList() {
    var list = loadRecords(), box = $('#recordList');
    renderCompareAndHint();
    if (!list.length) { box.innerHTML = '<p class="hint">還沒有紀錄。</p>'; return; }
    box.innerHTML = list.map(function (r) {
      var who = '班級 ' + esc(r.className) + (r.seat ? '　座號 ' + esc(r.seat) : '') + (r.group ? '　組別 ' + esc(r.group) : '');
      var matched = r.match ? '<span class="st sent">相符</span>' : '<span class="st failed">不相符</span>';
      return '<div class="rec" data-id="' + esc(r.id) + '">' +
        '<div><b>' + TYPE_NAME[r.type] + '　' + esc(r.colorLabel || r.color) + '</b>　你的答案 ' + fmt(r.studentLambda, 1) + ' nm　正確 ' + fmt(r.lambdaNm, 1) + ' nm　' + matched +
        '　誤差 ' + fmt(r.errorPct, 2) + ' %' +
        (r.warning ? '　<span style="color:#b35c00">⚠️</span>' : '') + '</div>' +
        '<div class="meta">' + who + '　' + esc(r.date) + (r.photoNo ? '　照片 ' + esc(r.photoNo) : '') + '</div>' +
        '<div><span class="st ' + r.status + '">' + ST_NAME[r.status] + '</span></div>' +
        '<div style="margin-top:4px">' + (r.status !== 'sent' && SCRIPT_URL ? '<button data-act="send">送出這筆</button>' : '') +
        '<button data-act="del">刪除</button></div></div>';
    }).join('');
  }

  // ---- 送出給老師（Google Apps Script，no-cors 表單 POST）----
  function sendOne(rec) {
    var body = new URLSearchParams();
    body.append('payload', JSON.stringify(rec));
    // no-cors 拿不到回應內容：fetch 成功回來視為「已送出」，網路錯誤則視為失敗
    return fetch(SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: body });
  }
  function sendRecords(ids) {
    if (!SCRIPT_URL) return;
    if (!navigator.onLine) { $('#sendStatus').textContent = '目前沒有網路，資料仍保留在這台裝置，連上網路後再按一次送出。'; return; }
    var list = loadRecords();
    var todo = list.filter(function (r) { return ids ? ids.indexOf(r.id) >= 0 : r.status !== 'sent'; });
    if (!todo.length) { $('#sendStatus').textContent = '沒有需要送出的紀錄。'; return; }
    $('#sendStatus').textContent = '送出中…';
    var ok = 0, fail = 0;
    var chain = Promise.resolve();
    todo.forEach(function (rec) {
      chain = chain.then(function () {
        return sendOne(rec).then(function () { rec.status = 'sent'; rec.sentAt = new Date().toISOString(); ok++; },
                                 function () { rec.status = 'failed'; fail++; });
      });
    });
    chain.then(function () {
      saveRecords(list); renderList();
      $('#sendStatus').textContent = '送出完成：成功 ' + ok + ' 筆' + (fail ? '，失敗 ' + fail + ' 筆（已保留在本機，可再按送出重送）' : '') + '。';
    });
  }

  // ---- CSV ----
  function downloadCSV() {
    var list = loadRecords();
    if (!list.length) { alert('還沒有紀錄可以下載。'); return; }
    var headers = ['實驗', '班級', '座號', '組別', '日期', '照片編號', '雷射顏色', '標示波長λ0(nm)', '狹縫間距d(mm)', '縫寬a(mm)',
      'L(mm)', '量了幾個間距n', '第0條到第n條亮紋總長(mm)', 'Δy(mm)', 'W(mm)', '學生算出的波長(nm)', '正確波長λ(nm)', '答案相符', '誤差(%)', '警告', '儲存時間', '送出狀態'];
    var rows = list.map(function (r) {
      var D = r.type === 'double';
      return [TYPE_NAME[r.type], r.className, r.seat, r.group, r.date, r.photoNo, r.colorLabel || r.color, r.lambda0,
        D ? r.d : '', D ? '' : r.a, r.L, D ? r.n : '', D ? r.total : '', D ? fmt(r.dy, 4) : '', D ? '' : r.W,
        fmt(r.studentLambda, 1), fmt(r.lambdaNm, 1), r.match ? '相符' : '不相符', fmt(r.errorPct, 2), r.warning || '',
        new Date(r.savedAt).toLocaleString('zh-TW', { hour12: false }), ST_NAME[r.status]];
    });
    var blob = new Blob([C.toCSV(headers, rows)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '狹縫實驗紀錄_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---- 分頁 ----
  function showTab(name) {
    $$('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    $$('.panel').forEach(function (p) { p.hidden = p.dataset.type !== name; });
  }

  // ---- 初始化 ----
  fillColorLabels();
  initBasic();
  $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); history.replaceState(null, '', '#' + b.dataset.tab); }); });
  showTab(location.hash === '#single' ? 'single' : 'double');
  $$('.panel').forEach(function (p) {
    $$('input', p).forEach(function (el) {
      el.addEventListener('input', function () { onFormChange(p); });
      el.addEventListener('change', function () { onFormChange(p); });
    });
    $('.check', p).addEventListener('click', function () { checkPanel(p); });
    $('.save', p).addEventListener('click', function () { saveRecord(p); });
    $('.clear', p).addEventListener('click', function () {
      ['L', 'total', 'W', 'studentLambda', 'photoNo'].forEach(function (f) {
        $$('input[data-f="' + f + '"]', p).forEach(function (el) { el.value = ''; el.classList.remove('bad'); });
      });
      $$('input[data-f="n"]', p).forEach(function (el) { el.value = '10'; el.classList.remove('bad'); });
      p.dataset.checked = '';
      updateNLabel(p);
      renderIdle(p);
    });
    updateNLabel(p);
    renderIdle(p);
  });
  var sendBtn = $('#sendAll');
  if (!SCRIPT_URL) { sendBtn.disabled = true; sendBtn.textContent = '尚未設定老師的試算表'; }
  sendBtn.addEventListener('click', function () { sendRecords(null); });
  $('#downloadCsv').addEventListener('click', downloadCSV);
  $('#recordList').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    var id = btn.closest('.rec').dataset.id;
    if (btn.dataset.act === 'del') {
      if (!confirm('確定刪除這筆紀錄？刪除後無法復原。')) return;
      saveRecords(loadRecords().filter(function (r) { return r.id !== id; })); renderList();
    } else if (btn.dataset.act === 'send') sendRecords([id]);
  });
  renderList();
})();
