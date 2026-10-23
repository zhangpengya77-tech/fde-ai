/**
 * 飛行前／後 360 度檢查資料（科目 A p161／科目 G p167，檢查表範例＝附件3 p212）。
 *
 * 官方（附件3，2 公斤以上無人多旋翼機飛行前/後 360 度檢查表範例）：
 *   壹 動力系統：1 螺旋槳（目視外觀無裂損）2 馬達（固裝＋外觀）3 方向性檢查
 *      （馬達及螺旋槳正/反槳安裝正確）
 *   貳 載具：1 電池或油箱 2 機臂 3 機身及酬載 4 飛控電腦 5 GNSS 模組
 *      6 點火系統或電系接頭 7 全系統動態檢查（含手持操控器）
 *   每項分「飛行前／飛行後」兩欄（是／否＋備註）。
 *
 * 科目 A（p161）另含：系統知識 9 項、手持操控器搖桿及開關功能檢查。
 * 科目 G（p167）僅：依檢查表逆時針繞行實施飛行後 360 度檢查。
 *
 * 「逆時針方向繞行」以機頭朝向為 12 點鐘方向：機頭 → 左側 → 機尾 → 右側
 * （自上空俯視之逆時針）。本模組只放官方範例資料與航站定義，判定邏輯在
 * subject-ag.ts。
 */

/** 附件3 檢查項（10 項；id 穩定，供記錄與判定參照）。 */
export interface ChecklistItem {
  id: string;
  group: 'power' | 'airframe';
  /** 附件3 原文。 */
  label: string;
}

export const CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: 'propeller', group: 'power', label: '螺旋槳：目視外觀無裂損' },
  { id: 'motor', group: 'power', label: '馬達：確認已固裝妥當及目視外觀無裂損' },
  { id: 'rotation', group: 'power', label: '方向性檢查：確認馬達及螺旋槳正/反槳安裝正確' },
  { id: 'battery', group: 'airframe', label: '電池或油箱：檢查外觀、工作電壓、油量，及確認已固裝妥當' },
  { id: 'arm', group: 'airframe', label: '機臂：外觀確認已固裝妥當' },
  { id: 'fuselage', group: 'airframe', label: '機身及酬載（如適用）：外觀確認已固裝妥當' },
  { id: 'flightController', group: 'airframe', label: '飛控電腦：外觀確認已固裝妥當' },
  { id: 'gnss', group: 'airframe', label: 'GNSS 模組：外觀確認已固裝妥當' },
  { id: 'ignition', group: 'airframe', label: '點火系統或電系接頭：外觀確認已固裝妥當' },
  { id: 'fullSystem', group: 'airframe', label: '全系統動態檢查（包含手持操控器，並視機型調整通、斷電程序）' },
];

export const CHECKLIST_GROUPS: Array<{ id: ChecklistItem['group']; label: string }> = [
  { id: 'power', label: '壹 動力系統' },
  { id: 'airframe', label: '貳 載具' },
];

/** 繞行航站（以機頭朝向為 12 點鐘）。 */
export type StationId = 'nose' | 'left' | 'tail' | 'right';

export interface StationDef {
  id: StationId;
  label: string;
  /** 相對機體位置（世界座標近似：機頭朝 −Z）。 */
  offset: { x: number; z: number };
}

/** 官方逆時針順序：機頭(12) → 左側(9) → 機尾(6) → 右側(3)。 */
export const STATIONS_CCW: StationId[] = ['nose', 'left', 'tail', 'right'];

export const STATIONS: Record<StationId, StationDef> = {
  nose: { id: 'nose', label: '機頭前方', offset: { x: 0, z: -1.5 } },
  left: { id: 'left', label: '左側', offset: { x: -1.5, z: 0 } },
  tail: { id: 'tail', label: '機尾後方', offset: { x: 0, z: 1.5 } },
  right: { id: 'right', label: '右側', offset: { x: 1.5, z: 0 } },
};

/** 科目 A 系統知識 9 項（p161 準則第 1 條）。 */
export const SYSTEM_KNOWLEDGE_ITEMS: Array<{ id: string; label: string }> = [
  { id: 'aircraftType', label: '載具類型/型式' },
  { id: 'mtow', label: '最大起飛總重' },
  { id: 'payload', label: '酬載重量' },
  { id: 'cg', label: '重心位置' },
  { id: 'propSpec', label: '螺旋槳或旋翼規格' },
  { id: 'powerSpec', label: '動力規格（馬達或引擎規格）' },
  { id: 'batterySpec', label: '電池或燃料規格' },
  { id: 'rcSpec', label: '遙控設備與頻率' },
  { id: 'endurance', label: '滯空時間' },
];

/** 科目 A 手持操控器檢查（p161 準則第 2 條：各搖桿及開關功能是否正確）。 */
export const CONTROLLER_CHECK_ITEMS: Array<{ id: string; label: string }> = [
  { id: 'pitchStick', label: '俯仰搖桿功能' },
  { id: 'rollStick', label: '橫滾搖桿功能' },
  { id: 'yawStick', label: '偏航搖桿功能' },
  { id: 'throttleStick', label: '油門搖桿功能' },
  { id: 'modeSwitch', label: '模式開關功能' },
  { id: 'armSwitch', label: '解鎖／上鎖開關功能' },
];
