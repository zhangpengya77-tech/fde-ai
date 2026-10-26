// 任務 D：P0-B 機體參數一致性只讀檢查（第四輪）。
//
// 用法：node tools/penta-param-check.mjs [--json]
// 輸出：差異與來源報告（**只讀**：不修改任何參數、模型或飛控）。
// 退出碼：0 = 無數值不一致（可能有 WARN）；1 = 發現數值不一致（FAIL）。
//
// 核對對象：
//  - config/exam-aircraft.json   考試機型參數（附件十二樣機規格＋模擬假設）
//  - config/caa-exam.json        官方考試規範（AC 107-005D 附錄，附頁碼）
//  - src/exam/scene.ts           正式考試機 ExamDrone 視覺模型（原始碼常數實測）
//  - src/exam/penta-scene.ts     科目 E 教學機 PentaDrone 視覺模型（原始碼常數實測）
//  - diagonalSpanCm（對角馬達軸心距離）三處一致性
//  - 官方已核實值 vs 模擬假設／教學假設值
//
// 執行期幾何實測（Three.js 場景物件）由單元測試覆蓋：
//  tests/unit/exam-penta-params.test.ts（本工具為靜態原始碼／配置檢查）。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
const readText = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

const aircraft = readJson('config/exam-aircraft.json');
const caa = readJson('config/caa-exam.json');
const sceneSrc = readText('src/exam/scene.ts');
const pentaSceneSrc = readText('src/exam/penta-scene.ts');
const controllerSrc = readText('src/exam/flight-controller.ts');

/** 檢查結果。level: PASS | WARN（文檔不一致，不影響數值）| FAIL（數值不一致）。 */
const findings = [];
const add = (level, check, detail) => findings.push({ level, check, detail });

// ---------------------------------------------------------------------------
// 1. 視覺模型實際幾何（原始碼常數 → 對角馬達軸心距離）
//    馬達位於半徑 r 的 45° 等分點；對角兩馬達相距 2r（公尺）。
// ---------------------------------------------------------------------------
function motorRadius(src, pattern, label) {
  const m = pattern.exec(src);
  if (!m) {
    add('FAIL', `${label} 馬達半徑常數`, `找不到馬達半徑常數（正則：${pattern}）`);
    return null;
  }
  return Number(m[1]);
}

