// 老師頁 v4：用管理者給的「我的教師頁」連結打開，班級清單（一班一張卡片，資料進老師自己試算表裡以班名命名的分頁）
(function () {
  'use strict';
  var S = window.SlitSettings;
  var SC = window.SlitClassrooms;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var store = SC.load();
  var editingId = null;
  var busy = {};     // 班級編號 → 正在跟試算表溝通
  var note = {};     // 班級編號 → 卡片上的訊息 { text, err, retry }

  function save() { SC.save(store); }
  function pageUrl(name) { return new URL(name, location.href).href.split('#')[0].split('?')[0]; }
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
  function openEditor(id) {
    var cls = SC.findClass(store, id);
    if (!cls) return;
    editingId = id;
    $('#editorTitle').textContent = '編輯班級：' + cls.name;
    $('#className').value = cls.name;
    fillForm(cls.config);
    showErrors($('#editErrors'), []);
    $('#editor').hidden = false;
    $('#editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---- 跟總程式溝通（全部用 GET，讀得到回應；網址參數不用 c；用老師編號 tid＋金鑰找到自己的試算表）----
  var connected = function () { return !!(store.teacher.scriptUrl && store.teacher.tid && store.teacher.connected); };
  function api(action, params) {
    var q = new URLSearchParams();
    q.set('action', action);
    q.set('tid', store.teacher.tid);
    q.set('key', store.teacher.key);
    Object.keys(params || {}).forEach(function (k) { q.set(k, params[k]); });
    return fetch(store.teacher.scriptUrl + '?' + q.toString(), { redirect: 'follow' }).then(function (res) {
      return res.text().then(function (text) {
        var j = null;
        try { j = JSON.parse(text); } catch (e) {}
        if (!j) { var err = new Error('html'); err.kind = /<html|<!doctype/i.test(text) ? 'html' : 'notjson'; err.status = res.status; throw err; }
        return j;
      });
    }, function (e) { var err = new Error('network'); err.kind = navigator.onLine === false ? 'offline' : 'network'; throw err; });
  }
  function explain(err, res) {
    if (err) {
      if (err.kind === 'offline') return { text: '這台電腦現在沒有網路，連上網路後再試一次。' };
      return { text: '暫時連不上伺服器（可能是網路或伺服器忙碌），學生連結照常能用。請稍後再試一次；一直不行請告訴管理者。' };
    }
    if (res && (res.code === 'badkey' || res.code === 'noteacher')) return { link: true, text: '這個「我的教師頁」連結已經失效或不完整，請向管理者重新取得。' };
    if (res && res.code === 'disabled') return { link: true, text: '您的帳號已被管理者停用，請洽管理者。' };
    if (!res || res.v !== 4) return { text: '伺服器的程式版本不符，請告訴管理者。' };
    return { text: '伺服器回報錯誤：' + (res.error || '不明原因') };
  }
  function errText(err, res) { return explain(err, res).text; }

  // ---- 沒有連結／連結失效時的說明卡 ----
  function showTest(kind, html) {
    var box = $('#testResult');
    box.hidden = !html; box.className = 'test-result ' + kind; box.innerHTML = html;
  }
  function openSetup(msgHtml) {
    showTest(msgHtml ? 'err' : '', msgHtml || '');
    $('#setupCard').hidden = false;
  }
  $('#setupCard').addEventListener('click', function (e) { if (e.target.id === 'retest') refreshFromCloud(); });

  // 連線狀態列
  function renderConn() {
    var bar = $('#connBar');
    if (connected()) {
      bar.hidden = false; bar.className = 'conn-bar ok';
      bar.innerHTML = '✅ 已連上您的試算表。新增班級會自動多一個分頁。' +
        (store.teacher.sheetUrl ? ' <a href="' + esc(store.teacher.sheetUrl) + '" target="_blank" rel="noopener" id="openSheet">打開我的試算表</a>' : '');
    } else if (store.teacher.scriptUrl && store.teacher.tid) {
      bar.hidden = false; bar.className = 'conn-bar err';
      bar.innerHTML = '⚠️ 目前連不上您的試算表，學生連結照常能用。<button type="button" class="linklike" data-conn="retry">再試一次</button>';
    } else bar.hidden = true;
  }
  $('#connBar').addEventListener('click', function (e) { if (e.target.closest('[data-conn]')) refreshFromCloud(); });

  // 開頁時跟雲端對清單
  function refreshFromCloud() {
    if (!store.teacher.scriptUrl || !store.teacher.tid) return Promise.resolve();
    return api('hello', {}).then(function (res) {
      if (res.ok && res.v === 4) {
        store.teacher.connected = true;
        if (!store.teacher.name && res.teacherName) { store.teacher.name = String(res.teacherName).slice(0, 80); $('#teacherName').value = store.teacher.name; }
        var pending = SC.applyCloud(store, res);
        $('#setupCard').hidden = true;
        save(); render(); uploadPending(pending);
      } else throw { res: res };
    }).catch(function (e) {
      store.teacher.connected = false; save(); render();
      var ex = e && e.res ? explain(null, e.res) : explain(e, null);
      if (ex.link) openSetup('⚠️ ' + esc(ex.text));
      else $('#moreStatus').textContent = ex.text;
    });
  }

  // ---- 建立分頁（新增班級時；之前沒接上或失敗的也從這裡補）----
  function createOnCloud(cls) {
    if (!connected()) return Promise.resolve(false);
    busy[cls.id] = true; note[cls.id] = { text: '正在試算表建立分頁「' + cls.name + '」…' }; render();
    return api('addClass', { id: cls.id, name: cls.name, cfg: JSON.stringify(SC.cloudConfig(store, cls)) }).then(function (res) {
      if (!res.ok) throw { res: res };
      cls.gid = res.cls.gid; cls.name = res.cls.name;
      note[cls.id] = { text: '已在您的試算表建立分頁「' + cls.name + '」。' };
      return true;
    }).catch(function (e) {
      note[cls.id] = { err: true, retry: true, text: '分頁沒建成功：' + (e && e.res ? (e.res.error || '') : errText(e)) + '（請按「再試一次」；建好之前學生的紀錄會先存在學生手機）' };
      return false;
    }).then(function (ok) { delete busy[cls.id]; save(); render(); return ok; });
  }
  function uploadPending(list) { (list || []).forEach(createOnCloud); }

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
  function statusHtml(cls) {
    var n = note[cls.id];
    if (n) return '<span class="' + (n.err ? 'bad' : '') + '">' + esc(n.text) + '</span>' +
      (n.retry && !busy[cls.id] ? ' <button type="button" class="linklike" data-act="retry">再試一次</button>' : '');
    if (!store.teacher.tid) return '還沒用「我的教師頁」連結打開：紀錄只存在學生手機（可下載 CSV）。';
    if (cls.gid === null) return connected() ? '還沒在試算表建立分頁。 <button type="button" class="linklike" data-act="retry">建立分頁</button>' : '連不上您的試算表，分頁之後再建。';
    return '數據在您試算表的「' + esc(cls.name) + '」分頁。';
  }
  function cardHtml(c) {
    return '<div class="card class-card' + (c.archived ? ' is-archived' : '') + '" data-id="' + esc(c.id) + '">' +
      '<div class="cc-head"><h3>' + esc(c.name) + '</h3>' + (c.archived ? '<span class="cc-code">已封存</span>' : '') + '</div>' +
      '<p class="cc-sum">' + summary(c.config) + '</p>' +
      '<div class="cc-main">' +
        '<button type="button" class="primary" data-act="slides">開啟簡報</button>' +
        '<button type="button" data-act="copy">複製學生連結</button>' +
        '<button type="button" data-act="data">看數據</button>' +
      '</div>' +
      '<input type="text" class="cc-link" readonly hidden aria-label="學生連結">' +
      '<p class="hint cc-status">' + statusHtml(c) + '</p>' +
      '<div class="cc-more">' +
        (c.archived ? '<button type="button" data-act="unarchive">還原</button>' :
          '<button type="button" data-act="edit">編輯</button>' +
          '<button type="button" data-act="dup">複製成新班級</button>' +
          '<button type="button" data-act="archive">封存</button>') +
        '<button type="button" data-act="del" class="danger">刪除</button>' +
      '</div></div>';
  }
  function render() {
    var active = store.classrooms.filter(function (c) { return !c.archived; });
    var archived = store.classrooms.filter(function (c) { return c.archived; });
    $('#classList').innerHTML = active.map(cardHtml).join('');
    $('#archivedList').innerHTML = archived.map(cardHtml).join('');
    $('#listEmpty').hidden = active.length > 0;
    $('#archivedBox').hidden = !archived.length;
    $('#archivedSum').textContent = '已封存（' + archived.length + '）';
    renderConn();
  }
  function cardClick(e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var card = btn.closest('.class-card');
    var cls = SC.findClass(store, card.getAttribute('data-id'));
    if (!cls) return;
    var act = btn.getAttribute('data-act');
    var status = $('.cc-status', card);
    if (act === 'slides') {
      var s = SC.linkFor(store, cls, pageUrl('slides.html'));
      if (s.ok) window.open(s.url, '_blank');
      else status.textContent = s.errors.join('；');
    } else if (act === 'copy') {
      var l = SC.linkFor(store, cls, pageUrl('index.html'));
      if (l.ok) copyText(l.url, $('.cc-link', card), status, '已複製「' + cls.name + '」的學生連結。');
      else status.textContent = l.errors.join('；');
    } else if (act === 'data') {
      var u = SC.dataUrl(store, cls);
      if (!u) { status.textContent = '連上您的試算表後才能直接看數據；現在學生可以下載 CSV 交給您。'; return; }
      window.open(u, '_blank', 'noopener');
      status.textContent = '已在新分頁打開您試算表的「' + cls.name + '」分頁。' + (cls.gid === null ? '（這班的分頁還沒建好，先打開整份試算表）' : '');
    } else if (act === 'edit') {
      openEditor(cls.id);
    } else if (act === 'dup') {
      openAdd(cls.id);
    } else if (act === 'archive' || act === 'unarchive') {
      setArchived(cls, act === 'archive', status);
    } else if (act === 'del') {
      if (!confirm('把「' + cls.name + '」從清單拿掉？\n試算表裡的「' + cls.name + '」分頁和資料都會保留，已經發給學生的連結也仍然送得到那一頁。')) return;
      removeClass(cls, status);
    } else if (act === 'retry') {
      createOnCloud(cls);
    }
  }
  $('#classList').addEventListener('click', cardClick);
  $('#archivedList').addEventListener('click', cardClick);

  function setArchived(cls, on, status) {
    function apply() { cls.archived = on; note[cls.id] = { text: on ? '已封存：分頁先隱藏，資料都在，學生照樣能送。' : '已還原，分頁重新顯示。' }; save(); render(); }
    if (!connected() || cls.gid === null) { apply(); return; }
    status.textContent = on ? '封存中…' : '還原中…';
    api('archive', { id: cls.id, on: on ? '1' : '0' }).then(function (res) {
      if (!res.ok) throw { res: res };
      apply();
    }).catch(function (e) { status.textContent = (on ? '封存' : '還原') + '失敗：' + (e && e.res ? e.res.error : errText(e)); });
  }
  function removeClass(cls, status) {
    function apply() { store.classrooms.splice(store.classrooms.indexOf(cls), 1); save(); render(); }
    if (!connected() || cls.gid === null) { apply(); return; }
    status.textContent = '刪除中…';
    api('remove', { id: cls.id }).then(function (res) {
      if (!res.ok) throw { res: res };
      apply();
    }).catch(function (e) { status.textContent = '刪除失敗：' + (e && e.res ? e.res.error : errText(e)); });
  }

  // ---- 編輯（改名＝分頁改名；資料和學生連結不變）----
  function saveEditor() {
    var cls = SC.findClass(store, editingId);
    if (!cls) return;
    var nm = SC.checkName(store, $('#className').value, cls.id);
    var errors = nm.ok ? [] : [nm.error];
    var v = S.validateForGenerate(readForm());
    if (!v.ok) errors = errors.concat(v.errors);
    if (errors.length) { showErrors($('#editErrors'), errors); return; }
    var next = { id: cls.id, name: nm.name, config: SC.cleanConfig(v.settings), gid: cls.gid, archived: cls.archived };
    function apply(serverCls) {
      cls.name = serverCls ? serverCls.name : next.name;
      cls.config = next.config;
      note[cls.id] = { text: '已儲存。' + (serverCls ? '試算表分頁是「' + cls.name + '」，已發出的學生連結會自動拿到新設定。' : '') };
      save();
      $('#editor').hidden = true; editingId = null;
      render();
      var card = $('.class-card[data-id="' + cls.id + '"]');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (!connected() || cls.gid === null) {
      apply(null);
      if (connected()) createOnCloud(cls);
      return;
    }
    $('#editSave').disabled = true;
    showErrors($('#editErrors'), []);
    api('editClass', { id: cls.id, name: next.name, cfg: JSON.stringify(SC.cloudConfig(store, next)) }).then(function (res) {
      if (!res.ok) throw { res: res };
      apply(res.cls);
    }).catch(function (e) {
      showErrors($('#editErrors'), ['沒有存進試算表：' + (e && e.res ? e.res.error : errText(e)) + '。請再按一次「儲存」。']);
    }).then(function () { $('#editSave').disabled = false; });
  }

  // ---- 新增班級 ----
  function openAdd(fromId) {
    var sel = $('#addFrom');
    sel.innerHTML = '<option value="">預設（雙縫 3 條＋單縫 3 條，紅綠光）</option>' + store.classrooms.map(function (c) {
      return '<option value="' + esc(c.id) + '">跟「' + esc(c.name) + '」一樣</option>';
    }).join('');
    var firstActive = store.classrooms.filter(function (c) { return !c.archived; })[0];
    sel.value = fromId || (firstActive ? firstActive.id : '');
    $('#addName').value = '';
    showErrors($('#addErrors'), []);
    $('#addBox').hidden = false;
    $('#addBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#addName').focus();
  }
  function createClass(name, config) {
    var cls = SC.normalizeClass({ id: SC.newId(store), name: name, config: config, gid: null });
    store.classrooms.push(cls);
    save(); render();
    createOnCloud(cls);
    return cls;
  }
  $('#addClass').addEventListener('click', function () {
    if (connected()) { $('#setupCard').hidden = true; render(); }  // 接好後開始建班級，設定區收起來
    openAdd('');
  });
  $('#addCancel').addEventListener('click', function () { $('#addBox').hidden = true; });
  function addOk() {
    var nm = SC.checkName(store, $('#addName').value, '');
    if (!nm.ok) { showErrors($('#addErrors'), [nm.error]); return; }
    var from = SC.findClass(store, $('#addFrom').value);
    var cfg = from ? JSON.parse(JSON.stringify(from.config)) : { slits: S.defaultSlits() };
    $('#addBox').hidden = true;
    var cls = createClass(nm.name, cfg);
    var card = $('.class-card[data-id="' + cls.id + '"]');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  $('#addOk').addEventListener('click', addOk);
  $('#addName').addEventListener('keydown', function (e) { if (e.key === 'Enter') addOk(); });
  $('#addSlit').addEventListener('click', function () { addSlitRow(); });
  $('#resetSlits').addEventListener('click', function () { $('#slitTable tbody').innerHTML = ''; S.defaultSlits().forEach(addSlitRow); });
  $('#editSave').addEventListener('click', saveEditor);
  $('#editCancel').addEventListener('click', function () { $('#editor').hidden = true; editingId = null; });
  $$('#lambdaRed, #lambdaGreen').forEach(function (el) { el.addEventListener('input', refreshHints); });

  // ---- 老師名稱、換電腦 ----
  $('#teacherName').addEventListener('change', function () {
    var name = this.value.trim().slice(0, 80);
    if (name === store.teacher.name) return;
    store.teacher.name = name; save();
    // 學生頁頂端顯示的名稱也更新到雲端設定
    if (connected()) store.classrooms.forEach(function (c) {
      if (c.gid !== null) api('editClass', { id: c.id, cfg: JSON.stringify(SC.cloudConfig(store, c)) }).catch(function () {});
    });
    $('#moreStatus').textContent = '已儲存名稱。';
  });
  $('#copySetupLink').addEventListener('click', function () {
    if (!store.teacher.tid) { $('#moreStatus').textContent = '請先用管理者給的「我的教師頁」連結打開這一頁。'; return; }
    copyText(SC.setupLink(store, pageUrl('teacher.html')), $('#setupLinkOut'), $('#moreStatus'),
      '已複製「我的教師頁」連結。在新電腦打開它，班級清單就會從您的試算表取回（連結含老師金鑰，請勿給學生）。');
  });

  // ---- 啟動 ----
  $('#teacherName').value = store.teacher.name;
  var setup = SC.parseSetup(location.hash || '');
  if (setup) {
    history.replaceState(null, '', location.pathname + location.search);  // 網址列不留金鑰
    if (setup.ok) {
      if (store.teacher.tid !== setup.tid || store.teacher.key !== setup.key) {
        store.classrooms = store.classrooms.filter(function (c) { return c.gid === null; });  // 換成這位老師的清單
      }
      store.teacher.scriptUrl = setup.scriptUrl; store.teacher.tid = setup.tid; store.teacher.key = setup.key; store.teacher.connected = false;
      if (setup.name) store.teacher.name = setup.name;
      $('#teacherName').value = store.teacher.name;
      save();
    } else {
      openSetup('⚠️ ' + esc(setup.error));
    }
  }
  render();
  if (store.teacher.tid) refreshFromCloud();
  else openSetup('');
})();
