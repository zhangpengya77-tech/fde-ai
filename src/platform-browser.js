const providedYoutubeUrls = [
  'https://youtu.be/dWkH5YVi3gY?si=AAcniWN9BjKwF8rL',
  'https://youtu.be/N0fW9Q9sWMU?si=hpvsR3KT-3eS1-bZ',
  'https://youtu.be/F9RLymjxsVo?si=Bg5pFoD42r84qFCx',
  'https://youtu.be/U3VhDWSoLUE?si=KOWQ5Phg2Rok5oNi',
  'https://youtu.be/XbvoZ9LN1YU?si=ioJW6oYzwWvF3lEn',
  'https://youtu.be/omPgcb1PFRM?si=aPQ7hetB-99oYGTR',
  'https://youtu.be/bnZd-H45fhs?si=mIGjavv9wm-YLyjq',
  'https://youtu.be/mK6WSXsLamM?si=NueCz1CVnOXh_UrJ',
  'https://youtu.be/FWjNXvYsQbc?si=f4fdHLae9lnggCQc',
  'https://youtu.be/jwyomgCmwkM?si=ybZoxw_r2fnRlNLQ',
  'https://youtu.be/nZabYJOAXSM?si=C7nPrit9Wtqx4s9m',
  'https://youtu.be/oF20bBBYDgY?si=e8ZfBjNBrzDtoikd',
  'https://youtu.be/HYixnTBI0rs?si=q4ZEGh5S-YUmRNJW',
  'https://youtu.be/9ZeOb67IN5s?si=AcFaKNp_rnal1Fs8',
  'https://youtu.be/qo1f1FZn0Qo?si=LMrHNtYblP4xs8b_',
  'https://youtu.be/UNJ1JLVaGQk?si=UYZV15Hiwah8L-Am',
  'https://youtu.be/krwiLPgX-jc?si=muN0t3CPk6odrwW8',
  'https://youtu.be/PbY0kk5_ZgQ?si=tpmJM_OjU3veo0fq',
  'https://youtu.be/eFx4Y32O5ZA?si=9_eSuQrPkJZI1EnT',
  'https://youtu.be/6GTNxyggWKk?si=rd9yDw8FBNJXYwnh',
  'https://youtu.be/LWRdX7diPsc?si=LnDl_eiAGIJ_4KQv',
  'https://youtu.be/nxsu_WuswFI?si=ZbYkzJQJ2e98iylD',
  'https://youtu.be/fvokyfXBk8c?si=G3kdrho1ASoaNzOh',
  'https://youtu.be/5at7lvtZCHs?si=BcrcSxxXQW4VHO_N',
  'https://youtu.be/9yS8o9lLIP4?si=tnd2vLf16S5cDddd',
  'https://youtu.be/Q4SCpO1bNSM?si=riI3CLw6bv9U7mY1',
  'https://youtu.be/QLWScjXtKk0?si=I9ru_J3MmYqqUllt',
  'https://youtu.be/mLZ0bJi0ARE?si=sSn4W4P1uD-tnNjQ',
  'https://youtu.be/uRv467PhPkU?si=MfaSD8jkDsu_UmL6',
  'https://youtu.be/fJ2a28FoKWI?si=ine09PVeqe8xJ77L',
  'https://youtu.be/BKHmelBgvkE?si=W43xZ9TytUx7hgCl',
  'https://youtu.be/kAqhQ8hqyLk?si=bMjb80BxpPaFAY6w',
  'https://youtu.be/zcFXlvzQbeI?si=D2G8UhzrpG3hbG-1',
  'https://youtu.be/iqasSBlnyZg?si=U3iOdMhmZC4-ivUQ'
];

const hero = {
  name: 'fde-ai',
  headline: 'FDE-AI 無人載具學習平台',
  summary: 'AI 雙師教學｜學・練・作・測・證，將 Mission Pack、F450 工程實作、鷹眼 AI 評測與作品存證整合成一座無人載具學習控制中心。',
  systems: ['AI 驅動雙師教學系統', '鷹眼 AI 評測系統'],
  status: 'v1.0 MVP frontend',
  actions: [
    { label: '進入學習平台', target: '#dashboard', kind: 'primary' },
    { label: '觀看系統 Demo', target: '#inspection', kind: 'secondary' }
  ]
};

