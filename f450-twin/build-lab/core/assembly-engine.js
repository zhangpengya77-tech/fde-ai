// 組裝實訓室｜組裝引擎（純邏輯，不碰畫面、不連網）
//
// 負責：哪些零件已安裝、能不能裝／拆（依賴關係）、拖放位置校驗（公釐）、撤銷／重做、錯誤紀錄、序列化。
// 3D 場景與介面只呼叫這裡的函式並聽事件，所以規則可以在 node --test 裡完整測試。
//
// 三種模式：
//   learn（學習）：會提示下一個建議零件；錯誤照樣記錄但不扣分（P4 才計分）
//   free（自由組裝）：不提示順序，只要依賴滿足就能裝
//   exam（考試）：不提示；每次錯誤都完整記錄

export const MODES = Object.freeze(['learn', 'free', 'exam']);

// 錯誤代碼（顯示文字由介面決定）
export const ERR = Object.freeze({
  UNKNOWN_PART: 'UNKNOWN_PART',
  ALREADY_INSTALLED: 'ALREADY_INSTALLED',
  NOT_INSTALLED: 'NOT_INSTALLED',
  MISSING_DEPENDENCY: 'MISSING_DEPENDENCY',   // 前面的零件還沒裝
  POSITION: 'POSITION',                       // 拖放位置離正確位置太遠
  HAS_DEPENDENTS: 'HAS_DEPENDENTS',           // 還有零件裝在它上面，不能先拆
});

