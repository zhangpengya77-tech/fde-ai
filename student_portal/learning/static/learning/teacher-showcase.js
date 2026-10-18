/* 班級成果展示 · 簡報播放模式（P7-B，2026-10-13 教師指令）
   純前端切頁：不產生 PPTX、不剪輯影片、不自動撰寫成果文案。
   支援 ←／→／PageUp／PageDown／空白鍵／Home／End／Esc，適配 16:9 投影。 */
(function () {
  'use strict';

  var root = document.getElementById('showcase-root');
  if (!root) return;

  var slides = Array.prototype.slice.call(root.querySelectorAll('[data-slide]'));
  if (!slides.length) return;

  var stage = document.getElementById('sc-stage');
  var controls = document.getElementById('sc-controls');
  var hint = document.getElementById('sc-hint');
  var startBtn = document.getElementById('showcase-start');
  var prevBtn = document.getElementById('sc-prev');
  var nextBtn = document.getElementById('sc-next');
  var exitBtn = document.getElementById('sc-exit');
  var currentEl = document.getElementById('sc-current');

  var index = 0;
  var presenting = false;
  var fullscreenEngaged = false;

  if (stage) stage.setAttribute('tabindex', '-1');

  function render() {
    for (var i = 0; i < slides.length; i += 1) {
      if (i === index) {
        slides[i].classList.add('is-active');
      } else {
        slides[i].classList.remove('is-active');
      }
    }
    if (currentEl) currentEl.textContent = String(index + 1);
  }

  function goTo(target) {
    var next = target;
    if (next < 0) next = 0;
    if (next > slides.length - 1) next = slides.length - 1;
    if (next === index) return;
    index = next;
    render();
    if (stage) stage.scrollTop = 0;
  }

  function go(delta) {
    goTo(index + delta);
  }

  function enterPresentation() {
    presenting = true;
    index = 0;
    render();
    document.body.classList.add('sc-presenting');
    root.classList.add('is-presenting');
    if (controls) controls.hidden = false;
    if (hint) hint.hidden = false;

    var target = stage || root;
    // 手機（iOS Safari）對非 video 元素不支援全螢幕；失敗時仍以 CSS 全螢幕呈現。
    if (target.requestFullscreen) {
      try {
        var promise = target.requestFullscreen();
        if (promise && typeof promise.then === 'function') {
          promise.then(function () {
            fullscreenEngaged = true;
          }).catch(function () {});
        } else {
          fullscreenEngaged = true;
        }
      } catch (error) {
        fullscreenEngaged = false;
      }
    }
    if (target.focus) {
      try {
        target.focus();
      } catch (error) {
        /* 忽略：焦點非必要 */
      }
    }
  }

  function exitPresentation() {
    presenting = false;
    document.body.classList.remove('sc-presenting');
    root.classList.remove('is-presenting');
    if (controls) controls.hidden = true;
    if (hint) hint.hidden = true;
    for (var i = 0; i < slides.length; i += 1) {
      slides[i].classList.remove('is-active');
    }
    if (fullscreenEngaged && document.fullscreenElement && document.exitFullscreen) {
      try {
        var promise = document.exitFullscreen();
        if (promise && typeof promise.catch === 'function') promise.catch(function () {});
      } catch (error) {
        /* 忽略：可能已由瀏覽器退出 */
      }
    }
    fullscreenEngaged = false;
  }

  if (startBtn) {
    startBtn.addEventListener('click', function () {
      if (presenting) {
        exitPresentation();
      } else {
        enterPresentation();
      }
    });
  }
  if (prevBtn) prevBtn.addEventListener('click', function () { go(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(1); });
  if (exitBtn) exitBtn.addEventListener('click', function () { exitPresentation(); });

  document.addEventListener('keydown', function (event) {
    if (!presenting) return;
    var key = event.key;
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      go(1);
    } else if (key === 'ArrowLeft' || key === 'PageUp') {
      event.preventDefault();
      go(-1);
    } else if (key === 'Home') {
      event.preventDefault();
      goTo(0);
    } else if (key === 'End') {
      event.preventDefault();
      goTo(slides.length - 1);
    } else if (key === 'Escape' || key === 'Esc') {
      event.preventDefault();
      exitPresentation();
    }
  });

  // 使用者以瀏覽器 UI 退出全螢幕時，同步退出展示模式。
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && presenting && fullscreenEngaged) {
      exitPresentation();
    }
  });

  // 對外揭露最小狀態，供自動化驗收查詢（唯讀，不影響功能）。
  root.setAttribute('data-showcase-ready', '1');
})();
