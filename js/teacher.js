// 老師設定頁
(function () {
  'use strict';
  var S = window.SlitSettings;
  var KEY = 'slitLabLog.teacherConfig.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function addSlitRow(data) {
    data = data || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="text" data-k="id" placeholder="例：1" maxlength="30"></td>' +
      '<td><select data-k="type">' +
        '<option value="double">雙狹縫 d</option>' +
        '<option value="single">單狹縫 a</option>' +
      '</select></td>' +
      '<td><input type="text" data-k="value" inputmode="decimal" placeholder="例：0.40"></td>' +
      '<td><button type="button" class="del-row">刪除</button></td>';
    if (data.id) tr.querySelector('[data-k="id"]').value = data.id;
    if (data.type) tr.querySelector('[data-k="type"]').value = data.type;
    if (data.value != null && data.value !== '') tr.querySelector('[data-k="value"]').value = String(data.value);
    tr.querySelector('.del-row').addEventListener('click', function () { tr.parentNode.removeChild(tr); saveLocal(); });
    $$('input, select', tr).forEach(function (el) { el.addEventListener('input', saveLocal); el.addEventListener('change', saveLocal); });
    $('#slitTable tbody').appendChild(tr);
  }

  function readSlits() {
    return $$('#slitTable tbody tr').map(function (tr) {
      return {
        id: $('[data-k="id"]', tr).value,
        type: $('[data-k="type"]', tr).value,
        value: $('[data-k="value"]', tr).value
      };
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
      teacherName: $('#teacherName').value,
      scriptUrl: $('#scriptUrl').value,
      lasers: lasers,
      experiments: experiments,
      suggestedL: $('#suggestedL').value,
      slits: readSlits()
    };
  }
  function fillForm(cfg) {
    cfg = S.normalize(cfg || {});
    $('#teacherName').value = cfg.teacherName || '';
    $('#scriptUrl').value = cfg.scriptUrl || '';
    var hasRed = cfg.lasers.some(function (L) { return L.color === 'red'; });
    var hasGreen = cfg.lasers.some(function (L) { return L.color === 'green'; });
    $('#laserRed').checked = hasRed;
    $('#laserGreen').checked = hasGreen;
    cfg.lasers.forEach(function (L) {
      if (L.color === 'red') $('#lambdaRed').value = L.lambda0;
      if (L.color === 'green') $('#lambdaGreen').value = L.lambda0;
    });
    if (!hasRed) $('#lambdaRed').value = '650';
    if (!hasGreen) $('#lambdaGreen').value = '532';
    $('#expDouble').checked = cfg.experiments.indexOf('double') >= 0;
    $('#expSingle').checked = cfg.experiments.indexOf('single') >= 0;
    $('#suggestedL').value = cfg.suggestedL || 1000;
    var body = $('#slitTable tbody');
    body.innerHTML = '';
    if (cfg.slits && cfg.slits.length) cfg.slits.forEach(addSlitRow);
    else addSlitRow();
  }
  function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(readForm())); } catch (e) {}
  }
  function loadLocal() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { fillForm(JSON.parse(raw)); return true; }
    } catch (e) {}
    return false;
  }

  function studentPageUrl() {
    return new URL('index.html', location.href).href.split('#')[0];
  }
  function drawQr(url) {
    var box = $('#qr');
    box.innerHTML = '';
    if (typeof qrcode !== 'function') { box.textContent = '無法產生 QR code。'; return; }
    try {
      var qr = qrcode(0, 'L');
      qr.addData(url);
      qr.make();
      box.innerHTML = qr.createSvgTag(4, 2);
    } catch (e) {
      box.textContent = 'QR code 產生失敗（連結可能太長）。請改用複製連結。';
    }
  }
  function showLink(url) {
    $('#resultBox').hidden = false;
    $('#studentUrl').value = url;
    $('#copyUrlStatus').textContent = '';
    drawQr(url);
    $('#resultBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function generate() {
    var v = S.buildStudentUrl(readForm(), studentPageUrl());
    var ul = $('#genErrors');
    if (!v.ok) {
      ul.innerHTML = v.errors.map(function (e) { return '<li>' + e + '</li>'; }).join('');
      $('#resultBox').hidden = true;
      return;
    }
    ul.innerHTML = '';
    saveLocal();
    showLink(v.url);
  }

  $('#addSlit').addEventListener('click', function () { addSlitRow(); saveLocal(); });
  $('#generate').addEventListener('click', generate);
  $('#copyUrl').addEventListener('click', function () {
    var url = $('#studentUrl').value;
    if (!url) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        $('#copyUrlStatus').textContent = '已複製連結。';
      }, function () { $('#studentUrl').select(); $('#copyUrlStatus').textContent = '請手動複製。'; });
    } else { $('#studentUrl').select(); $('#copyUrlStatus').textContent = '請手動複製。'; }
  });
  $('#importBtn').addEventListener('click', function () {
    var r = S.extractStudentUrl($('#importUrl').value);
    if (!r.ok) { $('#importStatus').textContent = r.error + '。請檢查連結。'; return; }
    if (!r.settings) { $('#importStatus').textContent = '這個連結沒有老師設定。'; return; }
    fillForm(r.settings);
    saveLocal();
    $('#importStatus').textContent = '已讀回設定，請檢查後再產生新連結。';
  });
  $$('#teacherName, #scriptUrl, #lambdaRed, #lambdaGreen, #suggestedL').forEach(function (el) {
    el.addEventListener('input', saveLocal);
  });
  $$('#laserRed, #laserGreen, #expDouble, #expSingle').forEach(function (el) {
    el.addEventListener('change', saveLocal);
  });

  $('#copyGs').addEventListener('click', function () {
    var status = $('#copyGsStatus');
    fetch('apps_script/Code.gs').then(function (res) {
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
      status.textContent = '無法載入程式檔。請打開同一資料夾的 apps_script/Code.gs，或見設定說明。';
    });
  });

  // 啟動：既有連結的 hash、本機儲存，或空白一列
  var fromHash = S.fromHash(location.hash);
  if (fromHash.ok && fromHash.settings) {
    fillForm(fromHash.settings);
    saveLocal();
  } else if (!loadLocal()) {
    addSlitRow();
  }
})();