const designSystem = {
  visualMetaphor: '未來實驗室＋無人機地面站＋AI 教學控制台',
  principle: '外層炫、內層穩',
  palette: {
    background: '#07111F',
    surface: '#0B1726',
    primaryBlue: '#168BFF',
    cyan: '#00C2FF',
    text: '#DDF3FF',
    success: '#35E6A8',
    warning: '#F5B84B',
    danger: '#FF5C73'
  },
  motion: ['頁面淡入', '卡片 hover 浮起 3-5px', '藍色邊框輕微發光', '學練作測證進度流光', 'AI 檢測掃描線', '數字計分遞增'],
  avoid: ['過度霓虹', '複雜 3D', '遊戲化卡通', '大量閃爍', '影片背景堆疊']
};

const moduleSections = [
  { key: 'home', label: '展', title: '科技展廳', summary: '第一屏建立 AI 無人載具系統感。' },
  { key: 'dashboard', label: '控', title: '學生任務控制台', summary: '顯示目前任務、進度、待檢測與作品成果。' },
  { key: 'missions', label: '任', title: 'Mission Pack', summary: '以 12 個任務包取代普通課程目錄。' },
  { key: 'inspection', label: '測', title: '鷹眼 AI 檢測中心', summary: '組裝檢測、四面懸停與 AI 初判儀表板。' },
  { key: 'teacher', label: '師', title: '教師復核中心', summary: '高資訊密度呈現待辦、AI 異常與班級狀態。' }
];

const platformModes = [
  {
    key: 'public',
    title: 'Public Mode',
    description: '面向校長、老師、論壇與合作機構，展示專案定位、五階段流程、任務包、AI 評分與成果案例。',
    nav: ['項目介紹', '學練作測證', '任務包', '鷹眼評分', '作品成果', '合作入口']
  },
  {
    key: 'student',
    title: 'Student Mode',
    description: '學生只看任務、練習、檢測、作品、成績與 AI 助教，操作路徑保持簡單。',
    nav: ['首頁', '我的任務', '模擬訓練', 'AI 檢測', '我的作品', '我的成績', 'AI 助教']
  },
  {
    key: 'teacher',
    title: 'Teacher Mode',
    description: '教師端追求快、清楚、資訊密度高，以待復核和 AI 異常為核心。',
    nav: ['班級', '任務發布', '待復核', 'AI 異常', '學生能力', '成果導出']
  }
];

const missionPacks = [
  { code: 'M01', title: '無人機安全與基礎認知', outcome: '飛行安全任務單', focus: '建立安全與系統認知', status: '已完成' },
  { code: 'M02', title: '足球無人機模擬訓練', outcome: '基礎操控成績', focus: '低門檻、人人可練', status: '已完成' },
  { code: 'M03', title: '足球無人機實機挑戰', outcome: '團隊競賽成果', focus: '安全實飛與團隊合作', status: '已完成' },
  { code: 'M04', title: '無人機證照模擬訓練', outcome: '四面懸停／八字／起降模擬紀錄', focus: '銜接術科能力', status: '進行中' },
  { code: 'M05', title: 'F450 開源無人機工程組裝', outcome: '完整 F450 教學機', focus: '工程結構、飛控與感測整合', status: '進行中' },
  { code: 'M06', title: 'AI 檢測考核 A｜F450 組裝', outcome: '組裝 AI 檢測報告', focus: '測工程實作正確性', status: 'AI 檢測中' },
  { code: 'M07', title: 'Mission Planner 自主航線', outcome: '自主航線任務報告', focus: '用任務規劃取代初期複雜程式碼', status: '未開始' },
  { code: 'M08', title: 'AI 視覺目標檢測', outcome: '小型資料集＋AI 模型', focus: '建立資料與 AI 應用能力', status: '未開始' },
  { code: 'M09', title: '3D 掃描與空拍建模', outcome: '3D 場景／物件模型', focus: '數位建模與空間資料應用', status: '未開始' },
  { code: 'M10', title: 'AI 檢測考核 B｜四面懸停', outcome: '飛行 AI 評量報告', focus: '測飛行穩定度與標準動作', status: '教師復核' },
  { code: 'M11', title: '數位轉型＋3D 列印', outcome: 'Q 版形象／無人機配件', focus: '數位設計到實體製造', status: '未開始' },
  { code: 'M12', title: '智慧城市＋AI 影音＋搜救應用', outcome: '整合專題影片／報告', focus: '綜合應用與成果展示', status: '未開始' }
];

