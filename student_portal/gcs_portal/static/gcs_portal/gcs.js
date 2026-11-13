// FDE-GCS Web 1.0（P1）：只做介面狀態，不連線任何設備，也不產生任何遙測數值。
(function () {
  'use strict';

  var MODE_TEXT = {
    demo: ['DEMO 介面', '目前未連線任何飛控。畫面上沒有真實遙測，也沒有用假資料冒充遙測。'],
    real: ['真機模式（未連線）', '真機 USB 連線在 P2 開放。目前沒有連線任何 Pixhawk。'],
    sitl: ['仿真模式（未連線）', 'SITL 仿真連線在 P4 開放。目前沒有連線任何仿真。']
  };

  function setMode(mode) {
    var text = MODE_TEXT[mode] || MODE_TEXT.demo;
    var bar = document.getElementById('gcsModeBar');
    bar.setAttribute('data-mode', MODE_TEXT[mode] ? mode : 'demo');
    document.getElementById('gcsModeLabel').textContent = text[0];
    document.getElementById('gcsModeDetail').textContent = text[1];
  }

  function showSerialSupport() {
    var target = document.getElementById('gcsSerialSupport');
    if (!window.isSecureContext) {
      target.textContent = '不可用：需要 HTTPS 或本機（localhost）網址';
    } else if ('serial' in navigator) {
      target.textContent = '可用（Chrome／Edge）';
    } else {
      target.textContent = '不支援：請改用 Windows 桌面版 Chrome 或 Edge';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    showSerialSupport();
    document.querySelectorAll('input[name="gcs-mode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (input.checked) {
          setMode(input.value);
        }
      });
    });
  });
})();
