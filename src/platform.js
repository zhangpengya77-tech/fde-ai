export const modules = [
  {
    key: 'learn',
    label: '學',
    title: '知識學習',
    summary: '掌握 F450、Pixhawk、Mission Planner、安全規則與四面懸停標準。',
    items: ['F450 機架與動力系統', 'Pixhawk 2.4.8 飛控基礎', 'Mission Planner 校準流程', '姿態模式與考照標準']
  },
  {
    key: 'practice',
    label: '練',
    title: '訓練練習',
    summary: '用模擬器與任務清單建立起飛、定點、轉向與降落的基本動作。',
    items: ['定點懸停', '四面轉向', '八字飛行', '學科題庫練習']
  },
  {
    key: 'build',
    label: '做',
    title: 'F450 組裝',
    summary: '依照十階段 SOP 完成機架、電機、ESC、飛控、GPS、電源與飛行模式設定。',
    items: ['組裝 SOP', '安全檢查', 'Mission Planner 設定', '拆槳馬達測試']
  },
  {
    key: 'assess',
    label: '測',
    title: 'AI 評測',
    summary: '上傳裝機照片與四面懸停影片，取得模擬 AI 診斷與評分。',
    items: ['F450 照片檢查', '四面懸停影片評分', '扣分原因', '訓練建議']
  },
  {
    key: 'certify',
    label: '證',
    title: '能力證明',
    summary: '整理學習紀錄、裝機證據、飛行影片、AI 評分與專案報告。',
    items: ['成績紀錄', 'GitHub 專案', '學習檔案', '證明報告']
  }
];

export const buildStages = [
  { title: '零件檢查', status: 'PASS', detail: '確認機架、機臂、電機、ESC、Pixhawk、電池、GPS 與接收機齊全。' },
  { title: '機架組裝', status: 'PASS', detail: '紅色機臂朝前，白色機臂朝後，上下板方向正確。' },
  { title: '電機安裝', status: 'PASS', detail: '四顆電機固定於機臂末端，螺絲長度不頂線圈。' },
  { title: 'ESC 與焊接', status: 'NEEDS_RECHECK', detail: '檢查紅黑動力線極性、焊點與裸線風險。' },
  { title: 'Pixhawk 安裝', status: 'NEEDS_RECHECK', detail: 'Pixhawk 箭頭必須朝向機頭，並使用減震固定。' },
  { title: 'GPS/接收機安裝', status: 'PENDING', detail: 'GPS 固定牢靠，線纜不繞槳，接收機連接無鬆脫。' },
  { title: '電源接線', status: 'PENDING', detail: '檢查 Power Module、ESC 信號線、GPS 與接收機插頭。' },
  { title: 'Mission Planner 校準', status: 'PENDING', detail: '完成固件、加速度計、羅盤、遙控器校準，無 PreArm 錯誤。' },
  { title: '馬達測試', status: 'PENDING', detail: '拆槳狀態下確認四顆電機編號與旋轉方向。' },
  { title: '飛行模式設定', status: 'PENDING', detail: '至少設定 Stabilize、AltHold、Loiter、RTL 並完成切換測試。' }
];

export const certificationItems = [
  'F450 組裝照片與階段紀錄',
  'Mission Planner 校準截圖',
  '四面懸停原始影片',
  'AI 評分結果與扣分原因',
  '訓練反思與改進紀錄',
  'GitHub 專案或 PDF 報告'
];

export function calculateProgress(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const percentage = Math.round((completed / total) * 100);
  return Math.min(100, Math.max(0, percentage));
}

export function simulatePhotoAssessment(fileName = 'uploaded-photo.jpg') {
  return {
    type: 'photo',
    fileName,
    status: 'NEEDS_RECHECK',
    summary: '照片已完成模擬檢查：Pixhawk 方向與 ESC 焊點需要重新確認。',
    findings: [
      { label: 'Pixhawk 方向', result: 'NEEDS_RECHECK', detail: '箭頭區域不夠清楚，請補拍頂視角照片。' },
      { label: 'ESC 與焊點', result: 'NEEDS_RECHECK', detail: '動力線極性需要更近距離照片確認。' },
      { label: '機架方向', result: 'PASS', detail: '紅色機臂朝前、白色機臂朝後，方向符合 SOP。' }
    ],
    nextStep: '請補拍頂部飛控與 ESC 焊點近照，之後可接入 YOLOv8 做真實檢測。'
  };
}

export function simulateHoverAssessment(fileName = 'uploaded-hover.mp4') {
  return {
    type: 'video',
    fileName,
    status: 'PASS',
    totalScore: 86,
    scores: {
      horizontalStability: 34,
      verticalStability: 18,
      sideCompletion: 25,
      continuity: 9
    },
    summary: '四面懸停流程完整，第三面出現向右漂移，連續穩定性仍需加強。',
    recommendation: '第三面懸停時練習細微 roll 橫滾修正，保持機體回到 H 點中心。'
  };
}