const learningPath = [
  { title: '足球無人機', icon: 'drone', state: 'complete' },
  { title: '模擬器', icon: 'joystick', state: 'complete' },
  { title: 'F450', icon: 'frame', state: 'complete' },
  { title: '自主航線', icon: 'map', state: 'active' },
  { title: 'AI', icon: 'chip', state: 'locked' },
  { title: '3D', icon: 'cube', state: 'locked' },
  { title: '智慧城市', icon: 'city', state: 'locked' },
  { title: '綜合項目', icon: 'portfolio', state: 'locked' }
];

const studentDashboard = {
  greeting: '早安，張同學',
  stats: [
    { label: '本週任務', value: '4/6' },
    { label: 'AI 待檢測', value: 2 },
    { label: '教師待複核', value: 1 },
    { label: '已完成作品', value: 8 }
  ],
  currentMission: {
    code: 'M06',
    title: 'F450 正反槳 AI 檢測',
    description: '上傳 F450 俯視照片，確認 CW / CCW 槳葉、飛控方向、GPS 朝向與電池固定。',
    progress: [
      { label: '學', state: 'complete' },
      { label: '練', state: 'complete' },
      { label: '作', state: 'complete' },
      { label: '測', state: 'active' },
      { label: '證', state: 'pending' }
    ],
    action: '繼續任務'
  }
};

const youtubeVideos = providedYoutubeUrls.map((url, index) => ({
  type: 'youtube',
  title: `課程影片 ${String(index + 1).padStart(2, '0')}`,
  description: '已放入學習模組，後續可再替換成正式影片標題與單元說明。',
  url
}));

const videoRange = (start, end, titlePrefix) =>
  youtubeVideos.slice(start - 1, end).map((video, index) => ({
    ...video,
    title: `${titlePrefix} ${String(index + 1).padStart(2, '0')}`
  }));

const learningTracks = [
  {
    key: 'f450',
    title: 'F450 組裝與飛控課程',
    summary: '先看 DJI NAZA 與 Pixhawk 2.4.8 的飛控介紹、組裝、調參與安全檢查。',
    items: [
      { type: 'course', title: 'DJI NAZA 飛控介紹、組裝與調參', description: '作為飛控概念與線路配置的對照學習。', url: providedYoutubeUrls[0] },
      { type: 'course', title: 'Pixhawk 2.4.8 飛控介紹、組裝與調參', description: '1.0 實作階段以 Pixhawk 2.4.8 為主。', url: providedYoutubeUrls[1] },
      ...videoRange(3, 8, 'F450 補充影片')
    ]
  },
  {
    key: 'phoenix',
    title: '鳳凰模擬器學習',
    summary: '學習鳳凰模擬器使用方式；軟體下載需聯繫後台管理員線下取得。',
    items: [
      ...videoRange(9, 11, '鳳凰模擬器影片'),
      { type: 'offline-download', title: '鳳凰模擬器下載說明', description: '此軟體不在網站直接下載，請聯繫後台管理員線下提供安裝包。', url: '#practice' }
    ]
  },
  {
    key: 'license',
    title: '無人機證照學科',
    summary: '學習證照考取內容，並連到台灣地區無人機基本操作證學科題庫。',
    items: [
      ...videoRange(12, 14, '證照課程影片'),
      { type: 'question-bank', title: '台灣無人機學科題庫入口', description: '用於刷題與準備基礎操作證學科考試。', url: 'https://www.caa.gov.tw/' }
    ]
  },
  {
    key: 'ai',
    title: 'AI 應用學習',
    summary: '學習 Codex、YOLO 目標檢測、資料集標註與訓練流程。',
    items: videoRange(15, 18, 'AI 應用影片')
  },
  {
    key: 'printing3d',
    title: '3D 列印課程',
    summary: '放入第 1 集到第 16 集，作為無人機零件與輔具製作基礎。',
    items: videoRange(19, 34, '3D 列印第')
  },
  {
    key: 'github',
    title: 'GitHub 成果存證',
    summary: '學會建立私人倉庫、上傳成果、整理學習紀錄與版本歷程。',
    items: [
      {
        type: 'workflow',
        title: 'GitHub 倉庫使用與成果整理',
        description: '1.0 先用手動方式提交學習影片截圖、組裝照片、測試結果與心得。',
        url: 'https://github.com/'
      }
    ]
  }
];

