/**
 * REA 考照模擬器主介面：選科目 → 選機型 → 設定 → 開始飛 → 評等／回放。
 *
 * 流程與資訊架構參考 drone.sean.cat/simulator 的公開操作流程（REA 研究），
 * 介面、程式、圖像均為本專案自行實作。
 * 輸入沿用既有 ExamInput（五種連線方式＋既有「🔗 連線方式」面板），不改原有連線實作。
 */

import './rea.css';
import { ExamInput } from '../exam/exam-input';
import { mountFloatingLinkPanel } from '../ui/link-panel';
import { SUBJECTS, fieldOf, subjectById, type AirframeId, type License, type Subject } from './courses';
import { AIRFRAMES, type Command, type FlightMode, horizontalSpeed, norm360 } from './physics';
import { Autopilot } from './autopilot';
import { FlightSession, sampleAt, type Sample } from './session';
import { TIER_LABELS, type CourseResult } from './runner';
import { DEFAULT_WIND, WIND_FROM_LABELS, levelToSpeed, type WindFrom, type WindSettings } from './wind';
import { ExamScene, type ExamineeCam } from './scene';
import { drawTrack, type TrackColoring } from './track-view';
import { normalizeInputSource, showPracticeToast, syncPractice } from '../report/practice-sync';
import { Narrator, introNarration, stepNarration } from './narrator';
import { RotorAudio, rotorTarget } from './rotor-audio';

type Phase = 'setup' | 'countdown' | 'flying' | 'result';
type StickMode = 'mode2' | 'mode1';

interface Prefs {
  subjectId: string;
  airframeId: AirframeId;
  airframeFixed: boolean;
  mode: FlightMode;
  wind: WindSettings;
  sunny: boolean;
  hour: number;
  facingDeg: number;
  stickMode: StickMode;
  examineeCam: ExamineeCam;
  showSticks: boolean;
  showHud: boolean;
  license: License | 'all';
  /** 2026-11-08：示範飛行語音解說（台灣女聲） */
  narration: boolean;
  /** 2026-11-08：槳葉旋轉聲音 */
  rotorSound: boolean;
  /** 2026-11-08：解說字幕（預設關：以語音為主，畫面留給無人機） */
  captions: boolean;
}

const PREFS_KEY = 'fde-rea-exam-prefs-v1';
const DEFAULT_PREFS: Prefs = {
  subjectId: 'figure-eight', airframeId: 'quad-4kg', airframeFixed: false, mode: 'attitude', wind: { ...DEFAULT_WIND },
  sunny: true, hour: 10, facingDeg: 0, stickMode: 'mode2', examineeCam: 'follow', showSticks: true, showHud: true, license: 'all',
  narration: true, rotorSound: true, captions: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw), wind: { ...DEFAULT_WIND, ...(JSON.parse(raw).wind ?? {}) } };
  } catch { /* 無痕模式等：用預設值 */ }
  return { ...DEFAULT_PREFS };
}

function savePrefs(p: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* 忽略 */ }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface ReaApp { dispose(): void }

