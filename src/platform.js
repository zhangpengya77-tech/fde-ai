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

const providedYoutubeTitles = [
  '多旋翼F450&px2.4.8飛控&mp地面站設置說明',
  'MP地面站軟體基礎介紹1',
  '多旋翼F450&dji naza組裝步驟',
  '多旋翼F450&djinaza調參軟體介紹',
  'dji naza 地面站調參軟體介紹',
  'F450无人机 AT9SPRO遥控器调试设置教程',
  '手把手教你-小白速通github入門到進階教學',
  '手把手教你搭建個人知識庫',
  '手把手教你ai零基礎入門名詞解釋（一次到位黑話解答）',
  '手把手教你-小白10分鐘速通codex做網頁',
  'yolov8目標檢測自建數據集標注工具及視頻抽幀圖片標注方法',
  'yolo目標檢測模型訓練入門1',
  'yolo目標檢測入門模型訓練2',
  '無人機充電器介紹',
  '無人機模擬訓練鳳凰模擬器遙控器設置及場地介紹',
  '台湾無人機專業基本級術科考試真人演示',
  'Fusion 360 教程（持续更新中） p01 1  Fusion 360 简介',
  '02 2  安装 Fusion 360',
  'fusion360 03 3  用户界面介绍',
  'Fusion360 04 4  直线与草图尺寸',
  'Fusion 360 05 5  矩形与圆',
  'Fusion 360 06 6  圆弧、槽、圆角、点',
  'Fusion 360 07 7  约束',
  'Fusion 360 08 8  草图练习1',
  'Fusion 360 09 9  草图练习2',
  '13 13  实体命令 拉伸',
  'Fusion 360  11 11  草图练习4 环形阵列与多边形',
  'Fusion 360 12 12  草图练习5 进阶',
  'Fusion 360 14 14  实体命令 旋转',
  'Fusion 360 15 15  实体命令 扫掠',
  'Fusion 360  16 16  构造基准面',
  'Fusion 360   17  实体命令 放样、抽壳、圆角',
  'Fusion 36018 18  实体练习1 牟合方盖',
  '無人機Mp地面站設定飛行計劃講解'
];

function classifyLearningSource(title = '') {
  const normalized = title.toLowerCase();
  if (normalized.includes('dji') || normalized.includes('naza') || normalized.includes('fusion') || normalized.includes('鳳凰')) {
    return '閉源/專有';
  }

  if (
    normalized.includes('pixhawk') ||
    normalized.includes('px2.4.8') ||
    normalized.includes('mp地面站') ||
    normalized.includes('mission planner') ||
    normalized.includes('github') ||
    normalized.includes('yolo') ||
    normalized.includes('codex') ||
    normalized.includes('知識庫') ||
    normalized.includes('ai')
  ) {
    return '開源生態';
  }

  return '通用工具';
}

function withVideoDescription(video, description) {
  return {
    ...video,
    description
  };
}

export const hero = {
  name: 'fde-ai',
  headline: 'FDE-AI 無人載具學習平台',
  summary: 'AI 雙師教學｜學・練・作・測・證，將 Mission Pack、F450 工程實作、鷹眼 AI 評測與作品存證整合成一座無人載具學習控制中心。',
  systems: ['AI 驅動雙師教學系統', '鷹眼 AI 評測系統'],
  systemStatus: [
    { label: 'YOLO v2', state: '本機模型', detail: '已預設接入 F450 零件與 CW/CCW 槳葉檢測流程。' },
    { label: '四面懸停', state: '評分入口', detail: '先使用上傳影片與模擬評分，後續接入正式飛行檢測模型。' },
    { label: 'RAG 知識庫', state: '預留接入', detail: '作的階段優先查詢 E 盤教材，再補接大模型回答。' }
  ],
  status: 'v1.0 MVP frontend',
  showMotionStrip: false,
  actions: [
    { label: '進入學習平台', target: '#learn', kind: 'primary' },
    { label: '觀看系統 Demo', target: '#inspection', kind: 'secondary' }
  ]
};

