/**
 * FDE 電力巡檢模擬器 · 繁體中文（台灣）語言檔 (zh-Hant)
 *
 * 所有可見 UI 文字集中於此，避免散落硬編碼。
 * 專有名詞保留：FDE / CH1 / Pitch / Yaw / Zoom / RGB / Mock AI / P1-6。
 */

export const zhHant = {
  // 頂部列
  brandTitle: 'FDE 無人機電力巡檢數位孿生訓練系統',
  brandSub: '輸電線路巡檢 · 教學模式',
  localEnv: '本地訓練環境',

  // 任務面板
  currentTask: '當前任務',
  missionTitle: '輸電塔絕緣子巡檢',
  missionTarget: '巡檢目標',
  targetPending: '待裝載',
  currentStep: '當前步驟',
  stepPending: '待開始',
  missionProgress: '任務進度',
  dash: '—',
  distTarget: '距目標',
  distObstacle: '距障礙',
  gimbalPitchYaw: '雲台 Pitch / Yaw',
  safetyState: '安全狀態',
  safe: '安全',
  inspectionZone: '巡檢區',
  zoneOut: '區外',
  missionHint: '請解鎖並起飛，飛向輸電塔右側絕緣子串。',
  phaseTag: 'P1-6',
  phaseDesc: '巡檢任務閉環 · 教學評分',

  // 場景工具列
  sceneLabel: '場景',
  sceneName: '輸電線路 · 巡檢環境',
  axisX: 'X',
  axisY: 'Y',
  axisZ: 'Z',
  scale10m: '10 m',
  fullscreen: '全螢幕',

  // 雲台面板
  gimbalView: '雲台畫面',
  rgbCamera: 'RGB 相機',
  cameraStandby: '相機待機',
  yawLabel: 'Yaw',
  pitchLabel: 'Pitch',
  zoomLabel: 'Zoom',
  gimbalKeys: '雲台按鍵：I/K 俯仰 · J/L 偏航 · C 回中',

  // 飛行狀態
  flightStatus: '飛行狀態',
  altitude: '高度',
  speed: '速度',
  heading: '航向',
  mode: '模式',
  standby: '待機',

  // 巡檢清單
  checklist: '巡檢清單',
  targetLocate: '目標定位',
  safeDistance: '安全距離',
  inspectEvidence: '巡檢取證',
  photo: '照片',
  notShot: '未拍攝',
  mockAI: 'Mock AI（模擬）',
  notDetected: '未檢測',
  missionStatus: '任務狀態',
  viewScore: '查看教學評分',

  // 操作區
  arm: '解鎖',
  takeoff: '起飛',
  hover: '懸停',
  capturePhoto: '拍攝巡檢照片',
  rtl: '返航',
  land: '降落',
  missionRecord: '任務記錄',
  flightController: '飛行控制器',
  inputSource: '輸入源',
  keyboard: '鍵盤',

  // 評分 / 報告
  teachingScore: '教學評分',
  gotIt: '知道了',
  recordTitle: '任務記錄',
  studentRecord: '學員任務記錄',
  close: '關閉',
  studentView: '學員視角',
  teacherView: '教師查看',
  teacherNote: '教師查看模式為唯讀，用於覆核學員提交的任務報告；本機未實作多使用者隔離。',
  teachingSuggestions: '教學建議',

  // 飛行模式文字
  modeFlying: '飛行中',
  modeHover: '懸停',
  modeIdle: '未解鎖',

  // 狀態標籤
  statusLabel: {
    completed: '完成',
    failed: '失敗',
    incomplete: '未完成',
  } as Record<string, string>,

  // 任務狀態文字
  missionStateText: {
    IDLE: '待開始',
    READY: '準備',
    TAKEOFF: '起飛',
    FLY_TO_TARGET: '前往巡檢點',
    POSITION_FOR_INSPECTION: '進入巡檢位置',
    AIM_CAMERA: '調整雲台',
    CAPTURE: '拍攝',
    VALIDATE_PHOTO: '照片檢查',
    AI_INSPECTION: 'AI 缺陷檢查',
    INSPECTION_COMPLETE: '巡檢完成',
    RETURN: '返航',
    LAND: '降落',
    COMPLETE: '完成',
    FAILED: '失敗',
  } as Record<string, string>,

  // 評分六維
  scoreDimensions: {
    missionCompletion: '任務完成',
    flightSafety: '飛行安全',
    inspectionPosition: '巡檢位置',
    photoQuality: '照片品質',
    flightEfficiency: '飛行效率',
    controlStability: '操縱穩定性',
  } as Record<string, string>,

  // 標定面板
  calRemote: '遙控器',
  calTitle: 'USB 控制器標定',
  calUndetected: '未檢測到外部遙控器',
  calRealtime: '即時通道（原始值 / 對應功能 / 歸一化值）',
  calChannel: '通道',
  calType: '類型',
  calBipolar: '雙向',
  calUnipolar: '單向',
  calReverse: '反向',
  calDeadzone: '死區',
  calExpo: '指數',
  calCaptureMin: '捕獲最小',
  calCaptureCenter: '捕獲中位',
  calCaptureMax: '捕獲最大',
  calSave: '保存標定',
  calExport: '匯出',
  calImport: '匯入',
  calMeasure: '下載測量記錄',
  calExpand: '放大面板',
  calCollapse: '縮小面板',
  calHint: '首次使用遙控器請先逐項捕獲 最小 / 中位 / 最大，再保存。無遙控器時系統使用鍵盤教學。',

  // 目前生效標定（真機除錯：載入的到底是哪一份）
  calActiveTitle: '目前生效標定',
  calActiveFile: '檔案',
  calActiveSaved: '儲存時間',
  calActiveOrigin: '來源',
  calActiveDevice: '裝置 ID',
  calActiveClear: '清除本機標定並重新載入',

  // 引導式標定（以實測為準）
  calGuidedTitle: '引導式標定（以實測為準，建議先用這個）',
  calGuidedIdleStep: '第 1 / 4 步',
  calGuidedIdlePrompt: '先把所有搖桿回中，按「開始這步」，再只撥動指定的搖桿。',
  calGuidedIdleHint: '每一步只動一根搖桿到指定極限位置並保持，系統會記錄真正變化的軸與方向。',
  calGuidedStepLabel: (step: number, total: number) => `第 ${step} / ${total} 步`,
  calGuidedStepPrompt: (stick: string, direction: string, expected: string) =>
    `只把「${stick}」緩緩推到「${direction}」並保持（${expected}）。`,
  calGuidedArmed: '偵測中：請只撥動這一根搖桿到指定位置，放開後按「確認」。',
  calGuidedConfirmHint: '已鎖定軸與方向，確認數值是否與上面動作一致；不一致按「重做這步」。',
  calGuidedErrorHint: '這一步偵測到重複的軸，請換一根搖桿重做。',
  calGuidedDoneStep: '四個功能已全部實測完成',
  calGuidedDonePrompt: '按「儲存並套用」立即生效（無需重新整理頁面）。',
  calGuidedStart: '開始這步',
  calGuidedConfirm: '確認',
  calGuidedRetry: '重做這步',
  calGuidedSave: '儲存並套用',
  calGuidedReset: '全部重來',
  calGuidedApplied: '已套用引導標定並即時生效（無需重新整理）。',

  // 原始軸連續錄製（診斷，與操作品質無關）
  calRecordTitle: '原始軸連續錄製（10 秒）',
  calRecordHint: '不依賴單次動作品質：錄製期間每幀記錄 axis0~axis7 原始值，自動算出各軸最小 / 最大 / 平均 / 起始 / 結束與變化量排序。',
  calRecordStart: '錄製 10 秒',
  calRecordExport: '匯出錄製 JSON',
  calRecordApply: '套用建議（只改不一致的通道）',
  calRecordSuggestionTitle: '錄製建議（依畫圈段落分析，尚未寫入）',

  // 漂移診斷
  calDriftTitle: '漂移診斷（靜止時）',
  calDriftHint: '檢查靜止時各功能原始值是否偏離預期中位、歸一化是否為 0（死區是否生效）。',
  calDriftReset: '重設位置',
  calDriftCenter: '校正中心（只更新 center）',

  // 方向驗收
  calAcceptTitle: '方向驗收（右桿 pitch / roll）',
  calAcceptHint: '三項都要綠燈：前推 Pitch 為正且機身前進、右打 Roll 為正且機身右移、放開後機體停止。需先在飛行狀態（解鎖並起飛）。',

  // CAA 專業基本級術科考場模擬（考試機獨立疊加）
  exam: {
    title: 'CAA 專業基本級術科考場模擬（練習）',
    disclaimer: '非官方測驗，僅供練習；所有 S/U/N 為模擬判定，非官方測驗結果。',
    topDisclaimer: '非官方測驗 · 僅供練習',
    modes: {
      manual: '手動',
      attitude: '姿態',
      position: '定位',
    },
    subjects: {
      B: '定點起降及四面停懸',
      C: '8字水平圓',
    },
    panel: {
      title: '考試即時面板',
      mode: '模式',
      guidance: '引導',
      exam: '考試中',
      practice: '練習',
      wind: '風',
      safety: '安全宣告',
    },
    majorFailure: {
      outOfOperationArea: '失控／離開操作區',
      hitCone: '撞擊角錐',
      crash: '墜落',
      beyondExamineeRear: '超越應考人後方',
      examinerIntervene: '需監評從旁協助',
      disorder: '未遵守秩序／規定',
      identityFraud: '身分不符／舞弊',
    },
    report: {
      title: '術科測驗報告表（仿附錄5）',
      simulatedPass: '本模擬評判：通過',
      simulatedFail: '本模擬評判：不通過',
      majorFailureSection: '重大違失',
      ratingS: 'S 操作程序均正確無誤',
      ratingU: 'U 判定為不合格',
      ratingN: 'N 未執行',
      note: '備註',
      replay: '航跡回放',
      finish: '產生成績單',
      restart: '重新測驗',
      itemSimulated: '（本模擬自動判定）',
      itemNotCovered: '（本模擬未涵蓋）',
      officialStandard: '官方通過標準',
    },
    controlsHint: 'W/A/S/D 俯仰與橫滾 · Q/E 偏航 · Shift/Ctrl 油門升降 · 1/2/3 切換模式 · T 起飛 · L 降落 · Enter 產生成績單 · R 重新測驗',
    takeoffKey: '起飛 (T)',
    landKey: '降落 (L)',
    finishKey: '產生成績單 (Enter)',
    restartKey: '重新測驗 (R)',
  },
} as const;

export type ZhHant = typeof zhHant;