const learningResources = learningTracks.flatMap((track) =>
  track.items.map((item) => ({ ...item, track: track.key, trackTitle: track.title }))
);

const practiceResources = [
  {
    category: 'phoenix-simulator',
    title: '鳳凰模擬器飛行練習',
    description: '安裝完成後練習起飛、定點懸停、方向控制、降落與四面懸停。',
    url: '#practice',
    steps: ['向管理員取得安裝包並完成本地安裝', '完成遙控器或鍵盤控制設定', '每天練習起飛、懸停、轉向與降落', '錄製一次穩定四面懸停作為測評素材']
  },
  {
    category: 'license-simulator',
    title: '考照模擬練習',
    description: '用模擬考流程熟悉學科題型、作答節奏與錯題整理。',
    url: 'https://www.caa.gov.tw/',
    steps: ['進入台灣地區無人機學科題庫或模擬考入口', '完成一回合模擬測驗', '記錄錯題類型', '回到學的證照影片補強']
  },
  {
    category: 'question-bank',
    title: '學科題庫刷題',
    description: '針對法規、安全、空域、氣象與操作常識進行反覆練習。',
    url: 'https://www.caa.gov.tw/',
    steps: ['先刷基礎題', '整理錯題', '重刷錯題', '達到穩定通過率後進入測驗']
  }
];

const buildWorkflow = {
  version: '1.0',
  controller: 'Pixhawk 2.4.8',
  interactionMode: 'upload-only',
  evidenceTypes: ['photo', '30-second-video'],
  assistantPrompt: '請描述你的組裝問題，或上傳照片 / 30 秒影片供 AI 教官判斷。',
  stages: [
    '零件清點：F450 機架、機臂、馬達、ESC、Pixhawk 2.4.8、GPS 羅盤、接收機、電池與槳葉',
    '機架與機臂組裝：確認紅白機臂方向與機頭標記',
    '馬達與 ESC 安裝：確認四角位置、線材走向與焊點',
    'Pixhawk 2.4.8 飛控固定：箭頭朝機頭，減震與水平狀態確認',
    'GPS 羅盤與接收機接線：確認接口、方向與固定位置',
    '電池與電源模組檢查：確認正負極、供電與固定方式',
    'Mission Planner 調參：固件、加速度計、羅盤、遙控器與飛行模式校準',
    '拆槳馬達測試：確認旋轉方向後再安裝 CW / CCW 槳葉',
    '上傳照片或 30 秒影片：由 1.0 模擬 AI 教官給出排錯建議'
  ]
};

const assessmentWorkflows = [
  {
    key: 'assembly-detection',
    title: 'F450 組裝 AI 檢測',
    engine: 'YOLOv8 placeholder',
    acceptedEvidence: ['photo', '30-second-video'],
    checks: ['槳葉 CW / CCW 是否安裝正確', '馬達與機臂位置是否合理', '飛控方向、GPS 羅盤與電池位置是否需要人工複查']
  },
  {
    key: 'hover-scoring',
    title: 'F450 四面懸停 AI 評分',
    engine: 'YOLOv8 hover scoring placeholder',
    acceptedEvidence: ['30-second-video'],
    checks: ['機頭朝前懸停', '機頭朝右懸停', '機頭朝後懸停', '機頭朝左懸停', '線下老師完成最終評分']
  }
];

