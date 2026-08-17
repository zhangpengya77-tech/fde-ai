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

export const hero = {
  name: 'fde-ai',
  headline: 'FDE-AI 無人載具學習平台',
  summary: 'AI 驅動的學、練、做、測、證一體化 MVP，先跑通課程學習、模擬練習、F450 組裝、AI 評測與 GitHub 成果存證。',
  systems: ['AI 驅動雙師教學系統', '鷹眼 AI 評測系統'],
  status: 'v1.0 MVP frontend'
};

export const moduleSections = [
  { key: 'home', label: '首頁', title: '平台總覽', summary: '透明藍色無人機開機動畫與平台定位。' },
  { key: 'learn', label: '學', title: '課程影片與下載說明', summary: '集中學習 F450、模擬器、證照、AI、3D 列印與 GitHub。' },
  { key: 'practice', label: '練', title: '模擬器與考照練習', summary: '以鳳凰模擬器、證照模擬與題庫練習建立操作能力。' },
  { key: 'build', label: '做', title: 'F450 Pixhawk 實作', summary: '依 Pixhawk 2.4.8 版本完成 F450 組裝與調參，保留 AI 問答入口。' },
  { key: 'assess', label: '測', title: 'AI 組裝檢測與懸停評分', summary: '用照片或 30 秒影片進行組裝檢測與四面懸停評分。' },
  { key: 'certify', label: '證', title: 'GitHub 成果存證', summary: '將學習、實作、測試與反思整理到自己的 GitHub 倉庫。' }
];

export const youtubeVideos = providedYoutubeUrls.map((url, index) => ({
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

export const learningTracks = [
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

export const learningResources = learningTracks.flatMap((track) =>
  track.items.map((item) => ({ ...item, track: track.key, trackTitle: track.title }))
);

export const practiceResources = [
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

export const buildWorkflow = {
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

export const assessmentWorkflows = [
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
  return {
    mode: 'rag-gpt-voice-placeholder',
    topic,
    answer:
      'RAG 知識庫尚未接入。1.0 示範回答：請先確認 Pixhawk 箭頭朝向機頭，再檢查 GPS 羅盤、電源模組、接收機接線、馬達旋轉方向與 CW / CCW 槳葉是否和組裝規則一致。',
    voiceStatus: 'GPT 語音回答介面已預留，目前先用文字回覆；2.0 再接入即時語音與攝像頭糾錯。'
  };
}

export function simulatePropellerAssessment(fileName = 'propeller-check.jpg') {
  return {
    type: 'propeller-photo',
    engine: 'YOLOv8 placeholder',
    fileName,
    status: 'NEEDS_RECHECK',
    summary: '模擬檢測完成：四個槳葉均已識別，其中前右槳葉方向需要人工確認；飛控方向與電池固定建議再拍一張俯視圖。',
    detections: [
      { position: 'front-left', className: 'ccw_propeller', confidence: 0.91, result: 'PASS' },
      { position: 'front-right', className: 'cw_propeller', confidence: 0.62, result: 'NEEDS_RECHECK' },
      { position: 'rear-left', className: 'cw_propeller', confidence: 0.88, result: 'PASS' },
      { position: 'rear-right', className: 'ccw_propeller', confidence: 0.9, result: 'PASS' }
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
    teacherReview: '此分數為 AI 初評，最終結果需由線下老師複核。'
  };
}
