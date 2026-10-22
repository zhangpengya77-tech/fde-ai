/**
 * 考試即時面板（CAA 專業基本級術科模擬，HUD）。
 *
 * 提供：
 *  - 小地圖（Canvas）：操作區、八字雙圓、角錐、H 起降點、機體與航跡。
 *  - 當前飛行模式（手動 / 姿態 / 定位）。
 *  - 引導開關；考試模式（exam）下強制關閉引導（不得有輔助），開關停用。
 *
 * 純函式輔助（minimapProject / isGuidanceForcedOff）不依賴 DOM，可單元測試；
 * ExamHud 類別負責 DOM/Canvas 渲染，僅在瀏覽器執行期使用。
 */

import type { ExamField } from './field';
import type { ExamInputInfo } from './exam-input';
import { zhHant as L } from '../i18n/zh-Hant';

export type ExamHudMode = 'manual' | 'attitude' | 'position';

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
 * 考試 HUD（即時面板）。掛載於給定父元素，提供小地圖、模式顯示與引導開關。
 */
export class ExamHud {
  private readonly field: ExamField;
  private readonly widthPx: number;
  private readonly heightPx: number;
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly modeLabel: HTMLElement;
  private readonly guidanceButton: HTMLButtonElement;
  private readonly statusLabel: HTMLElement;
  private readonly inputLine: HTMLElement;
  private readonly profileLine: HTMLElement;
  private readonly disclaimerLine: HTMLElement;

  private mode: ExamHudMode = 'position';
  private examMode = false;
  private guidanceEnabled = false;
  private drone: { x: number; z: number; headingDeg: number } | null = null;
  private trajectory: Array<{ x: number; z: number }> = [];

  constructor(field: ExamField, parent: HTMLElement, options: ExamHudOptions = {}) {
    this.field = field;
    this.widthPx = options.widthPx ?? 260;
    this.heightPx = options.heightPx ?? 200;

    this.root = document.createElement('div');
    this.root.className = 'exam-hud';
    this.root.style.cssText = 'position:relative;background:rgba(0,0,0,0.55);color:#fff;border-radius:8px;padding:8px;font:12px/1.4 sans-serif;';

    const title = document.createElement('div');
    title.textContent = '考試即時面板';
    title.style.cssText = 'font-weight:bold;margin-bottom:4px;';
    this.root.appendChild(title);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.widthPx;
    this.canvas.height = this.heightPx;
    this.canvas.style.cssText = 'display:block;background:#0b1d2a;border:1px solid #2a4a63;border-radius:4px;';
    this.root.appendChild(this.canvas);

    const info = document.createElement('div');
    info.style.cssText = 'display:flex;justify-content:space-between;margin-top:4px;gap:8px;';
    this.modeLabel = document.createElement('span');
    this.statusLabel = document.createElement('span');
    info.appendChild(this.modeLabel);
    info.appendChild(this.statusLabel);
    this.root.appendChild(info);

    // 輸入來源與生效標定（沿用 HUD 資訊：來源／profile 檔名／四軸映射）。
    this.inputLine = document.createElement('div');
    this.inputLine.style.cssText = 'margin-top:4px;color:#ffd;';
    this.root.appendChild(this.inputLine);
    this.profileLine = document.createElement('div');
    this.profileLine.style.cssText = 'margin-top:2px;font-size:11px;color:#bcd;max-width:260px;word-break:break-all;';
    this.root.appendChild(this.profileLine);

    this.guidanceButton = document.createElement('button');
    this.guidanceButton.style.cssText = 'margin-top:4px;width:100%;padding:4px;';
    this.guidanceButton.addEventListener('click', () => this.toggleGuidance());
    this.root.appendChild(this.guidanceButton);

    // 固定免責聲明：面板常駐顯示（航跡回放時報告面板會被隱藏，只靠頂部橫幅不夠）。
    this.disclaimerLine = document.createElement('div');
    this.disclaimerLine.textContent = L.exam.disclaimer;
    this.disclaimerLine.style.cssText = 'margin-top:4px;font-size:11px;color:#ffd76b;max-width:260px;';
    this.root.appendChild(this.disclaimerLine);

    parent.appendChild(this.root);
    this.render();
  }

  setMode(mode: ExamHudMode): void {
    this.mode = mode;
    this.render();
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

  /** 顯示目前輸入來源與生效標定（搖桿／鍵盤、profile 檔名與四軸映射）。 */
  setInputInfo(info: ExamInputInfo): void {
    const sourceText = info.sourceKind === 'adapter' ? `搖桿（${info.sourceLabel}）` : '鍵盤（備援）';
    const prefText = info.preference === 'keyboard' ? ' · 已手動切換為鍵盤' : '';
    this.inputLine.textContent = `輸入來源：${sourceText}${prefText}`;
    if (info.hasProfile) {
      const origin = info.profileOrigin && info.profileOrigin !== 'local' ? `[${info.profileOrigin}] ` : '';
      const file = info.profileFile ? ` ${info.profileFile}` : '';
      this.profileLine.textContent = `生效標定：${origin}${info.profileLabel}${file}\n映射 ${info.mapping}`;
      this.profileLine.style.color = info.conflict ? '#ffb86b' : '#bcd';
      if (info.conflict) this.profileLine.textContent += `\n⚠ 與伺服器最新擷取檔映射不同（${info.conflictMapping}）`;
    } else if (info.connectedWithoutProfile) {
      this.profileLine.style.color = '#ffb86b';
      this.profileLine.textContent = '搖桿已連接但無生效標定 → 使用鍵盤（請先用標定精靈或等待自動匯入）';
    } else {
      this.profileLine.style.color = '#bcd';
      this.profileLine.textContent = '生效標定：—（未連接搖桿）';
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

    // 文字
    this.modeLabel.textContent = `模式：${this.mode}`;
    const forced = isGuidanceForcedOff(this.examMode);
    this.guidanceButton.textContent = forced
      ? '引導：考試模式已停用'
      : this.guidanceEnabled
        ? '引導：開'
        : '引導：關';
    this.guidanceButton.disabled = forced;
    this.statusLabel.textContent = forced ? '考試中' : '練習';
  }

  dispose(): void {
    this.root.remove();
  }
}
