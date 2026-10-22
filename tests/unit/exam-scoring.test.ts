import { describe, expect, it } from 'vitest';
import { loadExamConfig } from '../../src/exam/config';
import { buildExamReport } from '../../src/exam/scoring';
import type { SubjectBResult, SubjectCResult, JudgmentCheck } from '../../src/exam/subjects';
import type { SubjectDResult } from '../../src/exam/subject-d';
import type { SubjectFResult } from '../../src/exam/subject-f';
import type { MajorFailureReport } from '../../src/exam/major-failures';

const config = loadExamConfig();

function emptyChecks(): JudgmentCheck[] {
  return [];
}

function makeB(rating: 'S' | 'U' | 'N', executed = true): SubjectBResult {
  return {
    rating,
    executed,
    checks: emptyChecks(),
    failReasonKeys: [],
    raw: { takeoffHeightM: 1.5, plateaus: [], rotationDeltasDeg: [], landingDeviationM: 0.1 },
  };
}

function makeC(rating: 'S' | 'U' | 'N', executed = true): SubjectCResult {
  return {
    rating,
    executed,
    checks: emptyChecks(),
    failReasonKeys: [],
    raw: {
      initialHoverSeconds: 5,
      maxPathDeviationM: 0,
      offPathExcursionCount: 0,
      altitudeMinM: 1.2,
      altitudeMaxM: 1.8,
      longestPauseS: 0,
      leftWinding: 100,
      rightWinding: -100,
      leftBeforeRight: true,
    },
  };
}

function makeD(rating: 'S' | 'U' | 'N', executed = true): SubjectDResult {
  return {
    rating,
    executed,
    checks: emptyChecks(),
    failReasonKeys: [],
    raw: {
      waypoints: [],
      retreatSpacingM: 12,
      configRetreatDistanceM: 12,
      level: 'I',
      altitudeMinM: 1.5,
      altitudeMaxM: 1.5,
      retreatTravelM: 12,
    },
  };
}

function makeF(rating: 'S' | 'U' | 'N', executed = true): SubjectFResult {
  return {
    rating,
    executed,
    checks: emptyChecks(),
    failReasonKeys: [],
    raw: {
      triggerT: 12,
      triggerX: 8,
      triggerZ: -8,
      holdStartT: 12.5,
      holdSeconds: 4,
      holdDriftM: 0.1,
      circleSide: 'right',
      circleCenterX: 6,
      circleCenterZ: -16,
      maxDescentRateMps: -1.0,
      arrivalAltitudeM: 1.5,
      landingDistanceM: 0.2,
      coneHitIds: [],
    },
  };
}

function mf(hasAny: boolean): MajorFailureReport {
  return {
    rule: config.majorFailures.rule,
    page: 160,
    items: [
      { code: 'outOfOperationArea', labelKey: 'x', auto: true, detected: false, detail: '—', page: 160 },
      { code: 'hitCone', labelKey: 'x', auto: true, detected: false, detail: '—', page: 160 },
      { code: 'crash', labelKey: 'x', auto: true, detected: false, detail: '—', page: 160 },
      { code: 'beyondExamineeRear', labelKey: 'x', auto: true, detected: false, detail: '—', page: 160 },
      { code: 'examinerIntervene', labelKey: 'x', auto: false, detected: false, detail: '—', page: 160 },
      { code: 'disorder', labelKey: 'x', auto: false, detected: false, detail: '—', page: 160 },
      { code: 'identityFraud', labelKey: 'x', auto: false, detected: false, detail: '—', page: 160 },
    ],
    hasAny,
  };
}

describe('成績單 — 完美（B=S, C=S, D=S, F=S, 無違失）', () => {
  it('simulatedPass=true；B/C/D/F 列為 S；其餘三項 rating=null', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('S'), subjectF: makeF('S'), majorFailure: mf(false) });
    expect(r.simulatedPass).toBe(true);
    expect(r.items[1].rating).toBe('S');
    expect(r.items[1].simulated).toBe(true);
    expect(r.items[2].rating).toBe('S');
    expect(r.items[2].simulated).toBe(true);
    expect(r.items[3].rating).toBe('S');
    expect(r.items[3].simulated).toBe(true);
    expect(r.items[5].rating).toBe('S');
    expect(r.items[5].simulated).toBe(true);
    [0, 4, 6].forEach((i) => {
      expect(r.items[i].rating).toBeNull();
      expect(r.items[i].simulated).toBe(false);
    });
    expect(r.majorFailure.hasAny).toBe(false);
  });
});

