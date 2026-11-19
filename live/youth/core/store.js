// 學習紀錄（瀏覽器本機儲存）：個資最小化，只存「暱稱＋班級代碼」，不存真實姓名、電話、學號
// 每個班級代碼＋暱稱是一個獨立紀錄，讀取時只取目前學員自己的資料（不跨班、不跨人）
// 尚未接 FDE-AI 伺服器帳號系統：要接 student_portal 需要後端修改與使用者授權（見 DEPLOYMENT_AND_ROLLBACK.md）

const KEY = 'fde-youth-v1';
const mem = { data: null };   // 無法使用 localStorage（私密模式）時退回記憶體

function load() {
  if (mem.data) return mem.data;
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { d = null; }
  mem.data = d && typeof d === 'object' ? d : { current: null, learners: {} };
  return mem.data;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(mem.data)); } catch { /* 私密模式：只留記憶體 */ }
}

/** 暱稱與班級代碼只允許中英數，長度限制，避免輸入真實個資或注入 */
export function cleanId(s, max = 12) {
  return String(s || '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, max);
}

export function login(nick, cls) {
  nick = cleanId(nick); cls = cleanId(cls, 16).toUpperCase();
  if (!nick || !cls) throw new Error('請輸入暱稱與班級代碼');
  const d = load();
  const id = `${cls}::${nick}`;
  d.learners[id] ??= { nick, cls, created: Date.now(), units: {}, labs: {}, soccer: [], projects: [], log: [] };
  d.current = id; save();
  return d.learners[id];
}
export function logout() { load().current = null; save(); }
export function me() { const d = load(); return d.current ? d.learners[d.current] : null; }

function rec() {
  const m = me();
  if (!m) return null;
  return m;
}
function log(m, type, detail) {
  m.log.push({ t: Date.now(), type, detail });
  if (m.log.length > 500) m.log.splice(0, m.log.length - 500);
}

/** 單元進度：步驟 read / widget / task / lab / quiz */
export function markStep(unitId, step) {
  const m = rec(); if (!m) return;
  const u = (m.units[unitId] ??= { steps: {}, best: null, attempts: 0 });
  if (!u.steps[step]) { u.steps[step] = Date.now(); log(m, 'step', { unitId, step }); save(); }
}
export function saveQuiz(unitId, score, total, wrong) {
  const m = rec(); if (!m) return;
  const u = (m.units[unitId] ??= { steps: {}, best: null, attempts: 0 });
  u.attempts++;
  const pct = Math.round(score / total * 100);
  if (u.best == null || pct > u.best) u.best = pct;
  if (pct >= 60) u.steps.quiz ??= Date.now();
  log(m, 'quiz', { unitId, pct, wrong }); save();
  return pct;
}
export function unitProgress(unitId) {
  const m = me(); const u = m?.units?.[unitId];
  const steps = ['read', 'widget', 'task', 'lab', 'quiz'];
  const done = u ? steps.filter(s => u.steps[s]).length : 0;
  return { done, total: steps.length, pct: Math.round(done / steps.length * 100), best: u?.best ?? null };
}
export function saveLab(labId, result) {
  const m = rec(); if (!m) return;
  const L = (m.labs[labId] ??= { runs: 0, completed: null, last: null });
  L.runs++; L.last = result;
  if (result?.completed) L.completed ??= Date.now();
  log(m, 'lab', { labId, ...result }); save();
}
export function saveSoccer(run) {
  const m = rec(); if (!m) return;
  m.soccer.push({ t: Date.now(), ...run });
  if (m.soccer.length > 200) m.soccer.shift();
  log(m, 'soccer', run); save();
}
export function saveProject(p) {
  const m = rec(); if (!m) return;
  m.projects.push({ t: Date.now(), ...p, grade: null });
  log(m, 'project', { title: p.title }); save();
}

/** 學習成果報告（給學生下載交給老師；只含暱稱與班級代碼） */
export function exportReport() {
  const m = me(); if (!m) return null;
  return { format: 'fde-youth-report', version: 1, exported: new Date().toISOString(),
    nick: m.nick, cls: m.cls, units: m.units, labs: m.labs, soccer: m.soccer.slice(-50), projects: m.projects };
}

// ---- 教師端（本機）：匯入學生交來的報告檔，依班級代碼分開，不跨班顯示 ----
const TKEY = 'fde-youth-teacher-v1';
export function teacherData() {
  try { return JSON.parse(localStorage.getItem(TKEY) || 'null') || { classes: {} }; } catch { return { classes: {} }; }
}
export function teacherSave(d) { try { localStorage.setItem(TKEY, JSON.stringify(d)); } catch { /* 略 */ } }
export function teacherCreateClass(code, name) {
  code = cleanId(code, 16).toUpperCase(); if (!code) throw new Error('班級代碼不可空白');
  const d = teacherData(); d.classes[code] ??= { name: String(name || code).slice(0, 30), assigned: [], students: {} };
  teacherSave(d); return d;
}
/** 匯入報告：只接受格式正確、且班級代碼存在於老師清單的報告 */
export function teacherImport(report, onlyClass) {
  if (!report || report.format !== 'fde-youth-report') throw new Error('檔案格式不是 FDE-AI 青少年學習報告');
  const cls = cleanId(report.cls, 16).toUpperCase();
  const nick = cleanId(report.nick);
  if (onlyClass && cls !== onlyClass) throw new Error(`這份報告屬於班級 ${cls}，不是目前選擇的 ${onlyClass}`);
  const d = teacherData();
  if (!d.classes[cls]) throw new Error(`尚未建立班級 ${cls}`);
  d.classes[cls].students[nick] = { ...report, imported: Date.now() };
  teacherSave(d); return { cls, nick };
}

// 測試用：重設記憶體快取
export function _reset() { mem.data = null; }
