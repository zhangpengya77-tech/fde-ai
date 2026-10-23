/**
 * 考試模式啟動流程與視角的純函式（不依賴 DOM/Three.js，可單元測試）。
 *
 * 步驟條（任務三）：①選科目 → ②起飛(T) → ③執行 → ④降落(L) → ⑤成績單(Enter)。
 * 「目前步驟」取使用者當下應做的事：
 *   - 未選科目            → ①（提示：請先選科目）
 *   - 已選科目、尚未起飛  → ②（提示：按 T 起飛）
 *   - 飛行中              → ③（提示：執行科目動作，完成後按 L 降落）
 *   - 已降落              → ⑤（提示：按 Enter 看成績單，或選下一科）
 *   - 成績單開啟中        → ⑤
 * ④降落(L) 為飛行中之後的下一步，由③的提示文字帶出（「完成後按 L 降落」）。
 */

/** 流程步驟鍵（對應 i18n exam.steps）。 */
export type ExamFlowStep = 'select' | 'takeoff' | 'execute' | 'land' | 'report';

/** 飛行狀態（依飛控 ExamState 推導）。 */
export type ExamFlightStatus = 'grounded' | 'flying' | 'landed';

export interface ExamFlowInput {
  /** 是否已選應考科目（session.getCurrentSubject() 非 null）。 */
  subjectSelected: boolean;
  flightStatus: ExamFlightStatus;
  /** 成績單面板是否開啟。 */
  reportOpen: boolean;
}

/** 推導「目前步驟」（步驟條高亮用）。 */
export function deriveExamStep(input: ExamFlowInput): ExamFlowStep {
  if (input.reportOpen) return 'report';
  if (!input.subjectSelected) return 'select';
  if (input.flightStatus === 'flying') return 'execute';
  if (input.flightStatus === 'landed') return 'report';
  return 'takeoff';
}

/** 下一步提示的 i18n 鍵（exam.hints.*）。 */
export function nextHintKey(input: ExamFlowInput): string {
  const step = deriveExamStep(input);
  switch (step) {
    case 'select':
      return 'selectSubjectFirst';
    case 'takeoff':
      return 'pressTakeoff';
    case 'execute':
      return 'executing';
    case 'report':
      return input.reportOpen ? 'reportOpen' : 'afterSubjectDone';
    default:
      return 'pressTakeoff';
  }
}

/** 由飛控狀態推導飛行狀態。 */
export function deriveFlightStatus(
  state: 'idle' | 'armed' | 'flying' | 'landed',
  positionY: number,
): ExamFlightStatus {
  if (state === 'flying' || positionY > 0.15) return 'flying';
  if (state === 'landed') return 'landed';
  return 'grounded';
}

/** 飛行狀態的細分顯示（起飛中／降落中由飛控程序旗標判定）。 */
export type ExamStatusLabel = 'grounded' | 'takingOff' | 'flying' | 'landing' | 'landed';

export function deriveStatusLabel(
  flightStatus: ExamFlightStatus,
  takingOff: boolean,
  landing: boolean,
): ExamStatusLabel {
  if (flightStatus === 'grounded') return 'grounded';
  if (flightStatus === 'landed') return 'landed';
  if (takingOff) return 'takingOff';
  if (landing) return 'landing';
  return 'flying';
}

/** 控制列按鈕可用性（依驗收狀態表）。 */
export interface ExamControlAvailability {
  takeoff: boolean;
  hover: boolean;
  land: boolean;
}

/**
 * 按鈕可用性：
 *  - 地面待命／已落地 → 起飛可用（科目前置條件由呼叫端另外把關），懸停／降落停用；
 *  - 起飛中 → 起飛停用、懸停停用、降落可用（中止起飛）；
 *  - 飛行／懸停 → 懸停、降落可用；
 *  - 降落中 → 全部停用。
 */
export function deriveControlAvailability(
  flightStatus: ExamFlightStatus,
  takingOff: boolean,
  landing: boolean,
): ExamControlAvailability {
  const flying = flightStatus === 'flying';
  return {
    takeoff: flightStatus === 'grounded' || flightStatus === 'landed',
    hover: flying && !takingOff && !landing,
    land: flying && !landing,
  };
}

/** V 鍵視角循環：考生視角 → 追隨視角 → 俯視全景 → 考生視角。 */
export type ExamCameraView = 'examinee' | 'follow' | 'overview';

const CAMERA_VIEW_CYCLE: readonly ExamCameraView[] = ['examinee', 'follow', 'overview'];

export function cycleCameraView(current: ExamCameraView): ExamCameraView {
  const i = CAMERA_VIEW_CYCLE.indexOf(current);
  return CAMERA_VIEW_CYCLE[(i + 1) % CAMERA_VIEW_CYCLE.length];
}
