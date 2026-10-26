/**
 * 科目 E 教學練習 UI（第四輪）— 獨立的 HUD／按鈕／結果面板模組。
 *
 * 職責邊界（架構師第四輪指令 C1）：
 *  - 只「顯示」與「派發按鈕事件」：練習狀態、目前航段、目標／實際高度、
 *    高度偏差、航線偏離提示、暫停／恢復／重新開始、教學練習結果摘要；
 *  - **不直接修改飛控或考試評分**（本模組完全不 import 飛控／評分模組）；
 *  - **不重複實作判定演算法**：所有狀態與顯示資料皆由呼叫端自
 *    penta-training.ts（pentaTrainingView／buildPentaPracticeRecord）取得，
 *    本模組僅做格式化與 DOM 更新；
 *  - 畫面固定標示「非官方測驗，僅供練習」；結果只能稱為「教學練習記錄」。
 */

import type { PentaRoute } from './penta';
import type {
  PentaPracticeRecord,
  PentaTrainingTolerances,
  PentaTrainingView,
} from './penta-training';

/** 按鈕事件（由呼叫端接到練習狀態機與飛控重置）。 */
export type PentaTrainingUIAction = 'begin' | 'pause' | 'resume' | 'restart' | 'abort';

/** 動作按鈕的 dataset 屬性名（型別覆蓋全部動作；漏一個 tsc 即報錯）。
 *  不用字串拼接產生 dataset 鍵：動作名為小寫時會產生 data-penta-trainingbegin
 *  （缺連字符），與測試契約 data-penta-training-begin 不符（第四輪實測教訓）。 */
const BTN_ATTR: Record<PentaTrainingUIAction, string> = {
  begin: 'pentaTrainingBegin',
  pause: 'pentaTrainingPause',
  resume: 'pentaTrainingResume',
  restart: 'pentaTrainingRestart',
  abort: 'pentaTrainingAbort',
};

export interface PentaTrainingUIOptions {
  /** 教學航線（僅取 altitudeM 與 note 供顯示）。 */
  route: PentaRoute;
  /** 教學容差（模擬假設，非官方；顯示用）。 */
  tolerances: PentaTrainingTolerances;
  /** 固定免責文字（例：非官方測驗，僅供練習）。 */
  disclaimerText: string;
  /** 練習記錄固定標語（PENTA_PRACTICE_NOTE）。 */
  practiceNote: string;
  /** 按鈕回呼（呼叫端負責狀態機轉換與飛控重置）。 */
  onAction: (action: PentaTrainingUIAction) => void;
}

