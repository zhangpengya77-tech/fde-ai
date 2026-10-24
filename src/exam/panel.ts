/**
 * 考試即時面板（CAA 專業基本級術科模擬，HUD）——右側窄欄版。
 *
 * 提供：
 *  - 小地圖（Canvas，固定小尺寸）：操作區、八字雙圓、角錐、H 起降點、機體與航跡。
 *  - 當前飛行模式（手動 / 姿態 / 定位）與相機視角（考生／追隨／俯視全景）。
 *  - 輸入來源與生效標定：預設收成一行摘要，點擊展開完整內容。
 *  - 引導狀態：考試模式（exam）下引導強制關停，以小型狀態標籤呈現（不佔版面）。
 *
 * 版面約束（教師實測回報 2026-10-23）：面板為右側窄欄、不得遮擋場景中央；
 * 1280×720／1366×768／1920×1080 皆可用。
 *
 * 純函式輔助（minimapProject / isGuidanceForcedOff）不依賴 DOM，可單元測試；
 * ExamHud 類別負責 DOM/Canvas 渲染，僅在瀏覽器執行期使用。
 */

import type { ExamField } from './field';
import type { ExamInputInfo } from './exam-input';
import type { ExamCameraView } from './flow';
import type { CameraAdjust } from './camera';
import { zhHant as L } from '../i18n/zh-Hant';

export type ExamHudMode = 'manual' | 'attitude' | 'position';

/** HUD 風況顯示（平均風與陣風峰值，另附當前瞬時風速）。 */
export interface ExamHudWind {
  /** 平均風（m/s）。 */
  meanMps: number;
  /** 陣風峰值上限（m/s）。 */
  gustPeakMps: number;
  /** 當前瞬時風速（m/s）。 */
  instantMps: number;
  /** 是否已達安全宣告門檻。 */
  declaring: boolean;
}

/** 世界座標 → 小地圖像素座標（Z 向下為正）。 */
export function minimapProject(
  field: ExamField,
  x: number,
  z: number,
  widthPx: number,
  heightPx: number,
  marginM = 2,
): { px: number; py: number } {
  const xRange = field.operationArea.halfWidthM + marginM;
  const zRange = field.operationArea.halfLengthM + marginM;
  const px = ((x + xRange) / (2 * xRange)) * widthPx;
  const py = ((z + zRange) / (2 * zRange)) * heightPx;
  return { px, py };
}

/** 考試模式是否強制關閉引導（不得提供任何飛行輔助）。 */
export function isGuidanceForcedOff(examMode: boolean): boolean {
  return examMode;
}

/** 固定顯示的免責聲明（HUD／成績單／頂部橫幅共用同一句，避免各入口措辭漂移）。 */
export function examDisclaimerText(): string {
  return L.exam.disclaimer;
}

export interface ExamHudOptions {
  widthPx?: number;
  heightPx?: number;
}

/**
 * 考試 HUD（即時面板，右側窄欄）。掛載於給定父元素，提供小地圖、模式顯示與
 * 輸入來源／標定摘要（點擊展開）。
 */
export class ExamHud {
  private readonly field: ExamField;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly modeLabel: HTMLElement;
  private readonly cameraLabel: HTMLElement;
  private readonly windLine: HTMLElement;
  private readonly guidanceTag: HTMLElement;
  private readonly statusTag: HTMLElement;
  private readonly inputSummary: HTMLElement;
  private readonly inputDetails: HTMLElement;

  private mode: ExamHudMode = 'position';
  private cameraView: ExamCameraView = 'examinee';
  private cameraAdjust: CameraAdjust = { fovDeg: 55, orbitYawDeg: 0, orbitPitchDeg: 0 };
  private examMode = false;
  private guidanceEnabled = false;
  private inputExpanded = false;
  private windText = '';
  private drone: { x: number; z: number; headingDeg: number } | null = null;
  private trajectory: Array<{ x: number; z: number }> = [];

