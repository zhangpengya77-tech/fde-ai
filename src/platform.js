export const hero = {
  name: 'fde-ai',
  headline: '學、練、做、測、證一體化無人機 AI 教學平台',
  summary:
    '以 AI 輔助教學為核心，串接學習影片、模擬訓練、實物組裝、YOLOv8 檢測與 GitHub 成果存證。',
  status: 'v1.1 frontend prototype'
};

export const moduleSections = [
  {
    key: 'home',
    label: '首頁',
    title: '平台總覽',
    summary: '透明藍色無人機啟動畫面與整體平台介紹。'
  },
  {
    key: 'learn',
    label: '學',
    title: '影片學習與資料下載',
    summary: '集中放置 F450 組裝、Mission Planner 地面站與飛控基礎資源。'
  },
  {
    key: 'practice',
    label: '練',
    title: '模擬器安裝與飛行練習',
    summary: '引導使用者下載模擬器並完成起飛、懸停、轉向與降落練習。'
  },
  {
    key: 'build',
    label: '做',
    title: 'F450 實物組裝與 AI 問答',
    summary: '用 SOP 完成實物組裝，並預留 RAG 知識庫與 GPT 語音排錯入口。'
  },
  {
    key: 'assess',
    label: '測',
    title: '槳葉正反面 YOLOv8 檢測',
    summary: '上傳照片後模擬檢測 CW / CCW 槳葉方向，後續接入真實模型。'
  },
  {
    key: 'certify',
    label: '證',
    title: 'GitHub 成果存證',
    summary: '整理學習紀錄、組裝證據、檢測結果與專案報告，上傳至 GitHub。'
  }
];

export const learningResources = [
  {
    type: 'youtube',
    title: 'F450 組裝教學影片',
    description: '學習機架、機臂、馬達、ESC、飛控與 GPS 的基本安裝順序。',
    url: 'https://www.youtube.com/results?search_query=F450+quadcopter+assembly+tutorial'
  },
  {
    type: 'youtube',
    title: 'Mission Planner 地面站教學',
    description: '學習固件、加速度計、羅盤、遙控器校準與飛行模式設定。',
    url: 'https://www.youtube.com/results?search_query=Mission+Planner+setup+Pixhawk+tutorial'
  },
  {
    type: 'download',
    title: 'Mission Planner 下載',
    description: '前往 ArduPilot 官方網站下載 Mission Planner。',
    url: 'https://ardupilot.org/planner/docs/mission-planner-installation.html'
  },
  {
    type: 'reference',
    title: 'ArduPilot Copter 文件',
    description: '查詢飛控設定、校準、安全檢查與多旋翼基本概念。',
    url: 'https://ardupilot.org/copter/'
  }
];

export const practiceResources = [
  {
    category: 'simulator-download',
    title: 'RealFlight / RC 模擬器搜尋',
    description: '先以 RC 飛行模擬器建立油門、橫滾、俯仰與偏航控制手感。',
    url: 'https://www.google.com/search?q=drone+flight+simulator+download',
    steps: ['下載並安裝模擬器', '設定遙控器或鍵盤控制', '完成定點懸停 5 分鐘']
  },
  {
    category: 'simulator-practice',
    title: '四面懸停練習任務',
    description: '依序完成機頭朝前、右、後、左四個方向的穩定懸停。',
    url: '#practice',
    steps: ['起飛到 1-2m', '每面懸停至少 5 秒', '順時針轉向 90 度', '降落回 H 點']
  },
  {
    category: 'theory-practice',
    title: '考照學科題庫練習',
    description: '用題庫練習建立空域、安全、法規與飛行常識。',
    url: 'https://www.caa.gov.tw/',
    steps: ['閱讀民航局規範', '完成題庫練習', '記錄錯題並回到學習模組補強']
  }
];

export const buildWorkflow = {
  evidenceTypes: ['photo', '30-second-video'],
  assistantPrompt: '請描述你的組裝問題，或上傳照片 / 30 秒影片供 AI 教官判斷。',
  stages: [
    '零件檢查',
    '機架與機臂組裝',
    '馬達與 ESC 安裝',
    '飛控主板與 GPS 羅盤固定',
    '電源與接收機接線',
    'Mission Planner 校準',
    '拆槳馬達測試',
    '槳葉 CW / CCW 安裝確認'
  ]
};

export const certificationChecklist = [
  { title: 'GitHub 專案倉庫', detail: '提交網站、標註流程、模型設定與訓練紀錄。' },
  { title: '組裝照片與 30 秒影片', detail: '保存每階段組裝證據與排錯紀錄。' },
  { title: 'YOLOv8 檢測結果', detail: '保存槳葉正反面檢測截圖、分數與建議。' },
  { title: '學習與練習紀錄', detail: '保留影片學習、模擬器練習與四面懸停紀錄。' }
];

export function calculateProgress(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const percentage = Math.round((completed / total) * 100);
  return Math.min(100, Math.max(0, percentage));
}

export function simulateBuildAssistant(question = '') {
  const topic = question.trim() || '組裝問題';
  return {
    mode: 'rag-gpt-voice-placeholder',
    topic,
    answer:
      'RAG 知識庫尚未接入。示範回答：請先確認機頭方向，再檢查飛控主板、GPS 羅盤與槳葉 CW / CCW 是否和組裝圖一致。',
    voiceStatus: 'GPT 語音回答介面已預留，尚未接入真實語音服務。'
  };
}

export function simulatePropellerAssessment(fileName = 'propeller-check.jpg') {
  return {
    type: 'propeller-photo',
    engine: 'YOLOv8 placeholder',
    fileName,
    status: 'NEEDS_RECHECK',
    summary: '模擬檢測完成：四個槳葉均已識別，其中前右槳葉方向需要人工確認。',
    detections: [
      { position: 'front-left', className: 'ccw_propeller', confidence: 0.91, result: 'PASS' },
      { position: 'front-right', className: 'cw_propeller', confidence: 0.62, result: 'NEEDS_RECHECK' },
      { position: 'rear-left', className: 'cw_propeller', confidence: 0.88, result: 'PASS' },
      { position: 'rear-right', className: 'ccw_propeller', confidence: 0.9, result: 'PASS' }
    ],
    nextStep: '接入真實 YOLOv8 後，系統會用槳葉類別與機頭方向規則判斷正反面是否安裝正確。'
  };
}