const sceneRadius = motorRadius(sceneSrc, /const mx = Math\.cos\(angle\)\s*\*\s*([0-9.]+)/, 'scene.ts ExamDrone');
const pentaRadius = motorRadius(pentaSceneSrc, /motor\.position\.set\(Math\.cos\(angle\)\s*\*\s*([0-9.]+)/, 'penta-scene.ts PentaDrone');
const sceneDiagonalM = sceneRadius === null ? null : 2 * sceneRadius;
const pentaDiagonalM = pentaRadius === null ? null : 2 * pentaRadius;

// ---------------------------------------------------------------------------
// 2. exam-aircraft.json（附件十二級別 I 樣機軸距）
// ---------------------------------------------------------------------------
const span = aircraft.sampleAircraft.diagonalSpanCm;
add(
  span.value >= span.rangeCm[0] && span.value <= span.rangeCm[1] ? 'PASS' : 'FAIL',
  'exam-aircraft.json diagonalSpanCm 值在附件十二區間內',
  `value=${span.value}cm，range=${span.rangeCm[0]}–${span.rangeCm[1]}cm`,
);
add(
  span.source.includes('附件十二') ? 'PASS' : 'FAIL',
  'exam-aircraft.json diagonalSpanCm 來源標註附件十二',
  `source="${span.source}"`,
);

// 其餘樣機參數的假設標記（非官方者必須標「模擬假設」）。
for (const [key, val] of Object.entries(aircraft.sampleAircraft)) {
  if (key === 'diagonalSpanCm' || typeof val !== 'object' || val === null) continue;
  const src = typeof val.source === 'string' ? val.source : '';
  if (src.includes('附件十二')) {
    add('PASS', `exam-aircraft.json ${key} 來源為附件十二`, `source="${src}"`);
  } else if (src.includes('模擬假設')) {
    add('PASS', `exam-aircraft.json ${key} 標記為模擬假設（非官方）`, `source="${src}"`);
  } else {
    add('WARN', `exam-aircraft.json ${key} 來源標註不明`, `source="${src || '（無）'}"`);
  }
}

// ---------------------------------------------------------------------------
// 3. caa-exam.json aircraft（官方規範欄位）
// ---------------------------------------------------------------------------
const d = caa.aircraft.sampleAircraftDefaults;
add(
  d.diagonalSpanCm === span.value ? 'PASS' : 'FAIL',
  'caa-exam.json ↔ exam-aircraft.json 軸距一致',
  `caa=${d.diagonalSpanCm}cm vs aircraft=${span.value}cm`,
);
add(
  JSON.stringify(d.diagonalSpanRangeCm) === JSON.stringify(span.rangeCm) ? 'PASS' : 'FAIL',
  'caa-exam.json ↔ exam-aircraft.json 軸距區間一致',
  `caa=${JSON.stringify(d.diagonalSpanRangeCm)} vs aircraft=${JSON.stringify(span.rangeCm)}`,
);
add(
  d.note.includes('模擬預設') ? 'PASS' : 'WARN',
  'caa-exam.json 軸距標記為模擬預設（非官方公告值）',
  `note="${d.note}"`,
);
add(
  caa.aircraft.levelSourceNote.includes('附件十二') && caa.aircraft.source.includes('附件十二') ? 'PASS' : 'FAIL',
  'caa-exam.json aircraft 官方來源為附件十二',
  `source="${caa.aircraft.source}"`,
);

// ---------------------------------------------------------------------------
// 4. 視覺模型實測對角 ↔ exam-aircraft.json（數值一致性）
// ---------------------------------------------------------------------------
const spanM = span.value / 100;
if (sceneDiagonalM !== null) {
  add(
    Math.abs(sceneDiagonalM - spanM) < 1e-9 ? 'PASS' : 'FAIL',
    'scene.ts ExamDrone 實測對角 ↔ config diagonalSpanCm',
    `實測 ${sceneDiagonalM.toFixed(2)}m（馬達半徑 ${sceneRadius} × 2）vs config ${spanM.toFixed(2)}m`,
  );
}
if (pentaDiagonalM !== null) {
  add(
    Math.abs(pentaDiagonalM - spanM) < 1e-9 ? 'PASS' : 'FAIL',
    'penta-scene.ts PentaDrone 實測對角 ↔ config diagonalSpanCm',
    `實測 ${pentaDiagonalM.toFixed(2)}m（馬達半徑 ${pentaRadius} × 2）vs config ${spanM.toFixed(2)}m`,
  );
}
add(
  sceneDiagonalM !== null && pentaDiagonalM !== null && Math.abs(sceneDiagonalM - pentaDiagonalM) < 1e-9
    ? 'PASS'
    : 'FAIL',
  'scene.ts ↔ penta-scene.ts 馬達半徑一致（兩視覺模型同機型）',
  `scene=${sceneDiagonalM} vs penta=${pentaDiagonalM}（m）`,
);

// ---------------------------------------------------------------------------
// 5. 註解聲稱值 ↔ 實測值（文檔一致性；僅註解過時記 WARN，不影響數值）
// ---------------------------------------------------------------------------
function commentClaims(src, label) {
  const re = /對角[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*m/g;
  const out = [];
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index).split('\n').length;
    out.push({ label, line, claimedM: Number(m[1]), claimedText: m[1], text: m[0].trim() });
  }
  return out;
}
const claims = [...commentClaims(sceneSrc, 'scene.ts'), ...commentClaims(pentaSceneSrc, 'penta-scene.ts')];
if (claims.length === 0) {
  add('WARN', '對角距離註解', 'scene.ts／penta-scene.ts 皆無「對角…m」註解，無法與原始碼常數交叉核對');
}
for (const c of claims) {
  const measured = c.label === 'scene.ts' ? sceneDiagonalM : pentaDiagonalM;
  if (measured === null) continue; // 馬達半徑常數缺失已記 FAIL
  const ok = Math.abs(c.claimedM - measured) <= 0.005;
  add(
    ok ? 'PASS' : 'WARN',
    `${c.label}:${c.line} 註解聲稱對角 ${c.claimedText}m`,
    ok
      ? `與實測 ${measured.toFixed(2)}m 一致`
      : `文檔不一致：註解「${c.text}」聲稱 ${c.claimedM}m，但原始碼常數實測 ${measured.toFixed(2)}m。僅註解文字過時，數值以常數為準（本工具未修改任何檔案）`,
  );
}

