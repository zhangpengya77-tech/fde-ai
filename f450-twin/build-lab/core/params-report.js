// 組裝實訓室｜ArduPilot 參數「模擬設定報告」
//
// 第一版只產生報告給學員對照，**不寫入任何真實飛控**、不連 Mission Planner／HyperQGC。
// 參數名稱與數值依 ArduPilot 原始碼 Copter-4.6.3 的參數說明（@Param／@Values）核對，取得日 2026-11-19；
// 4.6 起 GPS_TYPE 改名 GPS1_TYPE。實際使用的韌體版本待教師確認，所有項目標 PENDING_MANUAL。

const SRC = (file) => ({
  status: 'PENDING_MANUAL',
  title: `ArduPilot Copter-4.6.3：${file}`,
  url: `https://github.com/ArduPilot/ardupilot/blob/Copter-4.6.3/${file}`,
  date: '2026-11-19',
});

/**
 * 依接線結果產生參數建議。
 * @param {{ connections: string[], fcRotY?: number }} state  已完成的接線步驟 id、飛控安裝角度
 */
export function buildParamsReport(state) {
  const has = (id) => state.connections.includes(id);
  const rows = [
    { name: 'FRAME_CLASS', value: 1, meaningZh: '機架大類：1 = Quad（四旋翼）', why: 'F450 是四旋翼。', source: SRC('ArduCopter/Parameters.cpp') },
    { name: 'FRAME_TYPE', value: 1, meaningZh: '機架型式：1 = X', why: '機臂呈 X 形，馬達編號依 Quad X。', source: SRC('ArduCopter/Parameters.cpp') },
    { name: 'MOT_PWM_TYPE', value: 0, meaningZh: '馬達輸出：0 = Normal（一般 PWM）', why: '通用 20A 電調使用一般 PWM（實際電調若支援 DShot 可再調整，待確認）。', source: SRC('libraries/AP_Motors/AP_MotorsMulticopter.cpp') },
    { name: 'BATT_MONITOR', value: has('pm-fc') ? 4 : 0, meaningZh: '電池監測：4 = 類比電壓與電流', why: has('pm-fc') ? '電源模組 6P 已接 POWER 口，可量電壓電流。' : '電源模組未接飛控，無法監測（請先完成接線）。', source: SRC('libraries/AP_BattMonitor/AP_BattMonitor_Params.cpp') },
    { name: 'GPS1_TYPE', value: has('gps-uart') ? 1 : 0, meaningZh: 'GPS 型別：1 = AUTO（自動偵測）；4.5 以前名稱為 GPS_TYPE', why: has('gps-uart') ? 'GPS 已接 GPS 口。' : 'GPS 未接。', source: SRC('libraries/AP_GPS/AP_GPS.cpp') },
    { name: 'SERIAL1_PROTOCOL', value: 2, meaningZh: 'TELEM1 協定：2 = MAVLink2（預設值）', why: has('telem') ? '數傳接在 TELEM1。' : '數傳未接，維持預設。', source: SRC('libraries/AP_SerialManager/AP_SerialManager.cpp') },
    { name: 'BRD_SAFETY_DEFLT', value: has('switch') ? 1 : 0, meaningZh: '開機時安全開關狀態：1 = 啟用（開機為安全狀態）', why: has('switch') ? '已接安全開關，保持啟用。' : '未接安全開關（不建議）。', source: SRC('libraries/AP_BoardConfig/AP_BoardConfig.cpp') },
    { name: 'AHRS_ORIENTATION', value: 0, meaningZh: '飛控安裝方向：0 = None（箭頭朝機頭）', why: '本實訓飛控箭頭朝機頭安裝。', source: SRC('libraries/AP_AHRS/AP_AHRS.cpp') },
  ];
  const checklist = [
    '加速度計校準（水平、左右側、機頭上下、倒置）',
    '羅盤校準（遠離金屬與電源線）',
    '遙控器校準（各通道最大最小值、飛行模式開關）',
    '電調油門行程校準（依電調說明書，**全程拆槳**）',
    '馬達測試：依 A→B→C→D 確認轉向與順序（**拆槳**，在地面站 Motor Test 頁執行）',
    '失控保護（FS_THR_ENABLE 等）設定與測試（拆槳）',
  ];
  return { rows, checklist, firmwareNote: '依 ArduPilot Copter 4.6.x 參數名稱；實際韌體版本待確認。', writesToVehicle: false };
}

/** 報告轉成純文字（下載用）；檔頭清楚標示「模擬，不可直接寫入」 */
export function reportToText(report, meta = {}) {
  const lines = [
    '# FDE-AI 組裝實訓室｜ArduPilot 參數模擬設定報告',
    '# 這是模擬報告，不是參數檔，不可直接寫入真實飛控；所有數值須經教師覆核（PENDING_MANUAL）。',
    `# ${report.firmwareNote}`,
    `# 產生時間：${new Date().toISOString()}  版本：${meta.version || ''}`,
    '',
    ...report.rows.map((r) => `${r.name} = ${r.value}    # ${r.meaningZh}｜${r.why}｜來源：${r.source.title}`),
    '',
    '# 上線前檢查清單：',
    ...report.checklist.map((c, i) => `# ${i + 1}. ${c.replace(/\*\*/g, '')}`),
  ];
  return lines.join('\n');
}
