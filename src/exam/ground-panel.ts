/**
 * 地面檢查面板（科目 A 飛行前／科目 G 飛行後 360 度檢查，p161／p167）。
 *
 * 依官方準則呈現：
 *   1. 繞行航站圖（機頭朝 −Z 為 12 點鐘；逆時針＝機頭→左側→機尾→右側），
 *      點擊航站記錄到訪順序；
 *   2. 附件3 檢查表（p212 範例）逐項勾選（是／否）——科目 A 用飛行前欄、
 *      科目 G 用飛行後欄；
 *   3. 科目 A 另含系統知識 9 項與手持操控器搖桿／開關功能檢查（自評）。
 *
 * 所有操作直接寫入 ExamSession 的地面檢查記錄（供 finalize 判定）。
 * 本面板只在 currentSubject 為 A／G 時顯示。
 */

import { zhHant as L } from '../i18n/zh-Hant';
import {
  CHECKLIST_GROUPS,
  CHECKLIST_ITEMS,
  CONTROLLER_CHECK_ITEMS,
  STATIONS,
  STATIONS_CCW,
  SYSTEM_KNOWLEDGE_ITEMS,
  type StationId,
} from './checklist';
import type { ExamSession } from './session';

type Phase = 'pre' | 'post';

const STATION_GRID: Record<StationId, { row: number; col: number }> = {
  nose: { row: 1, col: 2 },
  left: { row: 2, col: 1 },
  tail: { row: 3, col: 2 },
  right: { row: 2, col: 3 },
};

export class GroundCheckPanel {
  private readonly host: HTMLElement;
  private readonly session: ExamSession;
  private subject: 'A' | 'G' | null = null;

  constructor(host: HTMLElement, session: ExamSession) {
    this.host = host;
    this.session = session;
    this.host.addEventListener('click', (e) => this.onClick(e));
  }

  /** 切換顯示內容（currentSubject 為 A／G 時顯示，否則隱藏）。 */
  setSubject(subject: 'A' | 'G' | null): void {
    this.subject = subject;
    if (subject === null) {
      this.host.style.display = 'none';
      this.host.innerHTML = '';
      return;
    }
    this.host.style.display = 'block';
    this.render();
  }

  private get phase(): Phase {
    return this.subject === 'G' ? 'post' : 'pre';
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const stationBtn = target.closest('button[data-station]') as HTMLButtonElement | null;
    if (stationBtn?.dataset.station) {
      this.session.recordStation(stationBtn.dataset.station as StationId);
      this.render();
      return;
    }
    const checkBtn = target.closest('button[data-check]') as HTMLButtonElement | null;
    if (checkBtn?.dataset.check && checkBtn.dataset.value) {
      this.session.recordChecklist(checkBtn.dataset.check, this.phase, checkBtn.dataset.value === 'yes');
      this.render();
      return;
    }
    const flagBtn = target.closest('button[data-flag]') as HTMLButtonElement | null;
    if (flagBtn?.dataset.flag && flagBtn.dataset.value) {
      const [kind, id] = flagBtn.dataset.flag.split(':');
      const ok = flagBtn.dataset.value === 'yes';
      if (kind === 'knowledge') this.session.recordKnowledge(id, ok);
      else this.session.recordControllerCheck(id, ok);
      this.render();
    }
  }

  private stationButton(id: StationId): string {
    const def = STATIONS[id];
    const visits = this.session.getGroundCheckLog().stations;
    const count = visits.filter((s) => s === id).length;
    const isNext = this.nextExpectedStation() === id;
    const border = isNext ? 'border:2px solid #ffd28a;' : 'border:1px solid #4a7;';
    const bg = count > 0 ? 'background:rgba(45,180,110,0.35);' : 'background:rgba(20,40,55,0.9);';
    return `<button data-station="${id}" style="grid-row:${STATION_GRID[id].row};grid-column:${STATION_GRID[id].col};${border}${bg}color:#cfe;padding:8px 6px;border-radius:8px;cursor:pointer;font:12px sans-serif;">
      <div>${def.label}</div>
      <div style="opacity:.7;font-size:11px">${count > 0 ? `第 ${visits.indexOf(id) + 1} 站` : isNext ? L.exam.groundCheck.stationNext : '—'}</div>
    </button>`;
  }

  /** 下一個應到訪航站（依官方逆時針順序與已到訪序列）。 */
  private nextExpectedStation(): StationId | null {
    const visits = this.session.getGroundCheckLog().stations;
    const firstSeen: StationId[] = [];
    for (const st of visits) if (!firstSeen.includes(st)) firstSeen.push(st);
    for (const expected of STATIONS_CCW) {
      if (!firstSeen.includes(expected)) return expected;
    }
    return null;
  }

  private checklistRow(id: string, label: string): string {
    const entry = this.session.getGroundCheckLog().checklist[id];
    const value = this.phase === 'pre' ? entry?.pre : entry?.post;
    const yesStyle = value === true ? 'background:#2d6;color:#04240f;font-weight:bold;' : 'background:rgba(20,40,55,0.9);color:#cfe;';
    const noStyle = value === false ? 'background:#c33;color:#fff;font-weight:bold;' : 'background:rgba(20,40,55,0.9);color:#cfe;';
    return `<tr>
      <td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,0.08);">${label}</td>
      <td style="text-align:center;padding:3px;"><button data-check="${id}" data-value="yes" style="${yesStyle}border:1px solid #4a7;border-radius:5px;padding:2px 12px;cursor:pointer;font:12px sans-serif;">${L.exam.groundCheck.yes}</button></td>
      <td style="text-align:center;padding:3px;"><button data-check="${id}" data-value="no" style="${noStyle}border:1px solid #a44;border-radius:5px;padding:2px 12px;cursor:pointer;font:12px sans-serif;">${L.exam.groundCheck.no}</button></td>
    </tr>`;
  }

