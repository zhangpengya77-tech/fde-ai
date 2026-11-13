/**
 * J6 teaching-only templates. Dimensions are configurable visual/training
 * references; they are not an official certification-field declaration.
 */
import { FIELD_I, FIELD_I2, type Field, type FieldKind, type Vec2 } from './courses';

export type TrainingTaskId = 'takeoff-land' | 'hover' | 'translate' | 'orientation' | 'circle' | 'waypoints' | 'emergency';

export interface ExamFieldTemplate extends Field {
  classification: 'TRAINING_TEMPLATE';
  safetyBoundary: Field['bounds'];
  runway: { surface: 'asphalt'; widthM: number; lengthM: number };
  teacherZone: { center: Vec2; widthM: number; depthM: number };
  referenceWaypoints: Record<string, Vec2>;
}

export interface TrainingTemplate {
  id: TrainingTaskId;
  name: string;
  classification: 'TRAINING_TEMPLATE';
  field: FieldKind;
  start: Vec2;
  targetPoints: Vec2[];
  toleranceM: number;
  timeLimitS: number;
  safetyBoundary: Field['bounds'];
  completion: string[];
  failure: string[];
  teacherReview: string;
}

function template(field: Field, referenceWaypoints: Record<string, Vec2>): ExamFieldTemplate {
  const width = field.bounds.xMax - field.bounds.xMin;
  const depth = field.bounds.yMax - field.bounds.yMin;
  return {
    ...field,
    classification: 'TRAINING_TEMPLATE',
    safetyBoundary: { ...field.bounds },
    runway: { surface: 'asphalt', widthM: width + 8, lengthM: depth + 8 },
    teacherZone: { center: { x: 0, y: field.examinee.y - 1.5 }, widthM: 5, depthM: 2 },
    referenceWaypoints,
  };
}

export const EXAM_FIELD_TEMPLATES: Record<FieldKind, ExamFieldTemplate> = {
  I: template(FIELD_I, { H: { x: 0, y: 0 }, ...FIELD_I.cones }),
  I2: template(FIELD_I2, { H: { x: 0, y: 0 }, ...FIELD_I2.cones }),
};

const I = EXAM_FIELD_TEMPLATES.I;
const H = { x: 0, y: 0 };
const point = (id: string): Vec2 => I.referenceWaypoints[id];

export const TRAINING_TEMPLATES: readonly TrainingTemplate[] = [
  { id: 'takeoff-land', name: '起飛與安全降落', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [H], toleranceM: 1, timeLimitS: 90, safetyBoundary: I.safetyBoundary, completion: ['安全起飛', '回到起降區', '平穩降落'], failure: ['越出安全邊界', '不安全觸地'], teacherReview: '教師確認起飛高度、落點與安全程序。' },
  { id: 'hover', name: '定點懸停', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [H], toleranceM: 1, timeLimitS: 75, safetyBoundary: I.safetyBoundary, completion: ['在 H 上方維持指定高度', '姿態穩定'], failure: ['漂移超出教學容許區', '越出安全邊界'], teacherReview: '教師覆核高度、航向與停懸時間。' },
  { id: 'translate', name: '前後左右平移', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [point('P3'), point('P7'), H], toleranceM: 1.5, timeLimitS: 120, safetyBoundary: I.safetyBoundary, completion: ['依序抵達參考點', '返回 H'], failure: ['漏過參考點', '越出安全邊界'], teacherReview: '教師覆核移動方向、速度與停留品質。' },
  { id: 'orientation', name: '定向飛行', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [H], toleranceM: 1, timeLimitS: 90, safetyBoundary: I.safetyBoundary, completion: ['依教學口令完成四向定點'], failure: ['超出安全邊界', '不安全觸地'], teacherReview: '教師覆核四個航向與控制程序。' },
  { id: 'circle', name: '圓形航線練習', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [point('P4'), point('P1'), point('P2'), point('P3'), point('P4')], toleranceM: 2, timeLimitS: 150, safetyBoundary: I.safetyBoundary, completion: ['完成一個教學圓形軌跡', '返回 H'], failure: ['軌跡離開教學環帶', '越出安全邊界'], teacherReview: '教師覆核旋轉方向、航向及軌跡連續性。' },
  { id: 'waypoints', name: '指定航點飛行', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [point('P3'), point('P1'), point('P5'), point('P7'), H], toleranceM: 1.5, timeLimitS: 180, safetyBoundary: I.safetyBoundary, completion: ['依序抵達所有航點', '返回起降區'], failure: ['航點順序錯誤', '越出安全邊界'], teacherReview: '教師覆核航點順序、偏差與任務時間。' },
  { id: 'emergency', name: '緊急處置模擬', classification: 'TRAINING_TEMPLATE', field: 'I', start: H, targetPoints: [point('P4'), H], toleranceM: 2, timeLimitS: 120, safetyBoundary: I.safetyBoundary, completion: ['收到口令後停止前進', '依教學程序回到安全區'], failure: ['越出安全邊界', '不安全觸地'], teacherReview: '教師覆核口令反應與安全處置；不是官方考試判定。' },
];

export function getTrainingTemplate(id: string): TrainingTemplate | undefined {
  return TRAINING_TEMPLATES.find((task) => task.id === id);
}

export function validateTrainingTemplate(task: TrainingTemplate): string[] {
  const errors: string[] = [];
  if (!task.targetPoints.length) errors.push('至少需要一個目標點');
  if (!task.completion.length) errors.push('至少需要一項完成條件');
  if (!task.failure.length) errors.push('至少需要一項失敗條件');
  if (task.toleranceM <= 0 || task.timeLimitS <= 0) errors.push('容許誤差與時間必須為正數');
  const b = task.safetyBoundary;
  if (!(b.xMin < b.xMax && b.yMin < b.yMax)) errors.push('安全邊界無效');
  return errors;
}