const teacherDashboard = {
  stats: [
    { label: '今日提交', value: 18 },
    { label: '待復核', value: 7 },
    { label: 'AI 警告', value: 3 },
    { label: '本班完成率', value: '72%' }
  ],
  reviewQueue: [
    { student: '學生 A', mission: 'M06 F450 檢測', aiResult: 'FAIL', reason: '右前槳疑似安裝錯誤', action: '查看' },
    { student: '學生 B', mission: 'M10 四面懸停', aiResult: 'WARNING', reason: '機頭朝後時漂移超出建議範圍', action: '查看' },
    { student: '學生 C', mission: 'M05 F450 組裝', aiResult: 'PASS', reason: '等待教師完成安全複核', action: '查看' }
  ]
};

const certificationChecklist = [
  { title: 'GitHub 私人專案倉庫', detail: '提交網站、課程記錄、標註流程、模型設定與訓練紀錄。' },
  { title: '學習過程紀錄', detail: '保存 F450、模擬器、證照、AI、3D 列印與 GitHub 的學習過程。' },
  { title: '組裝照片與 30 秒影片', detail: '保存每階段實作證據、AI 問答紀錄與人工修正紀錄。' },
  { title: 'AI 測評結果', detail: '保存組裝檢測、槳葉方向、四面懸停評分與老師複核結果。' }
];

function calculateProgress(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const percentage = Math.round((completed / total) * 100);
  return Math.min(100, Math.max(0, percentage));
}

function simulateBuildAssistant(question = '') {
  const topic = question.trim() || 'Pixhawk 2.4.8 組裝問題';
  return {
    mode: 'rag-gpt-voice-placeholder',
    topic,
    answer:
      'RAG 知識庫尚未接入。1.0 示範回答：請先確認 Pixhawk 箭頭朝向機頭，再檢查 GPS 羅盤、電源模組、接收機接線、馬達旋轉方向與 CW / CCW 槳葉是否和組裝規則一致。',
    voiceStatus: 'GPT 語音回答介面已預留，目前先用文字回覆；2.0 再接入即時語音與攝像頭糾錯。'
  };
}

function simulatePropellerAssessment(fileName = 'propeller-check.jpg') {
  return {
    type: 'propeller-photo',
    engine: 'YOLOv8 placeholder',
    fileName,
    status: 'NEEDS_RECHECK',
    score: 82,
    teacherStatus: '待復核',
    summary: '模擬檢測完成：四個槳葉均已識別，其中前右槳葉方向需要人工確認；飛控方向與電池固定建議再拍一張俯視圖。',
    detections: [
      { position: 'front-left', className: 'ccw_propeller', confidence: 0.91, result: 'PASS' },
      { position: 'front-right', className: 'cw_propeller', confidence: 0.62, result: 'NEEDS_RECHECK' },
      { position: 'rear-left', className: 'cw_propeller', confidence: 0.88, result: 'PASS' },
      { position: 'rear-right', className: 'ccw_propeller', confidence: 0.9, result: 'PASS' }
    ],
    checklist: [
      { label: '正反槳', result: 'PASS' },
      { label: 'GPS 朝向', result: 'PASS' },
      { label: '電池固定', result: 'WARNING' },
      { label: '線材整理', result: 'PASS' }
    ],
    nextStep: '接入真實 YOLOv8 後，系統會用槳葉類別、機頭方向與零件位置規則判斷整體組裝是否正確。'
  };
}

function simulateHoverAssessment(fileName = 'hover.mp4') {
  return {
    type: 'hover-video',
    engine: 'YOLOv8 hover scoring placeholder',
    fileName,
    score: 82,
    summary: '四面懸停影片已完成模擬評分：穩定度良好，機頭朝後時偏移較明顯。',
    teacherReview: '此分數為 AI 初評，最終結果需由線下老師複核。',
    metrics: [
      { label: '漂移距離', value: '0.8 m' },
      { label: '越界次數', value: 1 },
      { label: '穩定時間', value: '24 s' },
      { label: '方向完成度', value: '4/4' },
      { label: '姿態偏差', value: '低' }
    ]
  };
}

window.FdePlatform = { hero, designSystem, moduleSections, platformModes, missionPacks, learningPath, studentDashboard, youtubeVideos, learningTracks, learningResources, practiceResources, buildWorkflow, assessmentWorkflows, teacherDashboard, certificationChecklist, calculateProgress, simulateBuildAssistant, simulatePropellerAssessment, simulateHoverAssessment };

