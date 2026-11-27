// 老師頁：課堂清單（每個班級或版本一張卡片）
(function () {
  'use strict';
  var S = window.SlitSettings;
  var SC = window.SlitClassrooms;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var store = SC.load();
  var editingCode = null;
  var syncing = {};

  function save() { SC.save(store); }
  function pageUrl(name) { return new URL(name, location.href).href.split('#')[0].split('?')[0]; }
  function nameTaken(name, exceptCode) {
    return store.classrooms.some(function (c) { return c.name === name && c.code !== exceptCode; });
  }
  function showErrors(ul, errors) { ul.innerHTML = (errors || []).map(function (e) { return '<li>' + esc(e) + '</li>'; }).join(''); }
  function copyText(text, box, status, okMsg) {
    if (box) { box.hidden = false; box.value = text; }
    function manual() { if (box) box.select(); try { document.execCommand('copy'); } catch (e) {} status.textContent = okMsg + '（若沒複製到，請手動複製上面的文字）'; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { status.textContent = okMsg; }, manual);
    else manual();
  }

  // ---- 狹縫設定編輯器（沿用原本的表單）----
  function slitHintText() {
    var el = $('#slitHintText');
    return (el && el.textContent) || (S && S.HINT_SLIT_UNIT) || '';
  }
  function addSlitRow(data) {
    data = data || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="text" data-k="id" placeholder="例：1" maxlength="30"></td>' +
      '<td><select data-k="type">' +
        '<option value="double">雙狹縫 d</option>' +
        '<option value="single">單狹縫 a</option>' +
      '</select></td>' +
      '<td><input type="text" data-k="value" inputmode="decimal" placeholder="例：0.20">' +
        '<p class="soft-hint" data-slit-hint hidden></p></td>' +
      '<td><select data-k="level">' +
        '<option value="">（不標）</option>' +
        '<option value="suggest">建議使用</option>' +
        '<option value="advanced">進階</option>' +
      '</select></td>' +
      '<td><button type="button" class="del-row">刪除</button></td>';
    if (data.id) tr.querySelector('[data-k="id"]').value = data.id;
    if (data.type) tr.querySelector('[data-k="type"]').value = data.type;
    if (data.value != null && data.value !== '') tr.querySelector('[data-k="value"]').value = String(data.value);
    if (data.level) tr.querySelector('[data-k="level"]').value = data.level;
    tr.querySelector('.del-row').addEventListener('click', function () { tr.parentNode.removeChild(tr); refreshHints(); });
    $$('input, select', tr).forEach(function (el) { el.addEventListener('input', refreshHints); });
    $('#slitTable tbody').appendChild(tr);
    refreshHints();
  }
  function setHint(el, text) {
    if (!el) return;
    if (text) { el.hidden = false; el.textContent = text; } else { el.hidden = true; }
  }
  function refreshHints() {
    setHint($('[data-lambda-hint="red"]'), S.laserLambdaHint($('#lambdaRed').value));
    setHint($('[data-lambda-hint="green"]'), S.laserLambdaHint($('#lambdaGreen').value));
    var msg = slitHintText();
    $$('#slitTable tbody tr').forEach(function (tr) {
      var text = S.slitValueHint($('[data-k="value"]', tr).value);
      setHint($('[data-slit-hint]', tr), text ? (msg || text) : '');
    });
  }
  function readForm() {
    var lasers = [];
    if ($('#laserRed').checked) lasers.push({ color: 'red', lambda0: $('#lambdaRed').value });
    if ($('#laserGreen').checked) lasers.push({ color: 'green', lambda0: $('#lambdaGreen').value });
    var experiments = [];
    if ($('#expDouble').checked) experiments.push('double');
    if ($('#expSingle').checked) experiments.push('single');
    return {
      lasers: lasers, experiments: experiments, suggestedL: $('#suggestedL').value,
      slits: $$('#slitTable tbody tr').map(function (tr) {
        return { id: $('[data-k="id"]', tr).value, type: $('[data-k="type"]', tr).value,
          value: $('[data-k="value"]', tr).value, level: $('[data-k="level"]', tr).value };
      })
    };
  }
  function fillForm(cfg) {
    cfg = S.normalize(cfg || {});
    var red = null, green = null;
    cfg.lasers.forEach(function (L) { if (L.color === 'red') red = L; if (L.color === 'green') green = L; });
    $('#laserRed').checked = !!red; $('#lambdaRed').value = red ? red.lambda0 : '650';
    $('#laserGreen').checked = !!green; $('#lambdaGreen').value = green ? green.lambda0 : '532';
    $('#expDouble').checked = cfg.experiments.indexOf('double') >= 0;
    $('#expSingle').checked = cfg.experiments.indexOf('single') >= 0;
    $('#suggestedL').value = cfg.suggestedL || 1000;
    $('#slitTable tbody').innerHTML = '';
    if (cfg.slits.length) cfg.slits.forEach(addSlitRow); else addSlitRow();
    refreshHints();
  }
  function openEditor(code) {
    var cls = SC.findClass(store, code);
    if (!cls) return;
    editingCode = code;
    $('#editorTitle').textContent = '編輯課堂：' + cls.name;
    $('#className').value = cls.name;
    fillForm(cls.config);
    showErrors($('#editErrors'), []);
    $('#editor').hidden = false;
    $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function saveEditor() {
    var cls = SC.findClass(store, editingCode);
    if (!cls) return;
    var name = $('#className').value.trim();
    var errors = [];
    if (!name) errors.push('請填課堂名稱');
    else if (nameTaken(name, cls.code)) errors.push('已經有叫「' + name + '」的課堂，請換個名稱（數據分頁用名稱區分）');
    var v = S.validateForGenerate(readForm());
    if (!v.ok) errors = errors.concat(v.errors);
    if (errors.length) { showErrors($('#editErrors'), errors); return; }
    cls.name = name;
    cls.config = SC.cleanConfig(v.settings);
    cls.synced = false;
    save();
    $('#editor').hidden = true;
    editingCode = null;
    render();
    syncClass(cls);
    var card = $('.class-card[data-code="' + cls.code + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---- 同步到老師的試算表（新版 Code.gs）----
  function syncClass(cls) {
    var url = store.teacher.scriptUrl;
    if (!S.deploymentId(url)) return;
    syncing[cls.code] = true; render();
    var body = new URLSearchParams();
    body.append('payload', JSON.stringify(SC.savePayload(store, cls)));
    var sent = JSON.stringify(SC.savePayload(store, cls).config);
    fetch(url, { method: 'POST', mode: 'no-cors', body: body }).then(function () {
      // no-cors 看不到結果，再讀回來確認真的存進去了
      return fetch(url + '?action=config&code=' + cls.code).then(function (r) { return r.json(); });
    }).then(function (res) {
      cls.synced = !!(res && res.ok && res.config && JSON.stringify(res.config) === sent);
    }, function () { cls.synced = false; }).then(function () {
      delete syncing[cls.code]; save(); render();
    });
  }
  function syncAll() {
    store.classrooms.forEach(function (c) { c.synced = false; });
    save(); render();
    store.classrooms.forEach(syncClass);
  }

  // ---- 卡片 ----
  function summary(cfg) {
    function list(type) {
      return cfg.slits.filter(function (s) { return s.type === type; }).map(function (s) {
        return S.formatSlitValue(s.value) + (s.level === 'suggest' ? '（建議）' : s.level === 'advanced' ? '（進階）' : '');
      }).join('、') || '自己填';
    }
    var parts = [];
    if (cfg.experiments.indexOf('double') >= 0) parts.push('雙縫 d：' + list('double') + ' mm');
    if (cfg.experiments.indexOf('single') >= 0) parts.push('單縫 a：' + list('single') + ' mm');
    var lasers = cfg.lasers.map(function (L) { return (L.color === 'red' ? '紅光 ' : '綠光 ') + L.lambda0 + ' nm'; }).join('／');
    return esc(parts.join('　')) + '<br>' + esc(lasers + '　L ' + cfg.suggestedL + ' mm');
  }
  function statusText(cls) {
    if (!store.teacher.scriptUrl) return '尚未設定試算表：學生連結是長連結，紀錄只存在學生手機（可下載 CSV）。';
    if (!S.deploymentId(store.teacher.scriptUrl)) return '這個 Apps Script 網址格式無法做短連結，先用長連結；資料照樣送到試算表。';
    if (syncing[cls.code]) return '正在同步到試算表…';
    if (cls.synced) return '已同步到試算表，使用短連結。數據在「' + cls.name + '-雙狹縫」「' + cls.name + '-單狹縫」分頁。';
    return '尚未同步到試算表（請確認已貼上新版 Code.gs 並部署新版本），先用長連結，資料照樣送到試算表。';
  }
  function render() {
    var box = $('#classList');
    $('#listEmpty').hidden = store.classrooms.length > 0;
    box.innerHTML = store.classrooms.map(function (c) {
      var needSync = store.teacher.scriptUrl && S.deploymentId(store.teacher.scriptUrl) && !c.synced && !syncing[c.code];
      return '<div class="card class-card" data-code="' + esc(c.code) + '">' +
        '<div class="cc-head"><h3>' + esc(c.name) + '</h3><span class="cc-code">代碼 ' + esc(c.code) + '</span></div>' +
        '<p class="cc-sum">' + summary(c.config) + '</p>' +
        '<div class="cc-main">' +
          '<button type="button" class="primary" data-act="slides">開啟簡報</button>' +
          '<button type="button" data-act="copy">複製學生連結</button>' +
          '<button type="button" data-act="data">看數據</button>' +
        '</div>' +
        '<input type="text" class="cc-link" readonly hidden aria-label="學生連結">' +
        '<p class="hint cc-status">' + esc(statusText(c)) +
          (needSync ? ' <button type="button" class="linklike" data-act="sync">再同步一次</button>' : '') + '</p>' +
        '<div class="cc-more">' +
          '<button type="button" data-act="edit">編輯</button>' +
          '<button type="button" data-act="dup">複製成新課堂</button>' +
          '<button type="button" data-act="del" class="danger">刪除</button>' +
        '</div></div>';
    }).join('');
  }
  $('#classList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var card = btn.closest('.class-card');
    var cls = SC.findClass(store, card.getAttribute('data-code'));
    if (!cls) return;
    var act = btn.getAttribute('data-act');
    var status = $('.cc-status', card);
    if (act === 'slides') {
      var s = SC.linkFor(store, cls, pageUrl('slides.html'));
      if (s.ok) window.open(s.url, '_blank');
      else status.textContent = s.errors.join('；');
    } else if (act === 'copy') {
      var l = SC.linkFor(store, cls, pageUrl('index.html'));
      if (l.ok) copyText(l.url, $('.cc-link', card), status, '已複製「' + cls.name + '」的學生連結' + (l.short ? '（短連結）' : '（長連結）') + '。');
      else status.textContent = l.errors.join('；');
    } else if (act === 'data') {
      openData(cls, status);
    } else if (act === 'edit') {
      openEditor(cls.code);
    } else if (act === 'dup') {
      openAdd(cls.code);
    } else if (act === 'del') {
      if (!confirm('確定刪除「' + cls.name + '」？\n已經發給學生的連結與試算表裡的數據不會被刪除。')) return;
      store.classrooms.splice(store.classrooms.indexOf(cls), 1);
      save(); render();
    } else if (act === 'sync') {
      syncClass(cls);
    }
  });
  function openData(cls, status) {
    var url = store.teacher.sheetUrl;
    if (!url) {
      var input = prompt('請貼上您的 Google 試算表網址（只要貼一次，所有課堂共用）：\n例：https://docs.google.com/spreadsheets/d/…', '');
      if (input === null) return;
      input = input.trim();
      if (input.indexOf(SC.SHEET_PREFIX) !== 0) { status.textContent = '試算表網址要以 ' + SC.SHEET_PREFIX + ' 開頭，請從試算表的網址列複製。'; return; }
      store.teacher.sheetUrl = input.slice(0, 500);
      $('#sheetUrl').value = store.teacher.sheetUrl;
      save();
      url = store.teacher.sheetUrl;
    }
    window.open(url, '_blank', 'noopener');
    status.textContent = '已在新分頁打開試算表，請看「' + cls.name + '-雙狹縫」「' + cls.name + '-單狹縫」分頁（第一次收到該實驗的資料才會出現）。';
  }

  // ---- 新增課堂 ----
  function openAdd(fromCode) {
    var sel = $('#addFrom');
    sel.innerHTML = '<option value="">預設設定（雙縫 3 條＋單縫 3 條）</option>' + store.classrooms.map(function (c) {
      return '<option value="' + esc(c.code) + '">複製「' + esc(c.name) + '」的設定</option>';
    }).join('');
    sel.value = fromCode || (store.classrooms[0] ? store.classrooms[0].code : '');
    $('#addName').value = '';
    showErrors($('#addErrors'), []);
    $('#addBox').hidden = false;
    $('#addBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#addName').focus();
  }
  function createClass(name, config) {
    var cls = { code: SC.newCode(store), name: name, config: SC.cleanConfig(config), synced: false };
    store.classrooms.push(cls);
    save(); render();
    syncClass(cls);
    return cls;
  }
  $('#addClass').addEventListener('click', function () { openAdd(''); });
  $('#addCancel').addEventListener('click', function () { $('#addBox').hidden = true; });
  $('#addOk').addEventListener('click', function () {
    var name = $('#addName').value.trim();
    if (!name) { showErrors($('#addErrors'), ['請填課堂名稱']); return; }
    if (nameTaken(name)) { showErrors($('#addErrors'), ['已經有叫「' + name + '」的課堂，請換個名稱']); return; }
    var from = SC.findClass(store, $('#addFrom').value);
    var cfg = from ? JSON.parse(JSON.stringify(from.config)) : { slits: S.defaultSlits() };
    $('#addBox').hidden = true;
    openEditor(createClass(name, cfg).code);
  });
  $('#addSlit').addEventListener('click', function () { addSlitRow(); });
  $('#resetSlits').addEventListener('click', function () { $('#slitTable tbody').innerHTML = ''; S.defaultSlits().forEach(addSlitRow); });
  $('#editSave').addEventListener('click', saveEditor);
  $('#editCancel').addEventListener('click', function () { $('#editor').hidden = true; editingCode = null; });
  $$('#lambdaRed, #lambdaGreen').forEach(function (el) { el.addEventListener('input', refreshHints); });

  // ---- 三步驟引導 ----
  var wizStep = 1;
  function buildWizSlits() {
    var html = '';
    [['double', '雙狹縫干涉（縫間距 d）'], ['single', '單狹縫繞射（縫寬 a）']].forEach(function (g) {
      html += '<fieldset><legend>' + g[1] + '</legend>';
      S.defaultSlits().forEach(function (s, i) {
        if (s.type !== g[0]) return;
        html += '<label class="checkrow"><input type="checkbox" data-wiz-slit="' + i + '" checked> ' +
          (g[0] === 'double' ? 'd' : 'a') + ' = ' + S.formatSlitValue(s.value) + ' mm　<span class="lv ' + s.level + '">' + (s.level === 'suggest' ? '建議使用' : '進階') + '</span></label>';
      });
      html += '</fieldset>';
    });
    $('#wizSlits').innerHTML = html;
  }
  function showWizStep(n) {
    wizStep = n;
    $$('.wiz-page').forEach(function (p) { p.hidden = Number(p.getAttribute('data-step')) !== n; });
    $$('#wizSteps li').forEach(function (li) {
      var k = Number(li.getAttribute('data-step'));
      li.className = k === n ? 'on' : (k < n ? 'done' : '');
    });
    $('#wizBack').hidden = n === 1;
    $('#wizNext').textContent = n === 3 ? '完成，建立課堂' : '下一步';
    showErrors($('#wizErrors'), []);
  }
  function openWizard() {
    buildWizSlits();
    $('#wizName').value = '';
    $('#wizTeacher').value = store.teacher.name;
    $('#wizard').hidden = false;
    showWizStep(1);
    $('#wizard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeWizard() {
    store.wizardDone = true; save();
    $('#wizard').hidden = true;
    render();
  }
  $('#wizNext').addEventListener('click', function () {
    var name = $('#wizName').value.trim();
    if (wizStep === 1) {
      if (!name) { showErrors($('#wizErrors'), ['請幫課堂取個名稱，例如「301 基礎版」']); return; }
      if (nameTaken(name)) { showErrors($('#wizErrors'), ['已經有叫「' + name + '」的課堂，請換個名稱']); return; }
      showWizStep(2);
    } else if (wizStep === 2) {
      if (!$$('[data-wiz-slit]:checked').length) { showErrors($('#wizErrors'), ['請至少勾一條縫']); return; }
      showWizStep(3);
    } else {
      var all = S.defaultSlits();
      var slits = $$('[data-wiz-slit]:checked').map(function (el) { return all[Number(el.getAttribute('data-wiz-slit'))]; });
      var exps = ['double', 'single'].filter(function (t) { return slits.some(function (s) { return s.type === t; }); });
      var teacher = $('#wizTeacher').value.trim().slice(0, 80);
      if (teacher !== store.teacher.name) { store.teacher.name = teacher; $('#teacherName').value = teacher; }
      createClass(name, { slits: slits, experiments: exps });
      closeWizard();
    }
  });
  $('#wizBack').addEventListener('click', function () { showWizStep(Math.max(1, wizStep - 1)); });
  $('#wizSkip').addEventListener('click', closeWizard);
  $('#wizReopen').addEventListener('click', openWizard);
  $('#wizReopen2').addEventListener('click', openWizard);
  $('#wizard .print-links').innerHTML = $('main > section:not(#wizard) .print-links').innerHTML;

  // ---- 全域設定 ----
  function fillGlobal() {
    $('#teacherName').value = store.teacher.name;
    $('#scriptUrl').value = store.teacher.scriptUrl;
    $('#sheetUrl').value = store.teacher.sheetUrl;
  }
  function saveGlobal() {
    var errors = [];
    var name = $('#teacherName').value.trim().slice(0, 80);
    var url = S.isValidScriptUrl($('#scriptUrl').value);
    if (!url.ok) errors.push(url.error);
    var sheet = $('#sheetUrl').value.trim();
    if (sheet && sheet.indexOf(SC.SHEET_PREFIX) !== 0) errors.push('試算表網址要以 ' + SC.SHEET_PREFIX + ' 開頭（或留空）');
    showErrors($('#globalErrors'), errors);
    var changed = false;
    if (name !== store.teacher.name) { store.teacher.name = name; changed = true; }
    if (url.ok && url.value !== store.teacher.scriptUrl) { store.teacher.scriptUrl = url.value; changed = true; }
    if (!sheet || sheet.indexOf(SC.SHEET_PREFIX) === 0) store.teacher.sheetUrl = sheet.slice(0, 500);
    save();
    if (changed) syncAll(); // 名稱與網址會影響學生頁，重新登記每個課堂
    else render();
    $('#syncStatus').textContent = '已儲存。';
  }
  $$('#teacherName, #scriptUrl, #sheetUrl').forEach(function (el) { el.addEventListener('change', saveGlobal); });

  $('#copyGs').addEventListener('click', function () {
    var status = $('#copyGsStatus');
    fetch('apps_script/Code.gs?v=20261127d').then(function (res) {
      if (!res.ok) throw new Error('找不到檔案');
      return res.text();
    }).then(function (text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () {
          status.textContent = '已複製 Code.gs，請貼到 Apps Script 編輯器。';
        });
      }
      status.textContent = '無法自動複製，請打開 apps_script/Code.gs 手動複製。';
    }).catch(function () {
      status.textContent = '無法載入或複製程式檔。請打開同一資料夾的 apps_script/Code.gs，或見設定說明。';
    });
  });

  // ---- 備份與匯入 ----
  function applyImport(r, status) {
    if (!r.ok) { status.textContent = r.error + '。'; return false; }
    if (r.backup) {
      var n = SC.merge(store, r.backup);
      save(); fillGlobal(); render();
      status.textContent = '已匯入：新增 ' + n.added + ' 個課堂、更新 ' + n.replaced + ' 個。';
      syncAll();
    } else {
      // 舊的學生連結 → 新增一個課堂
      var st = r.settings;
      if (!store.teacher.scriptUrl && st.scriptUrl) store.teacher.scriptUrl = st.scriptUrl;
      if (!store.teacher.name && st.teacherName) store.teacher.name = st.teacherName;
      var name = st.classroomName || '匯入的課堂', k = 2;
      while (nameTaken(name)) name = (st.classroomName || '匯入的課堂') + ' ' + (k++);
      createClass(name, st);
      store.wizardDone = true; save(); fillGlobal(); render();
      status.textContent = '已從學生連結建立課堂「' + name + '」，請檢查縫的設定。';
    }
    $('#wizard').hidden = true;
    return true;
  }
  $('#exportFile').addEventListener('click', function () {
    var blob = new Blob([SC.exportJson(store)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '狹縫實驗課堂清單_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    $('#backupStatus').textContent = '已下載備份檔。換電腦時在這裡按「匯入備份檔」。';
  });
  $('#exportLink').addEventListener('click', function () {
    copyText(SC.backupLink(store, pageUrl('teacher.html')), $('#backupOut'), $('#backupStatus'),
      '已複製備份連結。在新電腦打開這個連結就會匯入（連結含老師金鑰，請勿給學生）。');
  });
  $('#importFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { applyImport(SC.parseImport(String(reader.result)), $('#backupStatus')); };
    reader.readAsText(f);
    this.value = '';
  });
  $('#importBtn').addEventListener('click', function () {
    if (applyImport(SC.parseImport($('#importText').value), $('#backupStatus'))) $('#importText').value = '';
  });

  // ---- 啟動 ----
  fillGlobal();
  render();
  var hash = location.hash || '';
  if (/^#backup=/.test(hash) || S.tokenFromHash(hash)) {
    history.replaceState(null, '', location.pathname + location.search);
    var r = SC.parseImport(hash.indexOf('#backup=') === 0 ? hash : location.href.split('?')[0] + hash);
    if (r.ok && r.backup && store.classrooms.length && !confirm('要把備份連結裡的 ' + r.backup.classrooms.length + ' 個課堂匯入這台電腦嗎？同代碼的課堂會被取代。')) r = null;
    if (r) applyImport(r, $('#backupStatus'));
    $('#backupStatus').scrollIntoView({ block: 'center' });
  } else if (!store.wizardDone && !store.classrooms.length) {
    openWizard();
  }
  // 還沒同步的課堂（例如剛從舊版升級、或之前沒網路）再試一次
  store.classrooms.forEach(function (c) { if (!c.synced) syncClass(c); });
})();