export const designSystem = {
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
  motion: ['頁面淡入', '文字光暈與卡片浮起', '藍色邊框輕微發光', '學練作測證節點呼吸與進度流光', 'AI 檢測掃描線', '數字計分遞增'],
  avoid: ['過度霓虹', '複雜 3D', '遊戲化卡通', '大量閃爍', '影片背景堆疊']
};

export const moduleSections = [
  {
    key: 'learn',
    label: '學',
    title: '課程影片與下載說明',
    summary: 'F450、模擬器、證照、AI、3D 列印與 GitHub 的課程影片入口。',
    goal: '先看懂課程影片、下載方式與工具用途，知道每個任務要學什麼。'
  },
  {
    key: 'practice',
    label: '練',
    title: '模擬器與考照練習',
    summary: '鳳凰模擬器、考照模擬與學科題庫刷題練習。',
    goal: '把鳳凰模擬器、證照題庫與術科動作先練熟，再進入實機操作。'
  },
  {
    key: 'build',
    label: '作',
    title: 'F450 組裝與 AI 助教',
    summary: 'Pixhawk 2.4.8 版本 F450 組裝、調參、照片 / 30 秒影片上傳與 RAG 助教。',
    goal: '依照 Pixhawk 2.4.8 流程完成 F450 組裝，遇到問題可上傳照片詢問 AI 助教。'
  },
  {
    key: 'inspection',
    label: '測',
    title: '目標檢測與考試題庫',
    summary: '檢測槳葉、馬達、電池等組裝狀態，並保留四面懸停考試題庫與 AI 評分入口。',
    goal: '上傳照片或影片，檢查槳葉、馬達、電池與四面懸停表現，產生可複核結果。'
  },
  {
    key: 'certify',
    label: '證',
    title: 'GitHub 成果存證',
    summary: '把學習過程、組裝照片、AI 測評結果與作品整理到 GitHub。',
    goal: '把學習紀錄、檢測截圖、影片與作品整理成 GitHub 倉庫，形成能力證據。'
  }
];

