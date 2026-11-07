/**
 * REA 考照模擬器：考場幾何與科目步驟定義。
 *
 * 座標系（考場座標，單位公尺）：
 *  - 原點 = 起降點 H 中心；x 往右（考生面向場地時的右手邊）；y 往前（遠離考生）；h 為離地高度。
 *  - 機頭角 heading：0° = 朝外（與考生同向，+y）、90° = 朝右（+x）、180° = 朝內（朝考生）、270° = 朝左。
 *
 * 尺寸來源：民航局 AC 107-005D 遙控無人機術科測驗規範（2026-01-21 勘誤版）場地圖，
 * 經 drone.sean.cat 公開指南的場地示意圖量測換算（I 級 30×23 m、I2 小場地 15×15 m）。
 * 詳見 docs/rea/EXAM_RULES_SOURCES.md。此處只採用「事實尺寸」，未複製任何程式碼或圖檔。
 */

export type Vec2 = { x: number; y: number };
export type FieldKind = 'I' | 'I2';
export type License = 'I2' | 'I' | 'G1' | 'G2' | 'G3';

export interface Field {
  kind: FieldKind;
  /** 場地外框（公尺）。 */
  bounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  /** 起降點 H 半徑（直徑 2 m）。 */
  hRadius: number;
  /** 角錐位置。 */
  cones: Record<string, Vec2>;
  /** 8 字圓（僅 I 級場地）：圓心、飛行半徑、環帶內外半徑。 */
  rings: { center: Vec2; radius: number; inner: number; outer: number }[];
  /** 高級 G3 興趣點 A、B（僅 I 級場地）。 */
  poi: Record<string, Vec2>;
  /** 考生位置（H 後方）。 */
  examinee: Vec2;
}

/** I 級（2–25 kg）場地：30 × 23 m，8 字兩圓圓心 (±6, 6)、飛行半徑 6 m、環帶 4–8 m。 */
export const FIELD_I: Field = {
  kind: 'I',
  bounds: { xMin: -15, xMax: 15, yMin: -9, yMax: 14 },
  hRadius: 1,
  cones: {
    P1: { x: -6, y: 12 },
    P2: { x: -12, y: 6 },
    P3: { x: -6, y: 0 },
    P4: { x: 0, y: 6 },
    P5: { x: 6, y: 12 },
    P6: { x: 12, y: 6 },
    P7: { x: 6, y: 0 },
  },
  rings: [
    { center: { x: -6, y: 6 }, radius: 6, inner: 4, outer: 8 },
    { center: { x: 6, y: 6 }, radius: 6, inner: 4, outer: 8 },
  ],
  poi: { A: { x: -13.5, y: 12.5 }, B: { x: 13.5, y: 12.5 } },
  examinee: { x: 0, y: -7 },
};

/** I2（< 2 kg）小場地：15 × 15 m，P1–P4 圍成 12 × 5 m 長方形。 */
export const FIELD_I2: Field = {
  kind: 'I2',
  bounds: { xMin: -7.5, xMax: 7.5, yMin: -6.5, yMax: 8.5 },
  hRadius: 1,
  cones: {
    P1: { x: -6, y: 0 },
    P2: { x: -6, y: 5 },
    P3: { x: 6, y: 5 },
    P4: { x: 6, y: 0 },
  },
  rings: [],
  poi: {},
  examinee: { x: 0, y: -5 },
};

/** 科目步驟：自動駕駛（示範）與評等器共用同一份步驟，確保「示範＝評分依據」。 */
export type Step =
  | { kind: 'takeoff'; alt: number; heading: number; label: string }
  | { kind: 'hold'; seconds: number; heading: number; label: string }
  | { kind: 'yaw'; heading: number; label: string }
  | { kind: 'fly'; to: Vec2; alt?: number; heading: number | 'along' | 'reverse'; label: string }
  | { kind: 'arc'; center: Vec2; radius: number; startDeg: number; sweepDeg: number; label: string }
  | { kind: 'climb'; alt: number; label: string }
  | { kind: 'land'; label: string; target?: Vec2; radius?: number }
  | { kind: 'emergency-return'; label: string };