  constructor(field: ExamField, parent: HTMLElement, options: ExamHudOptions = {}) {
    this.field = field;
    // 右側窄欄：固定寬度，小地圖固定小尺寸（不得遮擋場景中央）。
    this.widthPx = options.widthPx ?? 216;
    this.heightPx = options.heightPx ?? 140;

    this.root = document.createElement('div');
    this.root.className = 'exam-hud';
    this.root.style.cssText =
      'position:relative;width:240px;background:rgba(0,0,0,0.62);color:#fff;border-radius:8px;padding:6px 8px;font:12px/1.4 sans-serif;';

    const title = document.createElement('div');
    title.textContent = L.exam.panel.title;
    title.style.cssText = 'font-weight:bold;margin-bottom:4px;font-size:12px;';
    this.root.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;
    this.canvas.style.cssText = 'display:block;margin:0 auto;background:#0b1d2a;border:1px solid #2a4a63;border-radius:4px;';
    this.root.appendChild(this.canvas);

    const info = document.createElement('div');
    info.style.cssText = 'display:flex;justify-content:space-between;margin-top:4px;gap:8px;';
    this.modeLabel = document.createElement('span');
    this.cameraLabel = document.createElement('span');
    info.appendChild(this.modeLabel);
    info.appendChild(this.cameraLabel);
    this.root.appendChild(info);

    // 風況：平均風與陣風峰值（陣峰＝瞬時風速上限），常駐顯示。
    this.windLine = document.createElement('div');
    this.windLine.style.cssText = 'margin-top:2px;font-size:11px;color:#ffd28a;';
    this.windLine.dataset.hudWind = 'true';
    this.windLine.textContent = '風：—';
    this.root.appendChild(this.windLine);

    // 輸入來源與生效標定：預設一行摘要，點擊展開完整內容。
    this.inputSummary = document.createElement('div');
    this.inputSummary.style.cssText =
      'margin-top:4px;color:#ffd;cursor:pointer;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    this.inputSummary.title = L.exam.panel.inputSummaryHint;
    this.inputSummary.addEventListener('click', () => {
      this.inputExpanded = !this.inputExpanded;
      this.renderInputInfo();
    });
    this.root.appendChild(this.inputSummary);
    this.inputDetails = document.createElement('div');
    this.inputDetails.style.cssText =
      'margin-top:2px;font-size:11px;color:#bcd;max-width:224px;word-break:break-all;display:none;';
    this.root.appendChild(this.inputDetails);

    // 狀態標籤列（考試中／引導停用）——小型標籤，不佔橫幅。
    const tagRow = document.createElement('div');
    tagRow.style.cssText = 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;';
    this.statusTag = document.createElement('span');
    this.statusTag.style.cssText = 'font-size:11px;padding:1px 8px;border-radius:8px;background:#2d6;color:#04240f;';
    this.guidanceTag = document.createElement('span');
    this.guidanceTag.style.cssText = 'font-size:11px;padding:1px 8px;border-radius:8px;background:#555;color:#ddd;';
    tagRow.appendChild(this.statusTag);
    tagRow.appendChild(this.guidanceTag);
    this.root.appendChild(tagRow);

    // 固定免責聲明：面板常駐顯示（航跡回放時報告面板會被隱藏，只靠頂部橫幅不夠）。
    const disclaimerLine = document.createElement('div');
    disclaimerLine.textContent = L.exam.disclaimer;
    disclaimerLine.style.cssText = 'margin-top:4px;font-size:10px;color:#ffd76b;';
    this.root.appendChild(disclaimerLine);

    parent.appendChild(this.root);
    this.render();
  }

  setMode(mode: ExamHudMode): void {
    this.mode = mode;
    this.render();
  }

  /** 目前相機視角（考生／追隨／俯視全景）。 */
  setCameraView(view: ExamCameraView, adjust: CameraAdjust = this.cameraAdjust): void {
    this.cameraView = view;
    this.cameraAdjust = adjust;
    this.render();
  }

  /**
   * 更新 HUD 風況：平均風與陣風峰值（需求：HUD 必須顯示這兩個值）。
   * 每帧呼叫，因此以字串比對避免無謂的 DOM 寫入。
   */
  setWind(wind: ExamHudWind): void {
    const text = `風：平均 ${wind.meanMps.toFixed(1)} · 陣峰 ${wind.gustPeakMps.toFixed(1)} m/s（即時 ${wind.instantMps.toFixed(1)}）${wind.declaring ? ' ⚠' : ''}`;
    if (text !== this.windText) {
      this.windText = text;
      this.windLine.textContent = text;
      this.windLine.style.color = wind.declaring ? '#ff9d5c' : '#ffd28a';
    }
  }

  /** 切換考試模式：考試模式下引導強制關閉並停用開關。 */
  setExamMode(examMode: boolean): void {
    this.examMode = examMode;
    if (examMode) this.guidanceEnabled = false;
    this.render();
  }

  setDrone(x: number, z: number, headingDeg: number): void {
    this.drone = { x, z, headingDeg };
    this.render();
  }

  setTrajectory(points: Array<{ x: number; z: number }>): void {
    this.trajectory = points;
    this.render();
  }

  /** 顯示目前輸入來源與生效標定（一行摘要＋點擊展開完整內容）。 */
  setInputInfo(info: ExamInputInfo): void {
    this.inputInfo = info;
    this.renderInputInfo();
  }

  private inputInfo: ExamInputInfo | null = null;