  private flagRow(scope: 'knowledge' | 'controller', id: string, label: string): string {
    const log = this.session.getGroundCheckLog();
    const value = scope === 'knowledge' ? log.knowledge[id] : log.controller[id];
    const yesStyle = value === true ? 'background:#2d6;color:#04240f;font-weight:bold;' : 'background:rgba(20,40,55,0.9);color:#cfe;';
    const noStyle = value === false ? 'background:#c33;color:#fff;font-weight:bold;' : 'background:rgba(20,40,55,0.9);color:#cfe;';
    return `<tr>
      <td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,0.08);">${label}</td>
      <td style="text-align:center;padding:3px;"><button data-flag="${scope}:${id}" data-value="yes" style="${yesStyle}border:1px solid #4a7;border-radius:5px;padding:2px 12px;cursor:pointer;font:12px sans-serif;">${L.exam.groundCheck.yes}</button></td>
      <td style="text-align:center;padding:3px;"><button data-flag="${scope}:${id}" data-value="no" style="${noStyle}border:1px solid #a44;border-radius:5px;padding:2px 12px;cursor:pointer;font:12px sans-serif;">${L.exam.groundCheck.no}</button></td>
    </tr>`;
  }

  private render(): void {
    if (this.subject === null) return;
    const g = L.exam.groundCheck;
    const phaseLabel = this.phase === 'pre' ? g.checklistPre : g.checklistPost;
    const log = this.session.getGroundCheckLog();

    const stationGrid = `<div style="display:grid;grid-template-columns:repeat(3,72px);grid-template-rows:repeat(3,44px);gap:4px;justify-content:center;">
      <div style="grid-row:2;grid-column:2;display:flex;align-items:center;justify-content:center;color:#8fc;font-size:22px;">✛</div>
      ${STATIONS_CCW.map((id) => this.stationButton(id)).join('')}
    </div>`;

    const checklistTables = CHECKLIST_GROUPS.map(
      (grp) => `<div style="margin:4px 0;">
        <div style="opacity:.75;margin:2px 0;">${grp.label}</div>
        <table style="width:100%;border-collapse:collapse;font:12px sans-serif;">
          ${CHECKLIST_ITEMS.filter((it) => it.group === grp.id).map((it) => this.checklistRow(it.id, it.label)).join('')}
        </table>
      </div>`,
    ).join('');

    const knowledgeBlock =
      this.subject === 'A'
        ? `<div style="margin:8px 0 2px;opacity:.75;">${g.knowledge}</div>
           <table style="width:100%;border-collapse:collapse;font:12px sans-serif;">
             ${SYSTEM_KNOWLEDGE_ITEMS.map((k) => this.flagRow('knowledge', k.id, k.label)).join('')}
           </table>`
        : '';

    const controllerBlock =
      this.subject === 'A'
        ? `<div style="margin:8px 0 2px;opacity:.75;">${g.controller}</div>
           <table style="width:100%;border-collapse:collapse;font:12px sans-serif;">
             ${CONTROLLER_CHECK_ITEMS.map((k) => this.flagRow('controller', k.id, k.label)).join('')}
           </table>`
        : '';

    // 進度：檢查表＋（A：知識與遙控器）。
    const checklistDone = CHECKLIST_ITEMS.filter((it) => (this.phase === 'pre' ? log.checklist[it.id]?.pre : log.checklist[it.id]?.post) !== undefined).length;
    const extraTotal = this.subject === 'A' ? SYSTEM_KNOWLEDGE_ITEMS.length + CONTROLLER_CHECK_ITEMS.length : 0;
    const extraDone =
      this.subject === 'A'
        ? SYSTEM_KNOWLEDGE_ITEMS.filter((k) => log.knowledge[k.id] !== undefined).length +
          CONTROLLER_CHECK_ITEMS.filter((k) => log.controller[k.id] !== undefined).length
        : 0;
    const total = CHECKLIST_ITEMS.length + extraTotal;
    const done = checklistDone + extraDone;
    const stationsDone = new Set(log.stations).size;

    this.host.innerHTML = `
      <div style="background:rgba(8,18,28,0.94);color:#fff;border:1px solid #2d6;border-radius:10px;padding:12px 14px;max-width:340px;font:13px/1.5 sans-serif;max-height:calc(100% - 90px);overflow:auto;">
        <div style="font-weight:bold;margin-bottom:2px;">${g.title}${this.subject === 'A' ? '（科目 A）' : '（科目 G）'}</div>
        <div style="opacity:.65;font-size:11px;margin-bottom:8px;">${g.hint}</div>
        <div style="opacity:.75;margin-bottom:4px;">${g.stations}</div>
        ${stationGrid}
        <div style="opacity:.6;font-size:11px;margin:6px 0 8px;">${g.legend}</div>
        <div style="opacity:.75;margin:6px 0 2px;">${L.exam.groundCheck.title}・${phaseLabel}</div>
        ${checklistTables}
        ${knowledgeBlock}
        ${controllerBlock}
        <div style="margin-top:10px;opacity:.85;font-size:12px;">${g.progress}：勾選 ${done}/${total}｜繞行 ${stationsDone}/4 站${
          done === total && stationsDone >= 4 ? `｜<span style="color:#7f7;">${g.done}</span>` : ''
        }</div>
      </div>`;
  }

  dispose(): void {
    this.host.innerHTML = '';
  }
}