export interface Subject {
  id: string;
  name: string;
  /** 適用證照（顯示用）。 */
  licenses: License[];
  field: FieldKind;
  /** 預設機型（隨科目）。 */
  defaultAirframe: AirframeId;
  /** 正常飛行高度帶（公尺）。 */
  altBand: [number, number];
  steps: Step[];
  /** 規範重點（自行改寫的摘要，詳細看來源文件）。 */
  brief: string;
  /** 評等時 cross-track 容許（公尺）：頂尖／標準／擦邊。 */
  track: [number, number, number];
  implemented: boolean;
}

export type AirframeId = 'quad-800g' | 'quad-4kg' | 'hexa-18kg';

const HOVER_ALT = 1.5;
const H: Vec2 = { x: 0, y: 0 };

function hoverSteps(): Step[] {
  return [
    { kind: 'takeoff', alt: HOVER_ALT, heading: 0, label: '起飛（機頭朝外）' },
    { kind: 'hold', seconds: 5, heading: 0, label: '朝外停 5 秒' },
    { kind: 'yaw', heading: 90, label: '機頭轉向右' },
    { kind: 'hold', seconds: 5, heading: 90, label: '朝右停 5 秒' },
    { kind: 'yaw', heading: 180, label: '機頭轉向內' },
    { kind: 'hold', seconds: 5, heading: 180, label: '朝內停 5 秒' },
    { kind: 'yaw', heading: 270, label: '機頭轉向左' },
    { kind: 'hold', seconds: 5, heading: 270, label: '朝左停 5 秒' },
    { kind: 'yaw', heading: 360, label: '機頭轉回朝外' },
    { kind: 'hold', seconds: 5, heading: 0, label: '最後朝外停 5 秒' },
    { kind: 'land', label: '降落在 H' },
  ];
}

/** 依序經過角錐：每到一點先停 5 秒，再轉頭朝下一點。 */
function conePath(field: Field, order: string[], firstHeading: number, returnHeading: number): Step[] {
  const steps: Step[] = [];
  let prev = H;
  order.forEach((id, i) => {
    const p = field.cones[id];
    const hd = headingTo(prev, p);
    steps.push({ kind: 'yaw', heading: i === 0 ? firstHeading : hd, label: `機頭轉向 ${id}` });
    steps.push({ kind: 'fly', to: p, heading: 'along', label: `飛到 ${id}` });
    steps.push({ kind: 'hold', seconds: 5, heading: hd, label: `${id} 停 5 秒` });
    prev = p;
  });
  steps.push({ kind: 'yaw', heading: headingTo(prev, H), label: '機頭轉向 H' });
  steps.push({ kind: 'fly', to: H, heading: 'along', label: '飛回 H' });
  steps.push({ kind: 'yaw', heading: returnHeading, label: returnHeading === 0 ? '機頭轉回朝外' : '在 H 轉頭' });
  return steps;
}