  private renderInputInfo(): void {
    const info = this.inputInfo;
    if (!info) return;
    const sourceText = info.sourceKind === 'adapter' ? `搖桿（${info.sourceLabel}）` : '鍵盤（備援）';
    const prefText = info.preference === 'keyboard' ? ' · 已手動切換為鍵盤' : '';
    const profileShort = info.hasProfile ? info.profileLabel : info.connectedWithoutProfile ? '無（待標定）' : '—';
    this.inputSummary.textContent = `輸入來源：${sourceText}${prefText}｜生效標定：${profileShort}`;
    if (this.inputExpanded) {
      const origin = info.profileOrigin && info.profileOrigin !== 'local' ? `[${info.profileOrigin}] ` : '';
      const file = info.profileFile ? ` ${info.profileFile}` : '';
      let detail = info.hasProfile
        ? `生效標定：${origin}${info.profileLabel}${file}\n映射 ${info.mapping}`
        : info.connectedWithoutProfile
          ? '搖桿已連接但無生效標定 → 使用鍵盤（請先用標定精靈或等待自動匯入）'
          : '生效標定：—（未連接搖桿）';
      if (info.conflict) detail += `\n⚠ 與伺服器最新擷取檔映射不同（${info.conflictMapping}）`;
      this.inputDetails.textContent = detail;
      this.inputDetails.style.display = 'block';
      this.inputDetails.style.whiteSpace = 'pre-wrap';
    } else {
      this.inputDetails.style.display = 'none';
    }
  }

  getGuidanceEnabled(): boolean {
    return this.guidanceEnabled && !this.examMode;
  }

  private toggleGuidance(): void {
    if (isGuidanceForcedOff(this.examMode)) return;
    this.guidanceEnabled = !this.guidanceEnabled;
    this.render();
  }

  private render(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const w = this.widthPx;
    const h = this.heightPx;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0b1d2a';
    ctx.fillRect(0, 0, w, h);

    const proj = (x: number, z: number): { px: number; py: number } => minimapProject(this.field, x, z, w, h);

    // 操作區邊界
    const op = this.field.operationArea;
    const tl = proj(-op.halfWidthM, -op.halfLengthM);
    const br = proj(op.halfWidthM, op.halfLengthM);
    ctx.strokeStyle = '#3a6a8a';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.px, tl.py, br.px - tl.px, br.py - tl.py);

    // 八字雙圓
    ctx.strokeStyle = '#5aa0c8';
    for (const c of this.field.figure8.circles) {
      const center = proj(c.center.x, c.center.z);
      const edge = proj(c.center.x + c.radiusM, c.center.z);
      ctx.beginPath();
      ctx.arc(center.px, center.py, Math.abs(edge.px - center.px), 0, Math.PI * 2);
      ctx.stroke();
    }

    // 角錐
    ctx.fillStyle = '#e08a2a';
    for (const cone of Object.values(this.field.figure8.cones)) {
      const p = proj(cone.x, cone.z);
      ctx.beginPath();
      ctx.arc(p.px, p.py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // H 起降點
    const hp = proj(this.field.landingPointH.position.x, this.field.landingPointH.position.z);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hp.px, hp.py, 4, 0, Math.PI * 2);
    ctx.stroke();

    // 航跡
    if (this.trajectory.length > 1) {
      ctx.strokeStyle = 'rgba(120,220,160,0.8)';
      ctx.beginPath();
      this.trajectory.forEach((pt, i) => {
        const p = proj(pt.x, pt.z);
        if (i === 0) ctx.moveTo(p.px, p.py);
        else ctx.lineTo(p.px, p.py);
      });
      ctx.stroke();
    }

    // 機體
    if (this.drone) {
      const p = proj(this.drone.x, this.drone.z);
      ctx.fillStyle = '#ff5555';
      ctx.beginPath();
      ctx.arc(p.px, p.py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // 機頭方向（−Z 為前，依 heading 旋轉）
      const rad = (-this.drone.headingDeg * Math.PI) / 180;
      ctx.strokeStyle = '#ffaaaa';
      ctx.beginPath();
      ctx.moveTo(p.px, p.py);
      ctx.lineTo(p.px + Math.sin(rad) * 8, p.py - Math.cos(rad) * 8);
      ctx.stroke();
    }

    // 文字（模式／視角中文化，不留英文原值）
    this.modeLabel.textContent = `${L.exam.panel.mode}：${L.exam.modeLabels[this.mode]}`;
    const orbit = this.cameraAdjust.orbitYawDeg === 0 && this.cameraAdjust.orbitPitchDeg === 0
      ? ''
      : `（${L.exam.camera.orbit} ${Math.round(this.cameraAdjust.orbitYawDeg)}°／${Math.round(this.cameraAdjust.orbitPitchDeg)}°）`;
    this.cameraLabel.textContent = `${L.exam.panel.cameraView}：${L.exam.camera[this.cameraView]}（${this.cameraAdjust.fovDeg}°）${orbit}`;
    const forced = isGuidanceForcedOff(this.examMode);
    this.guidanceTag.textContent = forced ? L.exam.panel.guidanceOffTag : `${L.exam.panel.guidance}：${this.guidanceEnabled ? '開' : '關'}`;
    this.guidanceTag.style.cursor = forced ? 'default' : 'pointer';
    this.guidanceTag.onclick = forced ? null : () => this.toggleGuidance();
    this.statusTag.textContent = forced ? L.exam.panel.exam : L.exam.panel.practice;
  }

  dispose(): void {
    this.root.remove();
  }
}