describe('成績單 — B=U → 不通過', () => {
  it('simulatedPass=false 且原因含 科目B=U', () => {
    const r = buildExamReport({ config, subjectB: makeB('U'), subjectC: makeC('S'), subjectD: makeD('S'), subjectF: makeF('S'), majorFailure: mf(false) });
    expect(r.simulatedPass).toBe(false);
    expect(r.items[1].rating).toBe('U');
    expect(r.simulatedPassDetail).toContain('科目B=U');
  });
});

describe('成績單 — C 未測（null）→ 不通過', () => {
  it('items[2].rating=null 且 simulatedPass=false', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: null, subjectD: makeD('S'), subjectF: makeF('S'), majorFailure: mf(false) });
    expect(r.items[2].rating).toBeNull();
    expect(r.simulatedPass).toBe(false);
  });
});

describe('成績單 — D 未測／U → 不通過（新增科目 D）', () => {
  it('subjectD=null → items[3].rating=null 且 simulatedPass=false', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectF: makeF('S'), majorFailure: mf(false) });
    expect(r.items[3].rating).toBeNull();
    expect(r.items[3].simulated).toBe(false);
    expect(r.simulatedPass).toBe(false);
    expect(r.simulatedPassDetail).toContain('科目D=未測');
  });
  it('subjectD=U → simulatedPass=false 且原因含 科目D=U', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('U'), subjectF: makeF('S'), majorFailure: mf(false) });
    expect(r.items[3].rating).toBe('U');
    expect(r.simulatedPass).toBe(false);
    expect(r.simulatedPassDetail).toContain('科目D=U');
  });
  it('B/C 皆 S 但 D 未執行（N）→ 不通過', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('N', false), subjectF: makeF('S'), majorFailure: mf(false) });
    expect(r.items[3].rating).toBe('N');
    expect(r.simulatedPass).toBe(false);
  });
});

describe('成績單 — F 未觸發／U → 不通過（新增科目 F）', () => {
  it('subjectF=null（監評人員未下達緊急返航）→ items[5].rating=null 且 simulatedPass=false', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('S'), majorFailure: mf(false) });
    expect(r.items[5].rating).toBeNull();
    expect(r.items[5].simulated).toBe(false);
    expect(r.simulatedPass).toBe(false);
    expect(r.simulatedPassDetail).toContain('科目F=未觸發');
  });
  it('subjectF=U → simulatedPass=false 且原因含 科目F=U', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('S'), subjectF: makeF('U'), majorFailure: mf(false) });
    expect(r.items[5].rating).toBe('U');
    expect(r.simulatedPass).toBe(false);
    expect(r.simulatedPassDetail).toContain('科目F=U');
  });
  it('B/C/D 皆 S 但 F 未執行（N）→ 不通過', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('S'), subjectF: makeF('N', false), majorFailure: mf(false) });
    expect(r.items[5].rating).toBe('N');
    expect(r.simulatedPass).toBe(false);
  });
});

describe('成績單 — 重大違失 → 不通過', () => {
  it('majorFailure.hasAny=true → simulatedPass=false 且原因含 重大違失', () => {
    const r = buildExamReport({ config, subjectB: makeB('S'), subjectC: makeC('S'), subjectD: makeD('S'), subjectF: makeF('S'), majorFailure: mf(true) });
    expect(r.majorFailure.hasAny).toBe(true);
    expect(r.simulatedPass).toBe(false);
    expect(r.simulatedPassDetail).toContain('重大違失');
  });
});

describe('成績單 — 未執行（N）', () => {
  it('B 未起飛（executed=false, rating=N）→ items[1].rating=N', () => {
    const r = buildExamReport({ config, subjectB: makeB('N', false), subjectC: makeC('S'), subjectD: makeD('S'), majorFailure: mf(false) });
    expect(r.items[1].rating).toBe('N');
    expect(r.simulatedPass).toBe(false);
  });
});