/** 數值格式：一位小數。 */
const fmt1 = (v: number): string => v.toFixed(1);
/** 帶符號偏差（+／−，U+2212 與 penta-training.ts 提示格式一致）。 */
const fmtSigned = (v: number): string => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)} m`;

const CHIP_STYLE =
  'font-size:11px;padding:2px 8px;border-radius:8px;background:#1b3346;color:#dfe;white-space:nowrap;';
const CHIP_OVER_STYLE = 'font-size:11px;padding:2px 8px;border-radius:8px;background:#5a4318;color:#ffd28a;white-space:nowrap;';
const BTN_STYLE =
  'font-size:11px;padding:4px 10px;border:1px solid #4a6a82;border-radius:6px;background:#123;color:#9ad0ff;cursor:pointer;';

export class PentaTrainingUI {
  /** 訓練列（呼叫端插入頂欄下方的 flex 流）。 */
  readonly bar: HTMLDivElement;
  /** 結果浮層（呼叫端插入舞台；absolute 定位）。 */
  readonly overlay: HTMLDivElement;

  private readonly options: PentaTrainingUIOptions;
  private readonly buttons: Record<PentaTrainingUIAction, HTMLButtonElement>;
  private readonly stateChip: HTMLSpanElement;
  private readonly segmentChip: HTMLSpanElement;
  private readonly targetAltChip: HTMLSpanElement;
  private readonly actualAltChip: HTMLSpanElement;
  private readonly altDevChip: HTMLSpanElement;
  private readonly routeDevChip: HTMLSpanElement;
  private readonly hintChip: HTMLSpanElement;
  /** 顯示快取（避免每幀重寫 DOM）。 */
  private cacheKey = '';
  private resultVisible = false;
  private disposed = false;

  constructor(options: PentaTrainingUIOptions) {
    this.options = options;

    // ---- 訓練列 ----
    this.bar = document.createElement('div');
    this.bar.dataset.pentaTrainingBar = 'true';
    this.bar.style.cssText =
      'flex:0 0 auto;display:flex;flex-direction:column;gap:4px;padding:5px 10px;background:rgba(8,18,28,0.94);border-bottom:1px solid #22415a;z-index:20;';

    const controlsRow = document.createElement('div');
    controlsRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;';
    this.bar.appendChild(controlsRow);

    const disclaimer = document.createElement('span');
    disclaimer.textContent = options.disclaimerText;
    disclaimer.dataset.pentaTrainingDisclaimer = 'true';
    disclaimer.style.cssText =
      'font-size:11px;padding:2px 10px;border-radius:10px;background:rgba(180,40,40,0.85);color:#fff;white-space:nowrap;';
    controlsRow.appendChild(disclaimer);

    const mkBtn = (action: PentaTrainingUIAction, label: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset[BTN_ATTR[action]] = 'true';
      b.style.cssText = BTN_STYLE;
      b.addEventListener('click', () => {
        // 失焦：避免後續空白鍵／Enter 重複觸發聚焦按鈕。
        b.blur();
        options.onAction(action);
      });
      controlsRow.appendChild(b);
      return b;
    };
    this.buttons = {
      begin: mkBtn('begin', '開始練習'),
      pause: mkBtn('pause', '暫停'),
      resume: mkBtn('resume', '恢復'),
      restart: mkBtn('restart', '重新開始'),
      abort: mkBtn('abort', '中止練習'),
    };

    const chipsRow = document.createElement('div');
    chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;';
    this.bar.appendChild(chipsRow);

    /** chip 的 dataset 屬性名（型別覆蓋全部 chip；屬性名皆為可 grep 字面量）。 */
    const CHIP_ATTR = {
      state: 'pentaTrainingState',
      segment: 'pentaTrainingSegment',
      targetAlt: 'pentaTrainingTargetAlt',
      actualAlt: 'pentaTrainingActualAlt',
      altDev: 'pentaTrainingAltDev',
      routeDev: 'pentaTrainingRouteDev',
      hint: 'pentaTrainingHint',
    } as const;
    type PentaChipKey = keyof typeof CHIP_ATTR;

    const mkChip = (key: PentaChipKey): HTMLSpanElement => {
      const s = document.createElement('span');
      s.dataset[CHIP_ATTR[key]] = 'true';
      s.style.cssText = CHIP_STYLE;
      chipsRow.appendChild(s);
      return s;
    };
    this.stateChip = mkChip('state');
    this.segmentChip = mkChip('segment');
    this.targetAltChip = mkChip('targetAlt');
    this.actualAltChip = mkChip('actualAlt');
    this.altDevChip = mkChip('altDev');
    this.routeDevChip = mkChip('routeDev');
    this.hintChip = mkChip('hint');
    this.hintChip.style.cssText =
      'font-size:11px;padding:2px 8px;border-radius:8px;color:#ffd28a;white-space:nowrap;display:none;';

    // ---- 結果浮層（教學練習記錄；非官方成績）----
    this.overlay = document.createElement('div');
    this.overlay.dataset.pentaTrainingResult = 'true';
    this.overlay.style.cssText =
      'position:absolute;inset:0;background:#08121c;color:#fff;overflow:auto;padding:16px;display:none;z-index:30;font:13px/1.5 sans-serif;';
  }

  /** 以 penta-training.ts 推導的視圖更新畫面（純顯示；不含判定）。 */
  update(view: PentaTrainingView): void {
    if (this.disposed) return;
    const { tolerances } = this.options;
    const altText = view.actualAltitudeM === null ? '—' : `${fmt1(view.actualAltitudeM)} m`;
    const altDevText = view.altitudeDeviationM === null ? '—' : fmtSigned(view.altitudeDeviationM);
    const routeDevText = view.routeDeviationM === null ? '—' : `${fmt1(view.routeDeviationM)} m`;
    const hintText = view.hint ?? '';

    const key = [
      view.phaseLabel,
      view.currentSegmentLabel ?? '—',
      view.targetAltitudeM.toFixed(1),
      altText,
      altDevText,
      routeDevText,
      hintText,
      view.canBegin,
      view.canPause,
      view.canResume,
      view.canRestart,
      view.canAbort,
    ].join('|');
    if (key === this.cacheKey) return;
    this.cacheKey = key;

    this.stateChip.textContent = `訓練狀態：${view.phaseLabel}`;
    this.stateChip.dataset.phase = view.phase;
    this.stateChip.dataset.paused = String(view.paused);
    this.segmentChip.textContent = `目前航段：${view.currentSegmentLabel ?? '—'}`;
    this.targetAltChip.textContent = `目標高度 ${fmt1(view.targetAltitudeM)} m`;
    this.actualAltChip.textContent = `實際高度 ${altText}`;
    this.altDevChip.textContent = `高度偏差 ${altDevText}`;
    this.routeDevChip.textContent = `偏離教學航線 ${routeDevText}`;
    this.hintChip.textContent = hintText;
    this.hintChip.style.display = hintText ? '' : 'none';

    // 超出教學容差時琥珀色提示（僅視覺；不影響任何判定）。
    const altOver =
      view.altitudeDeviationM !== null && Math.abs(view.altitudeDeviationM) > tolerances.altitudeToleranceM;
    const routeOver = view.routeDeviationM !== null && view.routeDeviationM > tolerances.routeDeviationToleranceM;
    this.altDevChip.style.cssText = altOver ? CHIP_OVER_STYLE : CHIP_STYLE;
    this.routeDevChip.style.cssText = routeOver ? CHIP_OVER_STYLE : CHIP_STYLE;

    const setBtn = (b: HTMLButtonElement, enabled: boolean): void => {
      b.disabled = !enabled;
      b.style.opacity = enabled ? '1' : '0.48';
      b.style.cursor = enabled ? 'pointer' : 'not-allowed';
    };
    setBtn(this.buttons.begin, view.canBegin);
    setBtn(this.buttons.pause, view.canPause);
    setBtn(this.buttons.resume, view.canResume);
    setBtn(this.buttons.restart, view.canRestart);
    setBtn(this.buttons.abort, view.canAbort);
  }

  /** 顯示教學練習記錄（完成或中止時由呼叫端呼叫；內容不含任何官方評等）。 */
  showResult(record: PentaPracticeRecord): void {
    if (this.disposed) return;
    const { tolerances, practiceNote, disclaimerText } = this.options;
    const stateText = record.completed
      ? '已完成五邊練習'
      : record.aborted
        ? `已中止（${record.abortReason ?? '—'}）`
        : '練習進行中';
    const segRows = record.segments
      .map((s) => {
        const dur = s.endedAtT !== null ? s.endedAtT - s.startedAtT : 0;
        return `<tr data-penta-result-segment="${s.legIndex}" data-reached="${s.reached}">
          <td style="padding:3px 8px">${s.label}</td>
          <td style="padding:3px 8px;text-align:center">${dur.toFixed(1)} s</td>
          <td style="padding:3px 8px;text-align:center">${s.maxAltitudeDeviationM.toFixed(2)} m</td>
          <td style="padding:3px 8px;text-align:center">${s.maxRouteDeviationM.toFixed(2)} m</td>
          <td style="padding:3px 8px;text-align:center">${s.reached ? '已到達' : '未到達'}</td>
        </tr>`;
      })
      .join('');

    this.overlay.dataset.resultState = record.completed
      ? 'complete'
      : record.aborted
        ? 'aborted'
        : 'open';
    this.overlay.innerHTML = `
      <div style="max-width:680px;margin:0 auto;font-size:13px;">
        <h2 style="margin:0 0 6px;font-size:16px;">教學練習記錄（非官方成績）</h2>
        <span data-penta-training-result-disclaimer style="font-size:11px;padding:2px 10px;border-radius:10px;background:rgba(180,40,40,0.85);color:#fff;white-space:nowrap;">${disclaimerText}</span>
        <p style="color:#ffd28a;margin:8px 0;">${practiceNote}</p>
        <div>狀態：${stateText}</div>
        <div>練習時長：${record.durationS.toFixed(1)} s</div>
        <div>最大高度偏差：${record.maxAltitudeDeviationM.toFixed(2)} m（教學容差 ±${fmt1(tolerances.altitudeToleranceM)} m，模擬假設，非官方）</div>
        <div>最大航線偏離：${record.maxRouteDeviationM.toFixed(2)} m（教學容差 ${fmt1(tolerances.routeDeviationToleranceM)} m，模擬假設，非官方）</div>
        <div>重新開始次數：${record.restartCount}</div>
        <table style="width:100%;border-collapse:collapse;margin:10px 0;">
          <thead><tr style="color:#9ad0ff;">
            <th style="text-align:left;padding:3px 8px;">航段</th>
            <th style="padding:3px 8px;">用時</th>
            <th style="padding:3px 8px;">最大高度偏差</th>
            <th style="padding:3px 8px;">最大航線偏離</th>
            <th style="padding:3px 8px;">到達</th>
          </tr></thead>
          <tbody>${segRows || '<tr><td colspan="5" style="padding:6px 8px;opacity:.7">尚無完成航段</td></tr>'}</tbody>
        </table>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button data-penta-training-result-restart style="padding:6px 14px;border-radius:8px;border:1px solid #4a7;background:#1d3a2b;color:#dff;cursor:pointer;">重新開始練習</button>
          <button data-penta-training-result-close style="padding:6px 14px;border-radius:8px;border:1px solid #4a6a82;background:#123;color:#9ad0ff;cursor:pointer;">關閉</button>
        </div>
      </div>`;
    this.overlay.style.display = 'block';
    this.resultVisible = true;
    this.overlay
      .querySelector<HTMLButtonElement>('[data-penta-training-result-restart]')
      ?.addEventListener('click', (e) => {
        (e.currentTarget as HTMLButtonElement).blur();
        this.options.onAction('restart');
      });
    this.overlay
      .querySelector<HTMLButtonElement>('[data-penta-training-result-close]')
      ?.addEventListener('click', (e) => {
        (e.currentTarget as HTMLButtonElement).blur();
        this.hideResult();
      });
  }

  /** 關閉結果浮層（不改變練習狀態）。 */
  hideResult(): void {
    if (this.disposed) return;
    this.overlay.style.display = 'none';
    this.resultVisible = false;
  }

  /** 結果浮層目前是否顯示中（供應用層判斷「完成／中止只提示一次」）。 */
  get isResultVisible(): boolean {
    return this.resultVisible;
  }

  dispose(): void {
    this.disposed = true;
    this.bar.remove();
    this.overlay.remove();
  }
}
