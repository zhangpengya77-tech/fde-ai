// 組裝實訓室｜計分（純函式）：只依規則引擎產生的錯誤紀錄計算，AI 不參與。
// 結果標示為「模擬成績」，正式 PASS／NG 由教師覆核（預留 review 欄位）。

/**
 * @param {{ assemblyErrors: Array<{code:string}>, wiringErrors: Array<{code:string, severity:string}>, wiringComplete: boolean, assemblyComplete: boolean }} input
 * @param {object} rules  data/scoring-rules.js
 */
export function computeScore(input, rules) {
  const breakdown = [];
  let deduct = 0;
  const add = (label, count, each) => {
    if (!count) return;
    breakdown.push({ label, count, each, total: count * each });
    deduct += count * each;
  };
  const countBy = (list, key) => list.reduce((m, e) => ((m[e[key]] = (m[e[key]] || 0) + 1), m), {});

  const asm = countBy(input.assemblyErrors || [], 'code');
  for (const [code, each] of Object.entries(rules.assembly)) add(`組裝：${code}`, asm[code] || 0, each);
  const wir = countBy(input.wiringErrors || [], 'severity');
  for (const [sev, each] of Object.entries(rules.wiringSeverity)) add(`接線：${sev}`, wir[sev] || 0, each);

  const score = Math.max(0, rules.full - deduct);
  const hadCritical = (wir.critical || 0) > 0;
  const finished = !!(input.assemblyComplete && input.wiringComplete);
  let pass = finished && score >= rules.passScore;
  let reasonZh = pass ? '達到及格分數。' : finished ? `未達及格分數 ${rules.passScore}。` : '組裝或接線尚未完成。';
  if (rules.criticalFails && hadCritical) { pass = false; reasonZh = '曾發生「嚴重危險」接線錯誤，一律不及格。'; }
  return {
    score, pass, finished, reasonZh, breakdown,
    rulesVersion: rules.version,
    // 預留教師覆核：P5 之後與 Evidence／Enrollment／Cohort 整合（需帳號遷移批准）
    review: { status: 'PENDING_TEACHER', reviewer: null, reviewedAt: null },
  };
}
