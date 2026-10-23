/**
 * 科目 A／G 判定單元測試（飛行前／後 360 度檢查，p161／p167；檢查表＝附件3 p212）。
 *
 * 以地面檢查記錄（GroundCheckLog）直接測 judgeSubjectA / judgeSubjectG 的純函式
 * 行為；「真的走完流程」的瀏覽器端到端驗證見 tests/browser/exam-ground-check.spec.ts。
 */

import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_ITEMS,
  CONTROLLER_CHECK_ITEMS,
  STATIONS_CCW,
  SYSTEM_KNOWLEDGE_ITEMS,
} from '../../src/exam/checklist';
import {
  createGroundCheckLog,
  isWalkaroundCCW,
  judgeSubjectA,
  judgeSubjectG,
  type GroundCheckLog,
} from '../../src/exam/subject-ag';

/** 完整勾選附件3（飛行前＋飛行後皆「是」）。 */
function fullChecklist(log: GroundCheckLog): void {
  for (const it of CHECKLIST_ITEMS) {
    log.checklist[it.id] = { pre: true, post: true };
  }
}

/** 完整自評（知識＋遙控器）。 */
function fullSelfAssess(log: GroundCheckLog): void {
  for (const k of SYSTEM_KNOWLEDGE_ITEMS) log.knowledge[k.id] = true;
  for (const k of CONTROLLER_CHECK_ITEMS) log.controller[k.id] = true;
}

function ccwWalk(log: GroundCheckLog): void {
  for (const st of STATIONS_CCW) log.stations.push(st);
}

describe('科目 A／G — 逆時針繞行順序', () => {
  it('官方順序（機頭→左側→機尾→右側）視為逆時針', () => {
    expect(isWalkaroundCCW(['nose', 'left', 'tail', 'right'])).toBe(true);
  });

  it('順時針（機頭→右側→機尾→左側）不合格', () => {
    expect(isWalkaroundCCW(['nose', 'right', 'tail', 'left'])).toBe(false);
  });

  it('只走兩站不算完成 360 度', () => {
    expect(isWalkaroundCCW(['nose', 'left'])).toBe(false);
  });

  it('走完後重訪不影響（真實繞行會回到機頭）', () => {
    expect(isWalkaroundCCW(['nose', 'left', 'tail', 'right', 'nose'])).toBe(true);
  });
});

describe('科目 A — 理想飛行前檢查 → S', () => {
  it('知識 9/9＋遙控器 6/6＋逆時針繞行＋附件3 飛行前 10/10 → S', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    fullChecklist(log);
    fullSelfAssess(log);
    const r = judgeSubjectA(log);
    expect(r.rating).toBe('S');
    expect(r.failReasonKeys).toEqual([]);
    expect(r.raw.checklistPreOk).toBe(10);
    expect(r.raw.knowledgeOk).toBe(9);
    expect(r.raw.controllerOk).toBe(6);
    expect(r.raw.walkaroundCCW).toBe(true);
  });
});

describe('科目 A — 未執行 → N', () => {
  it('沒有任何地面檢查記錄 → N（notExecuted）', () => {
    const r = judgeSubjectA(createGroundCheckLog());
    expect(r.rating).toBe('N');
    expect(r.executed).toBe(false);
    expect(r.failReasonKeys).toContain('subjectA.notExecuted');
  });
});

describe('科目 A — 不良 → U', () => {
  it('順時針繞行 → walkaroundFail', () => {
    const log = createGroundCheckLog();
    log.stations.push('nose', 'right', 'tail', 'left');
    fullChecklist(log);
    fullSelfAssess(log);
    const r = judgeSubjectA(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectA.walkaroundFail');
  });

  it('附件3 有一項漏勾 → checklistFail', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    fullChecklist(log);
    delete log.checklist.gnss;
    fullSelfAssess(log);
    const r = judgeSubjectA(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectA.checklistFail');
    expect(r.raw.checklistPreOk).toBe(9);
  });

  it('附件3 有一項勾「否」（發現缺陷）→ checklistFail', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    fullChecklist(log);
    log.checklist.propeller = { pre: false };
    fullSelfAssess(log);
    const r = judgeSubjectA(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectA.checklistFail');
  });

  it('系統知識有一項不熟悉 → knowledgeFail', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    fullChecklist(log);
    fullSelfAssess(log);
    log.knowledge.cg = false;
    const r = judgeSubjectA(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectA.knowledgeFail');
  });

  it('搖桿功能有一項異常 → controllerFail', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    fullChecklist(log);
    fullSelfAssess(log);
    log.controller.yawStick = false;
    const r = judgeSubjectA(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectA.controllerFail');
  });
});

describe('科目 G — 飛行後檢查', () => {
  it('理想：逆時針繞行＋附件3 飛行後 10/10 → S', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    fullChecklist(log);
    const r = judgeSubjectG(log);
    expect(r.rating).toBe('S');
    expect(r.raw.checklistPostOk).toBe(10);
  });

  it('未執行 → N', () => {
    const r = judgeSubjectG(createGroundCheckLog());
    expect(r.rating).toBe('N');
    expect(r.failReasonKeys).toContain('subjectG.notExecuted');
  });

  it('只勾了飛行前欄（未做飛行後檢查）→ checklistFail', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    for (const it of CHECKLIST_ITEMS) log.checklist[it.id] = { pre: true };
    const r = judgeSubjectG(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectG.checklistFail');
    expect(r.raw.checklistPostOk).toBe(0);
  });

  it('順時針繞行 → walkaroundFail', () => {
    const log = createGroundCheckLog();
    log.stations.push('nose', 'right', 'tail', 'left');
    fullChecklist(log);
    const r = judgeSubjectG(log);
    expect(r.rating).toBe('U');
    expect(r.failReasonKeys).toContain('subjectG.walkaroundFail');
  });

  it('A 與 G 共用同一份記錄但各看自己的欄位', () => {
    const log = createGroundCheckLog();
    ccwWalk(log);
    // 只做飛行前（A）完整；飛行後（G）未勾。
    for (const it of CHECKLIST_ITEMS) log.checklist[it.id] = { pre: true };
    fullSelfAssess(log);
    expect(judgeSubjectA(log).rating).toBe('S');
    expect(judgeSubjectG(log).rating).toBe('U');
  });
});

describe('附件3 檢查表內容（官方範例 p212）', () => {
  it('共 10 項：動力系統 3 項＋載具 7 項', () => {
    expect(CHECKLIST_ITEMS.length).toBe(10);
    expect(CHECKLIST_ITEMS.filter((i) => i.group === 'power').length).toBe(3);
    expect(CHECKLIST_ITEMS.filter((i) => i.group === 'airframe').length).toBe(7);
  });

  it('系統知識 9 項、遙控器檢查 6 項', () => {
    expect(SYSTEM_KNOWLEDGE_ITEMS.length).toBe(9);
    expect(CONTROLLER_CHECK_ITEMS.length).toBe(6);
  });
});