export function headingTo(a: Vec2, b: Vec2): number {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function rectSteps(field: Field, cw: string[], ccw: string[]): Step[] {
  const first = conePath(field, cw, 270, 90);
  const second = conePath(field, ccw, 90, 0);
  return [
    { kind: 'takeoff', alt: HOVER_ALT, heading: 0, label: '起飛（機頭朝外）' },
    { kind: 'hold', seconds: 5, heading: 0, label: 'H 上方停 5 秒' },
    ...first,
    ...second,
    { kind: 'hold', seconds: 5, heading: 0, label: '朝外停住' },
  ];
}

function figureEightSteps(): Step[] {
  return [
    { kind: 'takeoff', alt: HOVER_ALT, heading: 0, label: '起飛（機頭朝外）' },
    { kind: 'hold', seconds: 5, heading: 0, label: 'H 上方停 5 秒' },
    { kind: 'fly', to: FIELD_I.cones.P4, heading: 'along', label: '往前飛到 P4' },
    // 左圈逆時針：從圓心東側（P4）起算 0°，經 P1(90°)、P2(180°)、P3(270°) 回 P4
    { kind: 'arc', center: FIELD_I.rings[0].center, radius: 6, startDeg: 0, sweepDeg: 360, label: '左圈逆時針 P1→P2→P3→P4' },
    // 右圈順時針：從圓心西側（P4）起算 180°，經 P5(90°)、P6(0°)、P7(-90°) 回 P4
    { kind: 'arc', center: FIELD_I.rings[1].center, radius: 6, startDeg: 180, sweepDeg: -360, label: '右圈順時針 P5→P6→P7→P4' },
    { kind: 'fly', to: H, heading: 'reverse', label: '倒退飛回 H' },
    { kind: 'hold', seconds: 5, heading: 0, label: '朝外停住' },
  ];
}

function sidewaysSteps(): Step[] {
  const { P3, P7 } = FIELD_I.cones;
  return [
    { kind: 'takeoff', alt: HOVER_ALT, heading: 0, label: '起飛（機頭朝外）' },
    { kind: 'yaw', heading: 270, label: '機頭轉向左' },
    { kind: 'hold', seconds: 5, heading: 270, label: '朝左停 5 秒' },
    { kind: 'fly', to: P3, heading: 270, label: '前進到 P3' },
    { kind: 'hold', seconds: 5, heading: 270, label: 'P3 停 5 秒' },
    { kind: 'fly', to: P7, heading: 270, label: '後退到 P7' },
    { kind: 'hold', seconds: 5, heading: 270, label: 'P7 停 5 秒' },
    { kind: 'fly', to: H, heading: 270, label: '前進回 H' },
    { kind: 'hold', seconds: 5, heading: 270, label: 'H 停 5 秒' },
    { kind: 'yaw', heading: 90, label: '原地轉到機頭朝右' },
    { kind: 'hold', seconds: 5, heading: 90, label: '朝右停 5 秒' },
    { kind: 'fly', to: P7, heading: 90, label: '前進到 P7' },
    { kind: 'hold', seconds: 5, heading: 90, label: 'P7 停 5 秒' },
    { kind: 'fly', to: P3, heading: 90, label: '後退到 P3' },
    { kind: 'hold', seconds: 5, heading: 90, label: 'P3 停 5 秒' },
    { kind: 'fly', to: H, heading: 90, label: '前進回 H' },
    { kind: 'hold', seconds: 5, heading: 90, label: 'H 停 5 秒' },
    { kind: 'yaw', heading: 0, label: '機頭轉回朝外' },
  ];
}

/** 五邊：第 1、5 邊在 P3–H–P7 延長線上，四個彎都往前方轉。預設往左（逆風）飛出。 */
export function fiveLegSteps(alt = 20, halfLen = 40, depth = 20, outward: -1 | 1 = -1): Step[] {
  const a = { x: outward * halfLen, y: 0 };
  const b = { x: outward * halfLen, y: depth };
  const c = { x: -outward * halfLen, y: depth };
  const d = { x: -outward * halfLen, y: 0 };
  return [
    { kind: 'takeoff', alt: HOVER_ALT, heading: 0, label: '起飛（機頭朝外）' },
    { kind: 'hold', seconds: 5, heading: 0, label: 'H 上方停 5 秒' },
    { kind: 'yaw', heading: headingTo(H, a), label: '機頭轉向第 1 邊' },
    { kind: 'climb', alt, label: `爬升到約 ${alt} 公尺` },
    { kind: 'fly', to: a, alt, heading: 'along', label: '第 1 邊' },
    { kind: 'fly', to: b, alt, heading: 'along', label: '第 2 邊' },
    { kind: 'fly', to: c, alt, heading: 'along', label: '第 3 邊' },
    { kind: 'fly', to: d, alt, heading: 'along', label: '第 4 邊' },
    { kind: 'fly', to: H, alt, heading: 'along', label: '第 5 邊回 H' },
    { kind: 'climb', alt: HOVER_ALT, label: '下降到 1–2 公尺' },
    { kind: 'yaw', heading: 0, label: '機頭朝外' },
    { kind: 'hold', seconds: 3, heading: 0, label: '停住' },
  ];
}

export const SUBJECTS: Subject[] = [
  {
    id: 'hover-small', name: '四面停懸（小場地）', licenses: ['I2'], field: 'I2', defaultAirframe: 'quad-800g',
    altBand: [1, 2], steps: hoverSteps(), track: [0.5, 1, 1.5], implemented: true,
    brief: '起飛到 1–2 m，機頭依序朝外、右、內、左、外，每個方向停穩 5 秒，最後降回 H。',
  },
  {
    id: 'rect-small', name: '矩形航線（小場地）', licenses: ['I2'], field: 'I2', defaultAirframe: 'quad-800g',
    altBand: [1, 2], steps: rectSteps(FIELD_I2, ['P1', 'P2', 'P3', 'P4'], ['P4', 'P3', 'P2', 'P1']), track: [0.7, 1.2, 2], implemented: true,
    brief: '沿 P1–P4 的 12×5 m 長方形順、逆時針各一圈，每個角錐停 5 秒，機頭朝前進方向。',
  },
  {
    id: 'hover', name: '四面停懸', licenses: ['I', 'G1', 'G2', 'G3'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [1, 2], steps: hoverSteps(), track: [0.5, 1, 1.5], implemented: true,
    brief: '起飛到 1–2 m，機頭依序朝外、右、內、左、外，每個方向停穩 5 秒，最後降回 H。',
  },
  {
    id: 'figure-eight', name: '8 字水平圓', licenses: ['I', 'G1', 'G2', 'G3'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [1, 2], steps: figureEightSteps(), track: [0.7, 1.2, 2], implemented: true,
    brief: '飛到 P4，左圈逆時針、右圈順時針各一圈，機頭一路朝前進方向，最後倒退回 H。',
  },
  {
    id: 'sideways', name: '側飛前進、後退', licenses: ['I'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [1, 2], steps: sidewaysSteps(), track: [0.7, 1.2, 2], implemented: true,
    brief: '機頭朝側邊，在 P3、P7 之間前進、後退，每到一點停 5 秒；左右各做一次。',
  },
  {
    id: 'five-leg', name: '五邊飛行', licenses: ['I'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [18, 22], steps: fiveLegSteps(), track: [2, 4, 6], implemented: true,
    brief: '約 20 m 高繞 80×20 m 長方形，第 1、5 邊在 P3–H–P7 延長線上，四個彎都往前方轉。',
  },
  {
    id: 'return', name: '緊急返航', licenses: ['I'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [18, 22],
    steps: [...fiveLegSteps().slice(0, 7), { kind: 'emergency-return', label: '聽到「緊急返航」：停住後飛回較近的八字內圈降落' }],
    track: [2, 4, 6], implemented: true,
    brief: '飛五邊途中隨時會喊「緊急返航」：立刻停住，再以平緩角度飛回較近的八字內圈降落。',
  },
  {
    id: 'rect', name: '矩形航線', licenses: ['G1', 'G2', 'G3'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [1, 2], steps: rectSteps(FIELD_I, ['P3', 'P1', 'P5', 'P7'], ['P7', 'P5', 'P1', 'P3']), track: [0.7, 1.2, 2], implemented: true,
    brief: '沿 P3、P1、P5、P7 的 12×12 m 正方形順、逆時針各一圈，每個角錐停 5 秒。',
  },
  {
    id: 'fpv-points', name: '看畫面飛', licenses: ['G1'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [1, 2], steps: [], track: [0.7, 1.2, 2], implemented: false,
    brief: '背對場地只看鏡頭畫面，依 P3、P1、P5、P7 順序飛並各停 5 秒。（本版尚未實作）',
  },
  {
    id: 'poi', name: '看畫面繞著目標飛', licenses: ['G3'], field: 'I', defaultAirframe: 'quad-4kg',
    altBand: [3, 5], steps: [], track: [0.7, 1.2, 2], implemented: false,
    brief: '只看畫面繞 A、B 點順、逆時針各一圈並保持目標在畫面中央。（本版尚未實作）',
  },
];

export function fieldOf(kind: FieldKind): Field {
  return kind === 'I2' ? FIELD_I2 : FIELD_I;
}

export function subjectById(id: string): Subject | undefined {
  return SUBJECTS.find((s) => s.id === id);
}
