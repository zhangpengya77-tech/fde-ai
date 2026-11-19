// AI 學習助教（規則式版本）：
// 目前「沒有」接上外部大型語言模型；回答來自本檔經教材整理的知識庫＋關鍵字比對。
// 畫面上會明確標示「規則式助教」，不假裝是 AI 推理。學員輸入的文字只在瀏覽器內處理，不送出。
import { UNITS } from '../data/units.js';
import { OLD_TO_NEW } from '../data/order.js';

export const GLOSSARY = [
  { k: ['pitch', '俯仰'], a: 'Pitch（俯仰）：機頭往下或往上，控制前進後退。前後兩組電機產生轉速差。', unit: 3 },
  { k: ['roll', '橫滾'], a: 'Roll（橫滾）：機身往左右傾斜，控制左右平移。', unit: 3 },
  { k: ['yaw', '偏航'], a: 'Yaw（偏航）：機身原地水平旋轉，靠順時針與逆時針電機的反扭力差。', unit: 3 },
  { k: ['throttle', '油門'], a: 'Throttle（油門）：4 顆電機一起加速或減速，控制上升下降。', unit: 3 },
  { k: ['升力', '重力', '懸停'], a: '升力 = 重力時懸停；升力大於重力上升；小於重力下降。', unit: 2 },
  { k: ['推重比'], a: '推重比 = 總最大推力 ÷ 起飛重量；空拍機約 2，低於 1.5 很難控制。', unit: 2 },
  { k: ['esc', '電調', '調速'], a: 'ESC（電子調速器）依飛控命令快速切換三相線圈通電（換相），控制無刷電機轉速。', unit: 4 },
  { k: ['換相', '六步'], a: '六步換相：A+B−、A+C−、B+C−、B+A−、C+A−、C+B−，每步磁場轉 60° 電角度。', unit: 4 },
  { k: ['kv'], a: 'KV 值 = 每 1 伏特的空載轉速（rpm）。920KV × 11.1 V ≈ 10,200 rpm。', unit: 4 },
  { k: ['無刷', '定子', '轉子', '磁鐵', '線圈'], a: '無刷電機：定子（線圈，不動）＋轉子（鐘罩內貼磁鐵，會轉）＋軸承。線圈依序通電吸引磁鐵就轉起來。', unit: 4 },
  { k: ['串聯', 's數', '3s', '4s', '6s'], a: '串聯：電壓相加、容量不變。3S = 11.1 V、4S = 14.8 V、6S = 22.2 V（標稱）。', unit: 5 },
  { k: ['並聯', 'p數'], a: '並聯：容量相加、電壓不變。2 顆 2000 mAh 並聯 = 4000 mAh。', unit: 5 },
  { k: ['wh', '能量'], a: '能量 Wh = 電壓 V × 容量 Ah。4S 5000 mAh = 14.8 × 5 = 74 Wh。', unit: 5 },
  { k: ['鼓包', '過充', '電池安全', '起火'], a: '鋰電池單芯不可超過 4.2 V（過充）或低於 3.0 V（過放）。鼓包立即停用交給老師處理，絕對不要拆解或刺穿。', unit: 5 },
  { k: ['陀螺儀'], a: '陀螺儀量角速度（轉得多快）。會慢慢漂移，需要加速度計校正。', unit: 6 },
  { k: ['加速度計'], a: '加速度計量加速度與重力方向，可算出傾斜角，但容易受震動干擾。', unit: 6 },
  { k: ['氣壓計', '高度'], a: '氣壓計利用「越高氣壓越低」估算高度，約每 8 m 降 1 hPa。', unit: 6 },
  { k: ['gps'], a: 'GPS 用衛星訊號算位置，可定點與返航；室內通常收不到。', unit: 6 },
  { k: ['pid', '自穩', '回正'], a: 'PID：誤差越大修正越大（P）、長期誤差慢慢補（I）、變化太快先煞車（D）。', unit: 6 },
  { k: ['m1', '電機編號', '轉向'], a: 'ArduPilot Quad X：M1 右前（逆時針）、M2 左後（逆時針）、M3 左前（順時針）、M4 右後（順時針）。', unit: 7 },
  { k: ['安全距離', '站位'], a: '練習時站在無人機後方，至少保持 5 公尺，不可飛越人群。', unit: 8 },
  { k: ['400', '高度限制', '空域', '禁航'], a: '一般區域不超過 400 呎（約 120 m）、日間目視飛行；機場周邊與禁航區不可飛。以民航局公告為準。', unit: 8 },
  { k: ['起飛', '降落'], a: '起飛慢推油門到約 1.5 m 穩住；降落先懸停再慢收油門，落地後收到底並上鎖。', unit: 9 },
  { k: ['足球', '得分', '球門', '圓環'], a: '無人機足球：只有得分機穿過對方圓環球門才得分；防守機守在自己門前並與圓環同高。', unit: 10 },
  { k: ['迴圈', '重複'], a: '迴圈：重複做同一件事。重複 4 次（前進、右轉 90°）＝正方形。', unit: 11 },
  { k: ['條件', '如果'], a: '條件判斷：「如果……就……否則……」，例如電量低於 30% 就返航。', unit: 11 },
  { k: ['假設', '變因', '報告'], a: '專題：寫假設 → 決定操縱變因與控制變因 → 每條件測 3 次 → 平均 → 結論回答假設。', unit: 12 }
];

/** 回答問題：回傳 {answer, unit, matched}；沒命中時給引導，不編造 */
export function ask(question) {
  const q = String(question || '').toLowerCase().slice(0, 200);
  if (!q.trim()) return { answer: '請輸入你想問的名詞或問題，例如「什麼是 Yaw」。', matched: false };
  let best = null, bestScore = 0;
  for (const g of GLOSSARY) {
    const score = g.k.reduce((n, k) => n + (q.includes(k.toLowerCase()) ? k.length : 0), 0);
    if (score > bestScore) { bestScore = score; best = g; }
  }
  if (!best) return { answer: '這個問題目前的知識庫沒有收錄，請把問題記下來問老師。你也可以試著換個關鍵字，例如「串聯」「陀螺儀」「換相」。', matched: false };
  const unitId = OLD_TO_NEW[best.unit];
  const u = UNITS.find(x => x.id === unitId);
  return { answer: best.a, unit: unitId, unitTitle: u?.title, matched: true };
}

/** 答錯分析：依錯題回傳複習建議 */
export function reviewAdvice(unit, wrongIdx) {
  if (!wrongIdx.length) return '全部答對！可以進入下一單元，或到足球訓練場挑戰任務。';
  const tips = wrongIdx.map(i => `第 ${i + 1} 題：${unit.quiz[i].explain}`);
  const next = wrongIdx.length >= 2 ? `建議先回到「知識講解」重讀，再操作一次「${unit.widget ? '互動動畫' : '實驗'}」後重新測驗。` : '再看一次解析後重新測驗。';
  return tips.join('\n') + '\n' + next;
}

/** 下一步學習建議 */
export function nextStep(progressOf) {
  for (const u of UNITS) {
    const p = progressOf(u.id);
    if (p.done < p.total) return { unit: u, text: `繼續第 ${u.id} 單元「${u.title}」（已完成 ${p.done}/${p.total} 步）。` };
  }
  return { unit: null, text: '12 個單元都完成了！挑戰足球訓練場的「計時挑戰」吧。' };
}