// ---------------------------------------------------------------------------
// 6. 飛控不依賴視覺軸距（避免「改模型就改飛控」的隱性耦合）
// ---------------------------------------------------------------------------
const controllerSpanRef = /diagonalSpan|軸距|wheelbase/i.test(controllerSrc);
add(
  controllerSpanRef ? 'WARN' : 'PASS',
  'flight-controller.ts 不含軸距常數',
  controllerSpanRef
    ? '飛控源碼出現軸距相關字面量，請人工確認是否為隱性耦合'
    : '飛控動力學（質量／時間常數／速率限制）不依賴視覺模型尺寸；調整視覺模型不影響飛控行為',
);

// ---------------------------------------------------------------------------
// 7. 官方已核實值 vs 模擬假設／教學假設（分類匯總，不竄改來源標註）
// ---------------------------------------------------------------------------
const officialParams = [];
const assumedParams = [];
for (const [key, val] of Object.entries(aircraft.sampleAircraft)) {
  if (typeof val !== 'object' || val === null || typeof val.source !== 'string') continue;
  const entry = `${key}=${JSON.stringify(val.value ?? val)}（${val.source}）`;
  if (val.source.includes('附件十二')) officialParams.push(entry);
  else if (val.source.includes('模擬假設')) assumedParams.push(entry);
}
add(
  officialParams.length > 0 ? 'PASS' : 'FAIL',
  'exam-aircraft.json 官方值（附件十二）存在且可識別',
  officialParams.join('；'),
);
add(
  assumedParams.length > 0 ? 'PASS' : 'WARN',
  'exam-aircraft.json 模擬假設值皆標「模擬假設，非官方」',
  assumedParams.join('；'),
);

// caa-exam.json：原廠規格欄位留 null（讀不到不造假）。
const nullDefaults = Object.entries(caa.aircraft.sampleAircraftDefaults)
  .filter(([, v]) => v === null)
  .map(([k]) => k);
add(
  nullDefaults.length > 0 ? 'PASS' : 'WARN',
  'caa-exam.json 原廠規格欄位留 null（讀不到不造假）',
  `留 null 待原廠規格：${nullDefaults.join('、')}`,
);

// 教學容差：assumption=true 且 note 載明模擬假設。
const subjectEAssist = caa.simAssist?.subjectE;
add(
  subjectEAssist?.assumption === true ? 'PASS' : 'FAIL',
  '科目 E 教學容差標記 assumption=true（非官方）',
  subjectEAssist?.assumption === true
    ? `容差：航線 ${subjectEAssist.routeDeviationToleranceM}m／高度 ${subjectEAssist.altitudeToleranceM}m／航點半徑 ${subjectEAssist.waypointReachRadiusM}m／每段最短 ${subjectEAssist.minSegmentTimeS}s／起飛完成 ${subjectEAssist.takeoffCompleteToleranceM}m`
    : 'simAssist.subjectE 缺少 assumption=true 標記',
);
add(
  typeof subjectEAssist?.note === 'string' && subjectEAssist.note.includes('模擬假設') ? 'PASS' : 'WARN',
  '科目 E 教學容差 note 載明「模擬假設，非官方」',
  typeof subjectEAssist?.note === 'string' ? subjectEAssist.note : '（無 note）',
);