export function createReaApp(root: HTMLElement): ReaApp {
  const prefs = loadPrefs();
  root.innerHTML = '';
  root.classList.add('rea-root');
  root.innerHTML = `
  <div class="rea-layout">
    <section class="rea-stage" data-rea-stage>
      <div class="rea-topbar">
        <a class="rea-chip rea-home" href="../">← 仿真訓練</a>
        <button class="rea-chip" data-rea-mode title="定位模式：放開搖桿會停住；姿態模式：放開搖桿機身擺平但會被風吹走"></button>
        <span class="rea-chip rea-title" data-rea-title></span>
        <span class="rea-chip rea-src" data-rea-src title="目前生效的輸入來源"></span>
      </div>
      <div class="rea-hint" data-rea-hint></div>
      <div class="rea-caption" data-rea-caption hidden></div>
      <div class="rea-hud" data-rea-hud></div>
      <div class="rea-sticks" data-rea-sticks>
        <div class="rea-stick"><i data-rea-stick-l></i><span>左手</span></div>
        <div class="rea-stick"><i data-rea-stick-r></i><span>右手</span></div>
      </div>
      <div class="rea-countdown" data-rea-countdown></div>
      <div class="rea-bottombar">
        <button class="rea-chip" data-rea-restart title="重來（Backspace）">重來 ⌫</button>
        <span class="rea-spacer"></span>
        <button class="rea-chip" data-rea-view title="切換視角（V）">考生視角 V</button>
        <button class="rea-chip" data-rea-full title="全螢幕（G）">全螢幕 G</button>
      </div>
      <div class="rea-result" data-rea-result hidden></div>
    </section>
    <aside class="rea-side" data-rea-side>
      <h1 class="rea-h1">臺灣無人機考照模擬器 <small>FDE-AI V2.0・REA 重建版</small></h1>
      <p class="rea-note">練習評等為本站自訂標準，<b>不是民航局官方評分</b>；考場尺寸依 AC 107-005D。</p>
      <div class="rea-tabs" role="tablist">
        <button role="tab" data-rea-tab="exam" aria-selected="true">考試科目</button>
        <button role="tab" data-rea-tab="challenge" aria-selected="false">趣味挑戰</button>
      </div>
      <div data-rea-pane="exam">
        <div class="rea-filter" data-rea-filter></div>
        <div class="rea-subjects" data-rea-subjects></div>
      </div>
      <div data-rea-pane="challenge" hidden>
        <p class="rea-muted">參考網站另有射氣球、平移矩形、刺氣球、8 字闖關、繞角錐、小五邊等趣味挑戰與無人機足球。<b>本版尚未實作</b>，先專注考照科目。</p>
      </div>
      <h2 class="rea-h2">選機型 <label class="rea-switch"><input type="checkbox" data-rea-af-fixed> 固定（不隨科目）</label></h2>
      <div class="rea-airframes" data-rea-airframes></div>
      <details class="rea-settings">
        <summary>考場設定（風況、陽光、搖桿模式…）</summary>
        <div class="rea-grid">
          <label>風向<select data-rea-wind-from>${Object.entries(WIND_FROM_LABELS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>風力<input type="range" min="0" max="5" step="1" data-rea-wind-level><output data-rea-wind-level-out></output></label>
          <label>陣風<input type="range" min="0" max="8" step="1" data-rea-wind-gust><output data-rea-wind-gust-out></output></label>
          <label>風向擺動<select data-rea-wind-sway><option value="small">小</option><option value="medium">中</option><option value="large">大</option><option value="crazy">瘋狂</option></select></label>
          <label>陽光<select data-rea-sunny><option value="1">晴天</option><option value="0">陰天</option></select></label>
          <label>時間<select data-rea-hour>${[8, 10, 12, 14, 16].map((h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>
          <label>考生面向<select data-rea-facing>${['北', '東北', '東', '東南', '南', '西南', '西', '西北'].map((n, i) => `<option value="${i * 45}">${n}</option>`).join('')}</select></label>
          <label>搖桿模式<select data-rea-stick-mode><option value="mode2">美國手（Mode 2，左手油門）</option><option value="mode1">日本手（Mode 1，右手油門）</option></select></label>
          <label>考生視角<select data-rea-excam><option value="fixed">固定</option><option value="follow">自動轉頭</option><option value="zoom">飛遠拉近</option></select></label>
          <label class="rea-check"><input type="checkbox" data-rea-show-sticks> 顯示打桿位置</label>
          <label class="rea-check"><input type="checkbox" data-rea-show-hud> 顯示高度、速度與機頭角</label>
          <label class="rea-check"><input type="checkbox" data-rea-narration> 示範語音解說（台灣女聲）</label>
          <label class="rea-check"><input type="checkbox" data-rea-rotor-sound> 槳葉旋轉聲音</label>
          <label class="rea-check"><input type="checkbox" data-rea-captions> 顯示解說字幕</label>
          <p class="rea-muted" data-rea-voice-name></p>
        </div>
        <p class="rea-muted" data-rea-safety></p>
        <button class="rea-link" data-rea-reset-prefs>恢復預設</button>
      </details>
      <div class="rea-actions">
        <button class="rea-primary" data-rea-start>開始飛</button>
        <button class="rea-secondary" data-rea-demo>看示範</button>
      </div>
      <p class="rea-brief" data-rea-brief></p>
      <div class="rea-links">
        <p class="rea-muted">🔗 <b>連線方式</b>：沿用原系統五種方式（⌨️ 鍵盤、🎮 實體遙控器、✋ 手勢、🖊️ 原子筆＋鏡頭、📱 手機遙控器），按畫面右下「🔗 連線方式」切換。優先順序：實體遙控器 → 手機 → 手勢 → 原子筆 → 鍵盤；訊號中斷超過 0.25 秒自動懸停。</p>
        <p class="rea-muted">鍵盤：W/S 前後、A/D 左右、Q/E 轉向、R/F 升降。快捷鍵：Enter 開始飛、Backspace 重來、V 切換視角、G 全螢幕。</p>
      </div>
    </aside>
  </div>`;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const stage = $('[data-rea-stage]');
  const scene = new ExamScene(stage);
  scene.renderer.domElement.classList.add('rea-canvas');
  stage.prepend(scene.renderer.domElement);

  const input = new ExamInput();
  void input.start();
  const unmountLink = input.pen && input.phone ? mountFloatingLinkPanel(input.pen, input.phone, input.gesture ?? undefined) : () => undefined;

  let phase: Phase = 'setup';
  let session: FlightSession | null = null;
  let demo: Autopilot | null = null;
  let countdownT = 0;
  let replay: { samples: Sample[]; t: number; speed: number; playing: boolean; result: CourseResult; coloring: TrackColoring } | null = null;
  let raf = 0;
  /** 最近一次的輸入來源（存成長日誌時記錄操作方式） */
  let lastSource: { kind: 'keyboard' | 'adapter'; label: string } = { kind: 'keyboard', label: '鍵盤' };
  let last = performance.now();
  // 測試／快速預覽用：?reaSpeed=N 只加速「示範飛行」（1–40 倍），真人飛行永遠是實際時間
  const demoSpeed = Math.min(40, Math.max(1, Number(new URLSearchParams(location.search).get('reaSpeed')) || 1));

  // 2026-11-08：示範語音解說與槳葉聲音
  const narrator = new Narrator();
  const rotor = new RotorAudio();
  let narratedStep = -1;
  let captionTimer = 0;
  narrator.onText = (text) => {
    // 字幕只在「使用者打開字幕」或「瀏覽器不能發聲」時顯示，避免擋住無人機
    if (!prefs.captions && narrator.canSpeak) return;
    const cap = $('[data-rea-caption]');
    cap.textContent = `🎙️ ${text}`;
    cap.hidden = false;
    clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => { cap.hidden = true; }, Math.max(4000, text.length * 260));
  };
  const hideCaption = () => { clearTimeout(captionTimer); $('[data-rea-caption]').hidden = true; };

  const subject = (): Subject => subjectById(prefs.subjectId) ?? SUBJECTS[3];

  // ---------- 側欄 ----------
  function renderFilter(): void {
    const opts: (License | 'all')[] = ['all', 'I2', 'I', 'G1', 'G2', 'G3'];
    $('[data-rea-filter]').innerHTML = opts.map((o) =>
      `<button class="rea-pill${prefs.license === o ? ' on' : ''}" data-rea-lic="${o}">${o === 'all' ? '全部' : o}</button>`).join('');
  }

  function renderSubjects(): void {
    const list = SUBJECTS.filter((s) => prefs.license === 'all' || s.licenses.includes(prefs.license as License));
    $('[data-rea-subjects]').innerHTML = list.map((s) => `
      <button class="rea-subject${s.id === prefs.subjectId ? ' on' : ''}" data-rea-pick="${s.id}" ${s.implemented ? '' : 'disabled'}>
        <b>${esc(s.name)}</b><small>${s.licenses.join('・')}${s.field === 'I2' ? '・小場地' : ''}${s.implemented ? '' : '・尚未實作'}</small>
      </button>`).join('');
  }

  function renderAirframes(): void {
    $<HTMLInputElement>('[data-rea-af-fixed]').checked = prefs.airframeFixed;
    $('[data-rea-airframes]').innerHTML = Object.values(AIRFRAMES).map((a) => `
      <button class="rea-af${a.id === prefs.airframeId ? ' on' : ''}" data-rea-af="${a.id}"><b>${a.name}</b><small>${a.detail}</small></button>`).join('');
  }

  function renderSettings(): void {
    const w = prefs.wind;
    $<HTMLSelectElement>('[data-rea-wind-from]').value = w.from;
    $<HTMLInputElement>('[data-rea-wind-level]').value = String(w.level);
    $('[data-rea-wind-level-out]').textContent = `${w.level} 級（約 ${levelToSpeed(w.level)} m/s）`;
    $<HTMLInputElement>('[data-rea-wind-gust]').value = String(w.gust);
    $('[data-rea-wind-gust-out]').textContent = w.gust ? `${w.gust}` : '沒有';
    $<HTMLSelectElement>('[data-rea-wind-sway]').value = w.sway;
    $<HTMLSelectElement>('[data-rea-sunny]').value = prefs.sunny ? '1' : '0';
    $<HTMLSelectElement>('[data-rea-hour]').value = String(prefs.hour);
    $<HTMLSelectElement>('[data-rea-facing]').value = String(prefs.facingDeg);
    $<HTMLSelectElement>('[data-rea-stick-mode]').value = prefs.stickMode;
    $<HTMLSelectElement>('[data-rea-excam]').value = prefs.examineeCam;
    $<HTMLInputElement>('[data-rea-show-sticks]').checked = prefs.showSticks;
    $<HTMLInputElement>('[data-rea-show-hud]').checked = prefs.showHud;
    $<HTMLInputElement>('[data-rea-narration]').checked = prefs.narration;
    $<HTMLInputElement>('[data-rea-rotor-sound]').checked = prefs.rotorSound;
    $<HTMLInputElement>('[data-rea-captions]').checked = prefs.captions;
    if (!prefs.captions) hideCaption();
    narrator.enabled = prefs.narration;
    rotor.enabled = prefs.rotorSound;
    if (!prefs.narration) { narrator.stop(); hideCaption(); }
    if (!prefs.rotorSound) rotor.silence();
    $('[data-rea-voice-name]').textContent = !narrator.canSpeak
      ? '這個瀏覽器不支援語音，示範時只顯示解說字幕。'
      : narrator.voiceName ? `解說聲音：${narrator.voiceName}` : '解說聲音：使用系統預設中文聲音（沒有找到台灣女聲）';
    const safety = levelToSpeed(w.level) >= 7.5 || levelToSpeed(w.level) + w.gust * 0.6 >= 10;
    $('[data-rea-safety]').textContent = safety ? '⚠️ 已達規範的安全宣告門檻（平均風 7.5 m/s 或陣風 10 m/s），實際考試時監評會做安全宣告。' : '';
    scene.examineeCam = prefs.examineeCam;
    scene.setSun({ hour: prefs.hour, facingDeg: prefs.facingDeg, sunny: prefs.sunny });
    $('[data-rea-sticks]').hidden = !prefs.showSticks;
    $('[data-rea-hud]').hidden = !prefs.showHud;
  }

  function renderHeader(): void {
    const s = subject();
    $('[data-rea-title]').textContent = `術科模擬器・${s.name}`;
    $('[data-rea-start]').textContent = `開始飛・${s.name}`;
    $('[data-rea-brief]').textContent = s.brief;
    $('[data-rea-mode]').textContent = prefs.mode === 'position' ? '定位模式' : '姿態模式';
    $('[data-rea-view]').textContent = scene.view === 'drone' ? '飛機視角 V' : scene.view === 'top' ? '俯視 V' : '考生視角 V';
  }

  function refreshAll(): void {
    renderFilter();
    renderSubjects();
    renderAirframes();
    renderSettings();
    renderHeader();
    savePrefs(prefs);
    if (phase === 'setup') prepareIdle();
  }

  /** 待機畫面：機體停在 H 上。 */
  function prepareIdle(): void {
    const s = subject();
    scene.buildField(fieldOf(s.field), s);
    scene.buildDrone(AIRFRAMES[prefs.airframeId]);
    scene.setDrone(0, 0, 0, 0, 0, 0, false, 0);
    scene.clearTrail();
    $('[data-rea-hint]').textContent = '選好科目與機型後按「開始飛」（Enter）。';
  }

  // ---------- 事件 ----------
  /**
   * 換科目／機型／模式前先結束目前這趟（飛行中、倒數中、評等畫面都一樣），回到準備狀態。
   * 2026-11-08：原本飛行中會直接忽略點擊，使用者以為「點不了」；評等畫面換科目時 3D 考場也沒更新。
   */
  function stopForChange(): void {
    const wasActive = phase !== 'setup';
    session = null;
    demo = null;
    phase = 'setup';
    root.dataset.reaPhase = 'setup';
    $('[data-rea-countdown]').textContent = '';
    stage.classList.remove('rea-demo');
    narrator.stop();
    hideCaption();
    rotor.silence();
    endResult();
    if (wasActive) $('[data-rea-hint]').textContent = '已結束上一趟，換好後按「開始飛」。';
  }

  root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const pick = t.closest<HTMLElement>('[data-rea-pick]');
    if (pick) {
      stopForChange();
      prefs.subjectId = pick.dataset.reaPick!;
      if (!prefs.airframeFixed) prefs.airframeId = subject().defaultAirframe;
      refreshAll();
      return;
    }
    const lic = t.closest<HTMLElement>('[data-rea-lic]');
    if (lic) { prefs.license = lic.dataset.reaLic as Prefs['license']; refreshAll(); return; }
    const af = t.closest<HTMLElement>('[data-rea-af]');
    if (af) { stopForChange(); prefs.airframeId = af.dataset.reaAf as AirframeId; refreshAll(); return; }
    const tab = t.closest<HTMLElement>('[data-rea-tab]');
    if (tab) {
      root.querySelectorAll<HTMLElement>('[data-rea-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === tab)));
      root.querySelectorAll<HTMLElement>('[data-rea-pane]').forEach((p) => (p.hidden = p.dataset.reaPane !== tab.dataset.reaTab));
      return;
    }
  });
  $('[data-rea-mode]').addEventListener('click', () => {
    stopForChange();
    prefs.mode = prefs.mode === 'position' ? 'attitude' : 'position';
    refreshAll();
  });
  $<HTMLInputElement>('[data-rea-af-fixed]').addEventListener('change', (e) => { prefs.airframeFixed = (e.target as HTMLInputElement).checked; refreshAll(); });
  const bindSetting = (sel: string, apply: (v: string, el: HTMLInputElement) => void) =>
    $(sel).addEventListener('input', (e) => { const el = e.target as HTMLInputElement; apply(el.value, el); refreshAll(); });
  bindSetting('[data-rea-wind-from]', (v) => (prefs.wind.from = v as WindFrom));
  bindSetting('[data-rea-wind-level]', (v) => (prefs.wind.level = Number(v)));
  bindSetting('[data-rea-wind-gust]', (v) => (prefs.wind.gust = Number(v)));
  bindSetting('[data-rea-wind-sway]', (v) => (prefs.wind.sway = v as WindSettings['sway']));
  bindSetting('[data-rea-sunny]', (v) => (prefs.sunny = v === '1'));
  bindSetting('[data-rea-hour]', (v) => (prefs.hour = Number(v)));
  bindSetting('[data-rea-facing]', (v) => (prefs.facingDeg = Number(v)));
  bindSetting('[data-rea-stick-mode]', (v) => (prefs.stickMode = v as StickMode));
  bindSetting('[data-rea-excam]', (v) => (prefs.examineeCam = v as ExamineeCam));
  bindSetting('[data-rea-show-sticks]', (_v, el) => (prefs.showSticks = el.checked));
  bindSetting('[data-rea-show-hud]', (_v, el) => (prefs.showHud = el.checked));
  bindSetting('[data-rea-narration]', (_v, el) => (prefs.narration = el.checked));
  bindSetting('[data-rea-rotor-sound]', (_v, el) => (prefs.rotorSound = el.checked));
  bindSetting('[data-rea-captions]', (_v, el) => (prefs.captions = el.checked));
  $('[data-rea-reset-prefs]').addEventListener('click', () => { Object.assign(prefs, { ...DEFAULT_PREFS, wind: { ...DEFAULT_WIND }, subjectId: prefs.subjectId }); refreshAll(); });

  $('[data-rea-start]').addEventListener('click', () => start(false));
  $('[data-rea-demo]').addEventListener('click', () => start(true));
  $('[data-rea-restart]').addEventListener('click', () => restart());
  $('[data-rea-view]').addEventListener('click', () => cycleView());
  $('[data-rea-full]').addEventListener('click', () => toggleFull());

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.closest('input,select,textarea')) return;
    if (e.key === 'Enter' && phase === 'setup') start(false);
    else if (e.key === 'Backspace') { e.preventDefault(); restart(); }
    else if (e.key === 'v' || e.key === 'V') cycleView();
    else if (e.key === 'g' || e.key === 'G') toggleFull();
  };
  window.addEventListener('keydown', onKey);

  function cycleView(): void {
    scene.view = scene.view === 'examinee' ? 'drone' : scene.view === 'drone' ? 'top' : 'examinee';
    renderHeader();
  }

  function toggleFull(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.requestFullscreen?.().catch(() => undefined);
  }

  // ---------- 飛行流程 ----------
  function start(isDemo: boolean): void {
    const s = subject();
    if (!s.implemented) return;
    endResult();
    session = new FlightSession({ subject: s, airframeId: prefs.airframeId, mode: isDemo ? 'position' : prefs.mode, wind: { ...prefs.wind } });
    demo = isDemo ? new Autopilot(AIRFRAMES[prefs.airframeId]) : null;
    scene.buildField(fieldOf(s.field), s);
    scene.buildDrone(AIRFRAMES[prefs.airframeId]);
    scene.clearTrail();
    phase = 'countdown';
    countdownT = isDemo ? 0.01 : 3;
    stage.classList.toggle('rea-demo', isDemo);
    // 使用者剛按了按鈕：此時才能喚醒音訊（瀏覽器規定）
    rotor.unlock();
    narratedStep = -1;
    narrator.stop();
    hideCaption();
    // 加速示範（自動化測試用）不念解說
    if (isDemo && demoSpeed === 1) narrator.speak(introNarration(s), true);
  }

  function restart(): void {
    if (phase === 'setup') return;
    session = null;
    demo = null;
    phase = 'setup';
    $('[data-rea-countdown]').textContent = '';
    stage.classList.remove('rea-demo');
    narrator.stop();
    hideCaption();
    rotor.silence();
    endResult();
    prepareIdle();
  }

  function finish(): void {
    if (!session) return;
    const result = session.result();
    phase = 'result';
    root.dataset.reaPhase = 'result';
    replay = { samples: session.samples, t: 0, speed: 1, playing: false, result, coloring: 'time' };
    scene.setTrailFromSamples(session.samples);
    showResult();
    rotor.silence();
    if (demo && demoSpeed === 1) narrator.speak(result.failure ? '示範結束。' : '示範完成。接下來換你試試看，按「開始飛」就可以練習這個科目。');
    // 真人飛完（示範不算）：沿用既有機制，已登入學員時把成績摘要存入成長日誌「模擬練飛紀錄」
    if (!demo) {
      const s = subject();
      void syncPractice({
        mode: 'exam',
        title: `術科模擬・${s.name}`,
        grade: TIER_LABELS[result.grade],
        passed: !result.failure && result.finished,
        duration_seconds: Math.round(result.durationS),
        input_source: normalizeInputSource(lastSource.kind, lastSource.label),
        summary: {
          subject: s.id, airframe: session.opts.airframeId, mode: session.opts.mode,
          wind_mps: levelToSpeed(session.opts.wind.level), failure: result.failure,
          steps: result.steps.map((st) => ({ label: st.label, grade: TIER_LABELS[st.tier] })),
          note: '練習評等，非民航局官方評分',
        },
      }).then(showPracticeToast);
    }
  }

  function endResult(): void {
    replay = null;
    const box = $('[data-rea-result]');
    box.hidden = true;
    box.innerHTML = '';
  }

  /** 標準化指令 + 日本手換軸（只對實體遙控器；手機與原子筆固定為美國手）。 */
  function pilotCommand(): Command {
    const r = input.tick();
    const c = r.command;
    let cmd: Command = { throttle: c.throttle, pitch: c.pitch, roll: c.roll, yaw: c.yaw };
    const isGamepad = r.source.kind === 'adapter' && r.source.adapterId === input.gamepad.id;
    if (prefs.stickMode === 'mode1' && isGamepad) {
      cmd = { ...cmd, throttle: 0.5 + c.pitch / 2, pitch: (c.throttle - 0.5) * 2 };
    }
    const src = $('[data-rea-src]');
    const label = r.source.kind === 'adapter' ? r.source.label : '鍵盤';
    lastSource = { kind: r.source.kind, label };
    if (src.textContent !== `輸入：${label}`) src.textContent = `輸入：${label}`;
    return cmd;
  }

  // ---------- 評等與回放 ----------
  function showResult(): void {
    if (!replay) return;
    const r = replay.result;
    const s = subject();
    const box = $('[data-rea-result]');
    const rows = r.steps.map((st) => `
      <tr class="t${st.tier}"><td>${esc(st.label)}</td><td><b>${TIER_LABELS[st.tier]}</b></td>
      <td>${st.metrics.map((m) => `<span class="m t${m.tier}">${esc(m.label)} ${m.value}${m.unit}</span>`).join('')}</td>
      <td><button class="rea-link" data-rea-seek="${st.startT}">看這段</button></td></tr>`).join('');
    const markers = r.steps.map((st) => `<i style="left:${(st.startT / Math.max(r.durationS, 1)) * 100}%" title="${esc(st.label)}"></i>`).join('');
    box.innerHTML = `
      <div class="rea-result-head">
        <div><small>練習評等</small><div class="rea-grade t${r.grade}">${TIER_LABELS[r.grade]}</div></div>
        <div class="rea-result-meta">
          <b>${esc(s.name)}</b>・${AIRFRAMES[session?.opts.airframeId ?? prefs.airframeId].name}・${session?.opts.mode === 'position' ? '定位' : '姿態'}模式${demo ? '・示範' : ''}<br>
          全程 ${Math.round(r.durationS)} 秒・風 ${levelToSpeed(prefs.wind.level)} m/s${r.failure ? `<br><span class="rea-fail">❌ ${esc(r.failure)}</span>` : ''}
        </div>
        <div class="rea-result-btns"><button class="rea-primary" data-rea-again>再飛一次</button><button class="rea-secondary" data-rea-close>換科目</button></div>
      </div>
      <p class="rea-disclaimer">${esc(r.disclaimer)}</p>
      <div class="rea-result-body">
        <div class="rea-track">
          <canvas width="360" height="300" data-rea-track></canvas>
          <label>軌跡上色 <select data-rea-coloring><option value="time">照時間</option><option value="cross">照偏離航線</option><option value="heading">照機頭偏差</option></select></label>
        </div>
        <div class="rea-table-wrap"><table class="rea-table"><thead><tr><th>步驟</th><th>評等</th><th>指標</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4">沒有完成任何步驟</td></tr>'}</tbody></table></div>
      </div>
      <div class="rea-replay">
        <button class="rea-chip" data-rea-play>▶ 回放</button>
        ${[1, 1.5, 3, 6].map((x) => `<button class="rea-chip${x === 1 ? ' on' : ''}" data-rea-speed="${x}">×${x}</button>`).join('')}
        <div class="rea-scrub"><input type="range" min="0" max="${r.durationS.toFixed(2)}" step="0.05" value="0" data-rea-scrub><div class="rea-markers">${markers}</div></div>
        <span data-rea-time>00:00 / ${fmt(r.durationS)}</span>
      </div>`;
    box.hidden = false;
    box.querySelector('[data-rea-again]')!.addEventListener('click', () => start(!!demo));
    box.querySelector('[data-rea-close]')!.addEventListener('click', () => restart());
    box.querySelector('[data-rea-play]')!.addEventListener('click', () => {
      rotor.unlock(); // 回放時也有槳葉聲音
      if (!replay) return;
      if (replay.t >= r.durationS - 0.05) replay.t = 0;
      replay.playing = !replay.playing;
      updateReplayUi();
    });
    box.querySelectorAll<HTMLElement>('[data-rea-speed]').forEach((b) => b.addEventListener('click', () => {
      if (!replay) return;
      replay.speed = Number(b.dataset.reaSpeed);
      box.querySelectorAll('[data-rea-speed]').forEach((x) => x.classList.toggle('on', x === b));
    }));
    box.querySelector<HTMLInputElement>('[data-rea-scrub]')!.addEventListener('input', (e) => {
      if (!replay) return;
      replay.t = Number((e.target as HTMLInputElement).value);
      replay.playing = false;
      updateReplayUi();
    });
    box.querySelectorAll<HTMLElement>('[data-rea-seek]').forEach((b) => b.addEventListener('click', () => {
      if (!replay) return;
      replay.t = Number(b.dataset.reaSeek);
      replay.playing = true;
      updateReplayUi();
    }));
    box.querySelector<HTMLSelectElement>('[data-rea-coloring]')!.addEventListener('change', (e) => {
      if (!replay) return;
      replay.coloring = (e.target as HTMLSelectElement).value as TrackColoring;
      paintTrack();
    });
    paintTrack();
    updateReplayUi();
  }

  function paintTrack(): void {
    if (!replay) return;
    const cv = root.querySelector<HTMLCanvasElement>('[data-rea-track]');
    if (cv) drawTrack(cv, fieldOf(subject().field), replay.samples, replay.coloring, replay.t, subject().track);
  }

  function updateReplayUi(): void {
    if (!replay) return;
    const box = $('[data-rea-result]');
    const scrub = box.querySelector<HTMLInputElement>('[data-rea-scrub]');
    if (scrub) scrub.value = String(replay.t);
    const time = box.querySelector('[data-rea-time]');
    if (time) time.textContent = `${fmt(replay.t)} / ${fmt(replay.result.durationS)}`;
    const play = box.querySelector('[data-rea-play]');
    if (play) play.textContent = replay.playing ? '⏸ 暫停' : '▶ 回放';
  }

  // ---------- 主迴圈 ----------
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const hint = $('[data-rea-hint]');
    let cmd: Command = { throttle: 0.5, pitch: 0, roll: 0, yaw: 0 };

    if (phase === 'setup') {
      cmd = pilotCommand(); // 讓使用者在起飛前就看得到打桿位置、確認連線
    } else if (phase === 'countdown' && session) {
      cmd = pilotCommand();
      countdownT -= dt;
      $('[data-rea-countdown]').textContent = countdownT > 0 ? String(Math.ceil(countdownT)) : '';
      hint.textContent = '說「3、2、1、Go」：油門推高起飛';
      if (countdownT <= 0) { phase = 'flying'; $('[data-rea-countdown]').textContent = ''; }
    } else if (phase === 'flying' && session) {
      const sess = session;
      const ap = demo;
      // 每幀讀一次輸入，同一幀內的物理子步共用（避免每秒輪詢 120 次裝置）
      const userCmd = ap ? null : pilotCommand();
      if (ap) for (let k = 0; k < demoSpeed; k++) sess.advance(dt, (s) => ap.command(s.runner, s.state));
      else sess.advance(dt, () => userCmd!);
      cmd = sess.lastCmd;
      const st = sess.state;
      scene.pushTrail(st.x, st.y, st.h);
      const step = sess.runner.step;
      if (ap && demoSpeed === 1 && step && sess.runner.index !== narratedStep) {
        narratedStep = sess.runner.index;
        narrator.speak(stepNarration(step));
      }
      const holdLeft = step && step.kind === 'hold' ? '' : '';
      hint.textContent = sess.runner.returnCalled && step?.kind === 'emergency-return'
        ? '🚨 緊急返航！立刻停住，再飛回較近的八字內圈降落'
        : step ? `下一步：${step.label}${holdLeft}` : '完成';
      if (sess.done) finish();
    } else if (phase === 'result' && replay) {
      if (replay.playing) {
        replay.t = Math.min(replay.result.durationS, replay.t + dt * replay.speed);
        if (replay.t >= replay.result.durationS) replay.playing = false;
        updateReplayUi();
        paintTrack();
      }
      const smp = sampleAt(replay.samples, replay.t);
      if (smp) {
        cmd = smp.cmd;
        scene.setDrone(smp.x, smp.y, smp.h, smp.heading, smp.pitchDeg, smp.rollDeg, smp.h > 0.02, dt);
        hint.textContent = `回放：${subject().steps[smp.stepIndex]?.label ?? ''}`;
      }
    }

    if (session && phase !== 'result') {
      const st = session.state;
      scene.setDrone(st.x, st.y, st.h, st.heading, st.pitchDeg, st.rollDeg, !st.landed, dt);
      scene.setWindSock(session.wind.at(session.t));
      const hud = $('[data-rea-hud]');
      hud.textContent = `高度 ${st.h.toFixed(1)} m・速度 ${horizontalSpeed(st).toFixed(1)} m/s・機頭 ${Math.round(norm360(st.heading))}°`;
      // 給自動化測試讀取的數值（不影響畫面）
      hud.dataset.alt = st.h.toFixed(3);
      hud.dataset.x = st.x.toFixed(3);
      hud.dataset.y = st.y.toFixed(3);
      hud.dataset.heading = st.heading.toFixed(1);
      root.dataset.reaPhase = phase;
    }
    // 槳葉聲音：倒數／飛行中跟著真實狀態；回放播放中跟著紀錄；其他時候停槳
    const afId = session?.opts.airframeId ?? prefs.airframeId;
    if (session && (phase === 'flying' || phase === 'countdown')) {
      rotor.update(rotorTarget(afId, cmd, session.state));
    } else if (phase === 'result' && replay?.playing) {
      const smp = sampleAt(replay.samples, replay.t);
      rotor.update(smp ? rotorTarget(afId, smp.cmd, { armed: true, landed: smp.h < 0.02, crashed: false, pitchDeg: smp.pitchDeg, rollDeg: smp.rollDeg }) : { spin: 0, freq: 0, gain: 0 });
    } else {
      rotor.update({ spin: 0, freq: 0, gain: 0 });
    }
    drawSticks(cmd);
    scene.render();
  }

  function drawSticks(c: Command): void {
    if (!prefs.showSticks) return;
    // 畫面上的搖桿以使用者選的手別呈現
    const l = prefs.stickMode === 'mode2' ? { x: c.yaw, y: (c.throttle - 0.5) * 2 } : { x: c.yaw, y: c.pitch };
    const r = prefs.stickMode === 'mode2' ? { x: c.roll, y: c.pitch } : { x: c.roll, y: (c.throttle - 0.5) * 2 };
    const set = (el: HTMLElement, p: { x: number; y: number }) => {
      el.style.left = `${50 + p.x * 40}%`;
      el.style.top = `${50 - p.y * 40}%`;
    };
    set($('[data-rea-stick-l]'), l);
    set($('[data-rea-stick-r]'), r);
  }

  refreshAll();
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      unmountLink();
      narrator.stop();
      rotor.dispose();
      scene.dispose();
    },
  };
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
