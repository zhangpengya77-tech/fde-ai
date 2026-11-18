// 組裝實訓室｜接線引擎（純邏輯）：目前第幾步、已接的線、錯誤紀錄、撤銷、存檔。
// 每一步都呼叫 wiring-rules.js 校驗；接錯不會接上，錯誤寫進紀錄（考試模式完整保留）。
import { evaluateStep, buildCatalog, validateSystem, CODES } from './wiring-rules.js';

/**
 * 進入接線前的條件：除了槳葉以外的零件都要裝好；槳葉必須全部拆下（接線、測試前一定拆槳）。
 * @returns {{ ok: boolean, missing: string[], propsOn: string[] }}
 */
export function wiringPreconditions(assembly) {
  const parts = assembly.model.parts;
  const missing = parts.filter((p) => p.shape.type !== 'prop' && !assembly.isInstalled(p.partId)).map((p) => p.partId);
  const propsOn = parts.filter((p) => p.shape.type === 'prop' && assembly.isInstalled(p.partId)).map((p) => p.partId);
  return { ok: !missing.length && !propsOn.length, missing, propsOn };
}

export function createWiringEngine(wiring, board, extraPoints, fits, options = {}) {
  const catalog = buildCatalog(board, extraPoints);
  const steps = wiring.steps;
  const now = options.now || (() => Date.now());
  const startedAt = now();
  let done = [];          // [{ stepId, choice }] 依完成順序
  let errors = [];        // [{ at, stepId, code, severity }]
  const listeners = new Set();
  const emit = (e) => { for (const fn of listeners) fn(e); };

  const current = () => steps[done.length] || null;
  /** 目前已被佔用的接點（給「接口重複使用」檢查） */
  function occupied() {
    const set = new Set();
    for (const d of done) {
      const step = steps.find((s) => s.id === d.stepId);
      if (step.kind === 'polarity') { set.add(step.expect.red); set.add(step.expect.black); } else set.add(step.expect);
    }
    return set;
  }

  /** 學員對目前步驟做出的接法 */
  function attempt(choice) {
    const step = current();
    if (!step) return { ok: false, code: 'DONE' };
    const r = evaluateStep(step, choice, { catalog, fits, occupied: occupied() });
    if (r.ok) {
      done.push({ stepId: step.id, choice });
      emit({ type: 'change' });
    } else {
      errors.push({ at: now() - startedAt, stepId: step.id, code: r.code, severity: r.severity });
      emit({ type: 'error', result: r });
    }
    return { ...r, stepId: step.id };
  }

  function undo() {
    const last = done.pop();
    if (last) emit({ type: 'change' });
    return last || null;
  }

  function serialize() {
    return { done: done.map((d) => ({ ...d })), errors: errors.map((e) => ({ ...e })) };
  }
  /** 恢復時每一步重新校驗，存檔被改壞也不會留下錯誤的線 */
  function restore(data) {
    done = [];
    errors = Array.isArray(data?.errors) ? data.errors.filter((e) => steps.some((s) => s.id === e.stepId)).map((e) => ({ ...e })) : [];
    for (const d of Array.isArray(data?.done) ? data.done : []) {
      const step = current();
      if (!step || d.stepId !== step.id) break;
      if (!evaluateStep(step, d.choice || {}, { catalog, fits, occupied: occupied() }).ok) break;
      done.push({ stepId: d.stepId, choice: d.choice });
    }
    emit({ type: 'change' });
  }
  function reset() { done = []; errors = []; emit({ type: 'change' }); }

  return {
    catalog, steps,
    get current() { return current(); },
    get progress() { return { done: done.length, total: steps.length }; },
    get connections() { return done.map((d) => ({ ...d })); },
    get errors() { return errors.map((e) => ({ ...e })); },
    get complete() { return done.length === steps.length; },
    isDone: (stepId) => done.some((d) => d.stepId === stepId),
    systemIssues: () => validateSystem(done.map((d) => d.stepId)),
    attempt, undo, serialize, restore, reset,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

export { CODES };