/** 兩點距離（公釐） */
export function distanceMm(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 建立組裝引擎。
 * @param {object} model  機型資料（data/*.js 的 *_MODEL）
 * @param {{mode?: string, now?: () => number}} [options]
 */
export function createAssemblyEngine(model, options = {}) {
  const byId = new Map(model.parts.map((p) => [p.partId, p]));
  // 反向依賴：誰依賴我（拆的時候檢查）
  const dependents = new Map(model.parts.map((p) => [p.partId, []]));
  for (const p of model.parts) for (const d of p.dependsOn || []) {
    if (!byId.has(d)) throw new Error(`build_lab_bad_dependency_${p.partId}_${d}`);
    dependents.get(d).push(p.partId);
  }
  const now = options.now || (() => Date.now());
  const tolerance = Number(model.snapToleranceMm) || 15;

  let mode = MODES.includes(options.mode) ? options.mode : 'learn';
  let installed = [];          // 依安裝先後排列的零件 id
  let undoStack = [];
  let redoStack = [];
  let errors = [];             // { at, partId, code, detail }
  const startedAt = now();
  const listeners = new Set();

  const emit = (event) => { for (const fn of listeners) fn(event); };
  const isInstalled = (id) => installed.includes(id);

  function canInstall(id) {
    const part = byId.get(id);
    if (!part) return { ok: false, code: ERR.UNKNOWN_PART };
    if (isInstalled(id)) return { ok: false, code: ERR.ALREADY_INSTALLED };
    const missing = (part.dependsOn || []).filter((d) => !isInstalled(d));
    if (missing.length) return { ok: false, code: ERR.MISSING_DEPENDENCY, missing };
    return { ok: true };
  }

  function canUninstall(id) {
    if (!byId.has(id)) return { ok: false, code: ERR.UNKNOWN_PART };
    if (!isInstalled(id)) return { ok: false, code: ERR.NOT_INSTALLED };
    const blockers = dependents.get(id).filter(isInstalled);
    if (blockers.length) return { ok: false, code: ERR.HAS_DEPENDENTS, blockers };
    return { ok: true };
  }

  function recordError(partId, code, detail) {
    const entry = { at: now() - startedAt, partId, code, detail: detail || null };
    errors.push(entry);
    emit({ type: 'error', ...entry });
    return entry;
  }

  // 真正改狀態的兩個動作（不檢查、不記歷史；給指令與撤銷共用）
  const doInstall = (ids) => { for (const id of ids) if (!isInstalled(id)) installed.push(id); };
  const doUninstall = (ids) => { installed = installed.filter((id) => !ids.includes(id)); };

  function pushCommand(cmd) {
    undoStack.push(cmd);
    redoStack = [];
    emit({ type: 'change', cmd });
  }

  /**
   * 安裝零件。placedPos（公釐）有給時代表學員用拖放，必須落在容許距離內才算對。
   * 回傳 { ok, code?, missing?, distance? }
   */
  function install(id, placedPos) {
    const check = canInstall(id);
    if (!check.ok) {
      if (check.code === ERR.MISSING_DEPENDENCY) recordError(id, check.code, { missing: check.missing });
      return check;
    }
    if (placedPos) {
      const distance = distanceMm(placedPos, byId.get(id).target.pos);
      if (distance > tolerance) {
        recordError(id, ERR.POSITION, { distance: Math.round(distance) });
        return { ok: false, code: ERR.POSITION, distance };
      }
    }
    doInstall([id]);
    pushCommand({ type: 'install', ids: [id] });
    return { ok: true };
  }

  function uninstall(id) {
    const check = canUninstall(id);
    if (!check.ok) {
      if (check.code === ERR.HAS_DEPENDENTS) recordError(id, check.code, { blockers: check.blockers });
      return check;
    }
    doUninstall([id]);
    pushCommand({ type: 'uninstall', ids: [id] });
    return { ok: true };
  }

  /** 建議的下一個零件：依學習順序，第一個還沒裝而且依賴已滿足的 */
  function nextSuggested() {
    for (const id of model.order) if (!isInstalled(id) && canInstall(id).ok) return id;
    return null;
  }

  /** 「下一步安裝」：裝建議的下一個（不做位置校驗，動畫由場景負責） */
  function installNext() {
    const id = nextSuggested();
    if (!id) return { ok: false, code: 'DONE' };
    return { ...install(id), partId: id };
  }

  /** 拆解全部：依安裝相反順序一次拆完（一個指令，可整批撤銷） */
  function disassembleAll() {
    if (!installed.length) return { ok: false };
    const ids = [...installed].reverse();
    doUninstall(ids);
    pushCommand({ type: 'uninstall', ids });
    return { ok: true, ids };
  }

  /** 全部復原（組完整台）：依學習順序把還沒裝的一次裝上 */
  function assembleAll() {
    const ids = model.order.filter((id) => !isInstalled(id));
    if (!ids.length) return { ok: false };
    doInstall(ids);
    pushCommand({ type: 'install', ids });
    return { ok: true, ids };
  }

  function undo() {
    const cmd = undoStack.pop();
    if (!cmd) return null;
    if (cmd.type === 'install') doUninstall(cmd.ids); else doInstall([...cmd.ids].reverse());
    redoStack.push(cmd);
    emit({ type: 'change', cmd, undo: true });
    return cmd;
  }

  function redo() {
    const cmd = redoStack.pop();
    if (!cmd) return null;
    if (cmd.type === 'install') doInstall(cmd.ids); else doUninstall(cmd.ids);
    undoStack.push(cmd);
    emit({ type: 'change', cmd, redo: true });
    return cmd;
  }

  function setMode(next) {
    if (!MODES.includes(next)) return false;
    mode = next;
    emit({ type: 'mode', mode });
    return true;
  }

  /** 存成純資料（給本機儲存與匯出）；不含任何學員個資 */
  function serialize() {
    return {
      kind: 'fde-build-lab-progress',
      schema: 1,
      modelId: model.modelId,
      mode,
      installed: [...installed],
      errors: errors.map((e) => ({ ...e })),
      elapsedMs: now() - startedAt,
    };
  }

  /** 從存檔恢復；資料不合法就丟錯（呼叫端顯示「存檔無法讀取」） */
  function restore(data) {
    if (!data || data.kind !== 'fde-build-lab-progress' || data.modelId !== model.modelId) throw new Error('build_lab_bad_save');
    const ids = Array.isArray(data.installed) ? data.installed.filter((id) => byId.has(id)) : [];
    // 重新依依賴順序檢查：存檔被改壞時，不讓「沒有底座卻有機臂」這種狀態出現
    installed = [];
    for (const id of ids) if (canInstall(id).ok) installed.push(id);
    // 只保留「已知零件＋已知錯誤代碼」，欄位重新組合；匯入的檔案可能被竄改，不能把任意文字帶進畫面
    const known = new Set(Object.values(ERR));
    errors = Array.isArray(data.errors)
      ? data.errors.filter((e) => e && byId.has(e.partId) && known.has(e.code))
        .map((e) => ({ at: Number(e.at) || 0, partId: e.partId, code: e.code, detail: null }))
      : [];
    if (MODES.includes(data.mode)) mode = data.mode;
    undoStack = [];
    redoStack = [];
    emit({ type: 'change', restored: true });
  }

  return {
    model,
    get mode() { return mode; },
    get installed() { return [...installed]; },
    get errors() { return errors.map((e) => ({ ...e })); },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get progress() { return { done: installed.length, total: model.parts.length }; },
    part: (id) => byId.get(id),
    isInstalled, canInstall, canUninstall, install, uninstall, installNext, nextSuggested,
    disassembleAll, assembleAll, undo, redo, setMode, serialize, restore,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