export const platformModes = [
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

export const missionPacks = [
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

export const learningPath = [
  { title: '足球無人機', icon: 'drone', state: 'complete' },
  { title: '模擬器', icon: 'joystick', state: 'complete' },
  { title: 'F450', icon: 'frame', state: 'complete' },
  { title: '自主航線', icon: 'map', state: 'active' },
  { title: 'AI', icon: 'chip', state: 'locked' },
  { title: '3D', icon: 'cube', state: 'locked' },
  { title: '智慧城市', icon: 'city', state: 'locked' },
  { title: '綜合項目', icon: 'portfolio', state: 'locked' }
];

export const studentDashboard = {
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

export const youtubeVideos = providedYoutubeUrls.map((url, index) => ({
  type: 'youtube',
  title: providedYoutubeTitles[index],
  description: 'YouTube 讀取標題後放入學習模組，點擊可開啟原影片。',
  sourceType: classifyLearningSource(providedYoutubeTitles[index]),
  author: 'FDE-Ai無人載具實驗室',
  url
}));

export const learningTrackPreviewCount = 2;

const videoRange = (start, end) => youtubeVideos.slice(start - 1, end);

export const learningTracks = [
  {
    key: 'f450',
    title: 'F450 組裝與飛控課程',
    previewCount: learningTrackPreviewCount,
    summary: '先看 DJI NAZA 與 Pixhawk 2.4.8 的飛控介紹、組裝、調參與安全檢查。',
    items: [
      withVideoDescription(youtubeVideos[0], 'Pixhawk 2.4.8、MP 地面站與 F450 設置，屬於開源飛控生態。'),
      withVideoDescription(youtubeVideos[2], 'DJI NAZA 版本 F450 組裝流程，屬於閉源 / 專有飛控系統。'),
      withVideoDescription(youtubeVideos[3], 'DJI NAZA 調參軟體與設定流程，作為閉源飛控對照。'),
      withVideoDescription(youtubeVideos[4], 'DJI NAZA 地面站調參軟體介紹。'),
      withVideoDescription(youtubeVideos[5], 'AT9S PRO 遙控器調試設定。'),
      withVideoDescription(youtubeVideos[13], '電池與充電器安全基礎。'),
      withVideoDescription(youtubeVideos[33], 'Mission Planner 飛行計劃設定。')
    ]
  },
  {
    key: 'phoenix',
    title: '鳳凰模擬器學習',
    previewCount: learningTrackPreviewCount,
    summary: '學習鳳凰模擬器使用方式；軟體下載需聯繫後台管理員線下取得。',
    items: [
      withVideoDescription(youtubeVideos[14], '鳳凰模擬器遙控器設定、場地介紹與練習入口。'),
      { type: 'offline-download', title: '鳳凰模擬器下載說明', description: '此軟體不在網站直接下載，請聯繫後台管理員線下提供安裝包。', sourceType: '閉源/專有', url: 'https://www.flugsimulatoren.ch/' }
    ]
  },
  {
    key: 'license',
    title: '無人機證照學科',
    previewCount: learningTrackPreviewCount,
    summary: '學習證照考取內容，並連到台灣地區無人機基本操作證學科題庫。',
    items: [
      withVideoDescription(youtubeVideos[15], '台灣無人機專業基本級術科真人演示。'),
      { type: 'question-bank', title: '台灣無人機學科題庫入口', description: '用於刷題與準備基礎操作證學科考試。', sourceType: '官方題庫', url: 'https://www.caa.gov.tw/Article.aspx?a=3833' }
    ]
  },
  {
    key: 'ai',
    title: 'AI 應用學習',
    previewCount: learningTrackPreviewCount,
    summary: '學習 Codex、YOLO 目標檢測、資料集標註與訓練流程。',
    items: [
      withVideoDescription(youtubeVideos[7], '個人知識庫與 RAG 概念。'),
      withVideoDescription(youtubeVideos[8], 'AI 基礎名詞與應用概念。'),
      withVideoDescription(youtubeVideos[9], 'Codex 製作網站入門。'),
      withVideoDescription(youtubeVideos[10], 'YOLOv8 目標檢測資料集、抽幀與標註流程。'),
      withVideoDescription(youtubeVideos[11], 'YOLO 目標檢測模型訓練入門 1。'),
      withVideoDescription(youtubeVideos[12], 'YOLO 目標檢測模型訓練入門 2。')
    ]
  },
  {
    key: 'printing3d',
    title: '3D 列印課程',
    previewCount: learningTrackPreviewCount,
    summary: '放入第 1 集到第 16 集，作為無人機零件與輔具製作基礎。',
    items: videoRange(17, 32)
  },
  {
    key: 'github',
    title: 'GitHub 成果存證',
    previewCount: learningTrackPreviewCount,
    summary: '學會建立私人倉庫、上傳成果、整理學習紀錄與版本歷程。',
    items: [
      withVideoDescription(youtubeVideos[6], 'GitHub 入門到進階，對應「證」階段的成果存證。'),
      { type: 'workflow', title: 'GitHub 倉庫使用與成果整理', description: '1.0 先用手動方式提交學習影片截圖、組裝照片、測試結果與心得。', sourceType: '開源生態', url: 'https://github.com/' }
    ]
  }
];

export const learningResources = learningTracks.flatMap((track) =>
  track.items.map((item) => ({ ...item, track: track.key, trackTitle: track.title }))
);

export const practiceResources = [
  {
    category: 'phoenix-simulator',
    title: '鳳凰模擬器飛行練習',
    description: '安裝完成後練習起飛、定點懸停、方向控制、降落與四面懸停。',
    url: 'https://www.flugsimulatoren.ch/',
    steps: ['向管理員取得安裝包並完成本地安裝', '開啟 Phoenix RC 社群資源確認模型與更新說明', '完成遙控器或鍵盤控制設定', '每天練習起飛、懸停、轉向與降落', '錄製一次穩定四面懸停作為測評素材']
  },
  {
    category: 'license-simulator',
    title: '考照模擬練習',
    description: '用模擬考流程熟悉學科題型、作答節奏與錯題整理。',
    url: 'https://drone-quiz.tw/',
    steps: ['進入台灣地區無人機學科題庫或模擬考入口', '完成一回合模擬測驗', '記錄錯題類型', '回到學的證照影片補強']
  },
  {
    category: 'question-bank',
    title: '學科題庫刷題',
    description: '針對法規、安全、空域、氣象與操作常識進行反覆練習。',
    url: 'https://www.caa.gov.tw/Article.aspx?a=3833',
    steps: ['先刷基礎題', '整理錯題', '重刷錯題', '達到穩定通過率後進入測驗']
  }
];

export const buildWorkflow = {
  version: '1.0',
  controller: 'Pixhawk 2.4.8',
  interactionMode: 'upload-only',
  evidenceTypes: ['photo', '30-second-video'],
  assistantPrompt: '請描述你的組裝問題，系統會先查詢 E 盤知識包整理出的本地 RAG，再進入大模型 fallback。',
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

export const ragKnowledgeBase = [
  {
    id: 'f450-assembly',
    title: 'F450安裝視頻',
    sourcePath: 'E:\\F450素材\\视频转文字系统\\TXT\\F450安裝視頻.txt',
    keywords: ['f450', 's450', '組裝', '安装', 'esc', '電機', '马达', '機臂', '飛控', 'gps', 'led', '接收機', '電源模組', 'pixhawk'],
    content:
      'F450 組裝先焊接 ESC 與 XT60 電源線，紅線接正極、黑線接負極。馬達用螺絲固定在四個機臂，注意螺絲長度不要頂到線圈。紅色機臂作為機頭方向，飛控需貼在上蓋板中心，飛控箭頭指向機頭；GPS 箭頭也要指向機頭，LED 建議放在機尾便於觀察狀態。接收機、電源模組、GPS、LED 與 M1-M4 電機線要依接口整理接好。'
  },
  {
    id: 'mission-planner-sim',
    title: 'mp地面站航線規劃模擬飛行說明',
    sourcePath: 'E:\\F450素材\\视频转文字系统\\TXT\\mp地面站航線規劃模擬飛行說明.txt',
    keywords: ['mission planner', 'mp', '地面站', '航線', '航点', '模擬', '仿真', 'takeoff', 'rtl', '返航', '高度', 'waypoint'],
    content:
      'Mission Planner 可用模擬器先練習航線規劃。基本流程是選擇多旋翼模型，進入飛行計劃頁面，用航點建立任務；完整任務通常包含 Takeoff 起飛、Waypoint 航點與 RTL 返航。常用相對高度，避免誤選海拔高度。航線寫入後可清除畫面再讀取航點，確認任務已寫入；執行 Mission Start 後可觀察高度、地速、航點距離與返航。'
  },
  {
    id: 'battery-charger',
    title: '無人機充電器使用說明',
    sourcePath: 'E:\\F450素材\\视频转文字系统\\TXT\\無人機充電器使用說明.txt',
    keywords: ['電池', '电池', '充電', '充电', 'lipo', 'lhv', '6s', '2s', 'xt60', 'xt30', '平衡頭', '通道', '電壓'],
    content:
      '充電器可充 2S 到 6S 電池。先接主電源頭與平衡頭，平衡頭有防呆設計但仍要確認方向。選擇正確通道 CH1 或 CH2，確認每片電芯電壓顯示正常；LiPo 通常選 4.2V，LHV 需選對電池類型。充電電流越小越保護電池，充電時人不要離開，需持續觀察電池是否發熱。通道一和通道二的主線與平衡線不能插錯。'
  },
  {
    id: 'soldering-tools',
    title: '無人機焊接工具',
    sourcePath: 'E:\\F450素材\\视频转文字系统\\TXT\\無人機焊接工具.txt',
    keywords: ['焊接', '焊点', '電烙鐵', '烙铁', '焊錫', '助焊劑', '萬用表', '短路', '扎帶', '3m', '螺絲刀'],
    content:
      '組裝與維修常用 M3、M2 內六角和小十字螺絲刀。電烙鐵建議選穩定可靠的焊台或便攜式 C 口烙鐵，搭配合適焊錫與助焊劑。剪線鉗、醋酸膠帶、3M 雙面膠與尼龍扎帶都常用。萬用表可檢查短路與供電異常，例如設備不亮時先量供電線是否有電壓。'
  }
];

function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{Script=Han}a-z0-9.]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function searchKnowledgeBase(question = '', limit = 2) {
  const normalizedQuestion = String(question).toLowerCase();
  const terms = tokenize(question);
  if (terms.length === 0 && normalizedQuestion.trim().length === 0) {
    return [];
  }

  return ragKnowledgeBase
    .map((entry) => {
      const haystack = `${entry.title} ${entry.keywords.join(' ')} ${entry.content}`.toLowerCase();
      const termScore = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      const keywordScore = entry.keywords.reduce(
        (total, keyword) => total + (normalizedQuestion.includes(keyword.toLowerCase()) ? 2 : 0),
        0
      );
      const score = termScore + keywordScore;
      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export const assessmentWorkflows = [
  {
    key: 'assembly-detection',
    title: 'F450 組裝 AI 檢測',
    engine: 'YOLOv8 placeholder',
    acceptedEvidence: ['photo', '30-second-video'],
    checks: ['槳葉 CW / CCW 是否安裝正確', '馬達與機臂位置是否合理', '電池固定與重心是否需要人工複查', '飛控方向與 GPS 羅盤位置是否合理']
  },
  {
    key: 'hover-scoring',
    title: 'F450 四面懸停 AI 評分',
    engine: 'YOLOv8 hover scoring placeholder',
    acceptedEvidence: ['30-second-video'],
    checks: ['機頭朝前懸停', '機頭朝右懸停', '機頭朝後懸停', '機頭朝左懸停', '線下老師完成最終評分']
  },
  {
    key: 'hover-question-bank',
    title: '四面懸停考試題庫',
    engine: 'exam-bank placeholder',
    acceptedEvidence: ['practice-record'],
    checks: ['四面懸停考試流程', '起飛與降落安全檢查', '方向辨識題', '常見扣分原因', '教師線下複核重點']
  }
];

export const teacherDashboard = {
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

export const certificationChecklist = [
  { title: 'GitHub 私人專案倉庫', detail: '提交網站、課程記錄、標註流程、模型設定與訓練紀錄。' },
  { title: '學習過程紀錄', detail: '保存 F450、模擬器、證照、AI、3D 列印與 GitHub 的學習過程。' },
  { title: '組裝照片與 30 秒影片', detail: '保存每階段實作證據、AI 問答紀錄與人工修正紀錄。' },
  { title: 'AI 測評結果', detail: '保存組裝檢測、槳葉方向、四面懸停評分與老師複核結果。' }
];

export function calculateProgress(completed, total) {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }

  const percentage = Math.round((completed / total) * 100);
  return Math.min(100, Math.max(0, percentage));
}

export function simulateBuildAssistant(question = '') {
  const topic = question.trim() || 'Pixhawk 2.4.8 組裝問題';
  const sources = searchKnowledgeBase(topic);

  if (sources.length > 0) {
    return {
      mode: 'rag-gpt-voice-placeholder',
      sourceStatus: 'local-rag',
      topic,
      answer: `RAG 知識庫已優先命中本地資料：${sources.map((source) => source.title).join('、')}。${sources[0].content}`,
      sources: sources.map((source) => ({
        title: source.title,
        sourcePath: source.sourcePath,
        score: source.score
      })),
      voiceStatus: 'GPT 語音回答介面已預留，目前先用文字回覆；2.0 再接入即時語音與攝像頭糾錯。'
    };
  }

  return {
    mode: 'rag-gpt-voice-placeholder',
    sourceStatus: 'large-model-fallback',
    topic,
    answer:
      '本地 RAG 知識庫沒有找到足夠相近的內容。1.0 先保留大模型 fallback 入口；正式接入 API 後，系統會把你的問題連同本地檢索上下文送到大模型回答。',
    sources: [],
    voiceStatus: 'GPT 語音回答介面已預留，目前先用文字回覆；2.0 再接入即時語音與攝像頭糾錯。'
  };
}

export function simulatePropellerAssessment(fileName = 'propeller-check.jpg') {
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

export function simulateHoverAssessment(fileName = 'hover.mp4') {
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