// 級距空域：exam-aircraft.json levels[].pentaAirspaceM ↔ caa 官方最低空域（p165）。
const airspaceByLevel = caa.subjects?.E_altitude_hold_five_sided?.params?.minOperationAirspaceByLevelM;
for (const lvl of aircraft.levels) {
  const officialAir = airspaceByLevel?.[lvl.level];
  const m = /^(\d+)\s*[×x]\s*(\d+)$/.exec(String(lvl.pentaAirspaceM ?? ''));
  if (!officialAir || !m) {
    add('FAIL', `級距 ${lvl.level} 空域交叉核對`, `aircraft="${lvl.pentaAirspaceM}" vs caa=${JSON.stringify(officialAir)}`);
    continue;
  }
  add(
    Number(m[1]) === officialAir.length && Number(m[2]) === officialAir.width ? 'PASS' : 'FAIL',
    `級距 ${lvl.level} 最低空域 exam-aircraft.json ↔ caa-exam.json`,
    `aircraft="${lvl.pentaAirspaceM}" vs caa=${officialAir.length}×${officialAir.width}`,
  );
}

// 操作區 ≥ 官方最低空域（兩者為不同官方概念：場地 p233 vs 最低空域 p165）。
add(
  caa.field.operationArea.lengthM >= airspaceByLevel.I.length && caa.field.operationArea.widthM >= airspaceByLevel.I.width
    ? 'PASS'
    : 'WARN',
  '操作區 ≥ 科目 E 級距 I 最低空域（考場大於官方最低要求）',
  `操作區 ${caa.field.operationArea.lengthM}×${caa.field.operationArea.widthM}m（p233）vs 最低空域 ${airspaceByLevel.I.length}×${airspaceByLevel.I.width}m（p165）`,
);

// 目標高度／空域：penta-app 取自官方 config，無硬編碼。
const pentaAppSrc = readText('src/exam/penta-app.ts');
const opAlt = caa.subjects?.E_altitude_hold_five_sided?.params?.operationAltitudeM;
add(
  opAlt === 20 && pentaAppSrc.includes('operationAltitudeM') && !/takeoff\(\s*20\s*\)/.test(pentaAppSrc)
    ? 'PASS'
    : 'FAIL',
  'penta-app.ts 起飛目標高度取自官方 config（無硬編碼 20）',
  `官方 operationAltitudeM=${opAlt}m；penta-app 以 subjectE.params.operationAltitudeM 驅航線與起飛`,
);
add(
  pentaAppSrc.includes('pentaAirspaceForLevel') ? 'PASS' : 'FAIL',
  'penta-app.ts 空域矩形取自官方 config（無硬編碼尺寸）',
  'pentaAirspaceForLevel(config, config.level) → subjects.E.params.minOperationAirspaceByLevelM',
);

// ---------------------------------------------------------------------------
// 8. 報告輸出（--json 機器可讀；預設人類可讀）與退出碼
// ---------------------------------------------------------------------------
const jsonMode = process.argv.includes('--json');
const failCount = findings.filter((f) => f.level === 'FAIL').length;
const warnCount = findings.filter((f) => f.level === 'WARN').length;
const passCount = findings.filter((f) => f.level === 'PASS').length;
const summary = { total: findings.length, pass: passCount, warn: warnCount, fail: failCount };

if (jsonMode) {
  console.log(
    JSON.stringify(
      { tool: 'penta-param-check', readOnly: true, generatedAt: new Date().toISOString(), summary, findings },
      null,
      2,
    ),
  );
} else {
  const icon = { PASS: '✔', WARN: '⚠', FAIL: '✗' };
  console.log('P0-B 機體參數一致性檢查（唯讀：不修改任何參數、模型或飛控）');
  console.log(`  檢查項 ${summary.total} 項：PASS ${passCount}／WARN ${warnCount}／FAIL ${failCount}\n`);
  for (const level of ['FAIL', 'WARN', 'PASS']) {
    const group = findings.filter((f) => f.level === level);
    if (group.length === 0) continue;
    console.log(`【${level}】`);
    for (const f of group) console.log(`  ${icon[level]} ${f.check}\n      ${f.detail}`);
    console.log('');
  }
  if (failCount > 0) {
    console.log('結論：發現數值不一致（FAIL>0）。本工具只讀，未修改任何檔案；請人工裁決後再改。');
  } else if (warnCount > 0) {
    console.log('結論：無數值不一致；有文檔層面 WARN（註解／標註過時），請一併確認。');
  } else {
    console.log('結論：全部一致。');
  }
}

process.exitCode = failCount > 0 ? 1 : 0;
