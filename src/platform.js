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
    { label: 'RAG 知識庫', state: '本機教材', detail: '作的階段只查詢 E 盤教材，不連接 OpenAI API。' }
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
    title: '鷹眼 AI 檢測中心',
    summary: '只保留 F450 槳葉正反及方向檢查、F450 四面懸停檢測兩個入口。',
    goal: '上傳 F450 照片或四面懸停影片，產生可複核的 PASS / NG / CHECK 結果。'
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

export const workflowSteps = [
  { key: 'learn', label: '學', title: '課程理解' },
  { key: 'practice', label: '練', title: '模擬練習' },
  { key: 'build', label: '作', title: '專案實作' },
  { key: 'assess', label: '測', title: 'AI 測評' },
  { key: 'certify', label: '證', title: '成果存證' }
];

export const missionStages = [
  {
    id: 'explore',
    title: '探索者 Explore',
    subtitle: '建立安全感與操控直覺',
    description: '從無人載具安全、模擬飛行到第一次 AI 測評，適合零基礎入門。',
    badge: 'Stage 1'
  },
  {
    id: 'build',
    title: '工程者 Build',
    subtitle: '完成 F450 工程系統',
    description: '把 F450、Pixhawk、Mission Planner 與工程檢查串成可實作的教學任務。',
    badge: 'Stage 2'
  },
  {
    id: 'ai',
    title: 'AI Engineer',
    subtitle: '建立資料與模型能力',
    description: '從標註、YOLO 目標檢測到 3D 與 AI 視覺應用，形成資料驅動能力。',
    badge: 'Stage 3'
  },
  {
    id: 'project',
    title: 'Project Engineer',
    subtitle: '完成行業與綜合專題',
    description: '以行業任務、飛行數據診斷與 Capstone 專題整合前面能力。',
    badge: 'Stage 4'
  }
];

const makeSection = (title, description, checklist = [], resources = []) => ({
  title,
  description,
  checklist,
  resources
});

export const missionTasks = [
  {
    id: 'M01',
    stage: 'explore',
    order: 1,
    title: '無人載具初體驗與安全',
    subtitle: '先建立安全規範、機體構成與基本飛行觀念',
    description: '讓新手知道無人機不是玩具，而是一套需要安全流程、空域意識與責任的系統。',
    difficulty: 'beginner',
    estimatedHours: 1.5,
    suitableFor: ['兒童', '零基礎', '高中', '高職'],
    status: 'recommended',
    learn: makeSection('學習', '觀看安全、空域、電池與基礎構造內容。', ['認識飛行安全距離', '理解槳葉與電池風險', '知道何時必須停機找老師']),
    practice: makeSection('練習', '用口頭問答和圖片辨識方式練習風險判斷。', ['辨識禁飛情境', '完成起飛前檢查口訣']),
    build: makeSection('實作', '完成一份無人載具安全檢查表。', ['填寫飛行前檢查表', '確認場地與人員安全']),
    assess: makeSection('測評', '用題庫或教師口試確認安全觀念。', ['安全題庫通過', '老師確認可進入模擬訓練']),
    certify: makeSection('存證', '保存安全任務單與第一次學習紀錄。', ['上傳安全檢查表', '整理學習照片'])
  },
  {
    id: 'M02',
    stage: 'explore',
    order: 2,
    title: '模擬飛行訓練',
    subtitle: '使用鳳凰模擬器建立起飛、懸停與降落手感',
    description: '把真機飛行前的高風險動作放到模擬器中反覆練習，降低實飛門檻。',
    difficulty: 'beginner',
    estimatedHours: 2,
    suitableFor: ['兒童', '零基礎', '高中', '高職'],
    status: 'recommended',
    learn: makeSection('學習', '理解鳳凰模擬器下載、安裝與遙控器設定方式。', ['聯繫管理員取得安裝包', '看懂模擬器場地與模型設定']),
    practice: makeSection('練習', '練習起飛、定點懸停、方向修正與降落。', ['完成 5 次穩定起飛', '完成 30 秒定點懸停', '完成安全降落']),
    build: makeSection('實作', '建立自己的模擬訓練紀錄。', ['記錄每日練習時間', '記錄最容易失誤的方向']),
    assess: makeSection('測評', '提交一段模擬器練習影片，由老師或 AI 入口初步評分。', ['影片清楚', '動作完整', '可看見控制過程']),
    certify: makeSection('存證', '保存模擬器練習截圖、影片與反思。', ['上傳練習影片', '寫下修正策略'])
  },
  {
    id: 'M03',
    stage: 'explore',
    order: 3,
    title: '飛行挑戰與 AI 測評',
    subtitle: '完成基礎飛行挑戰並理解 AI 評分結果',
    description: '把練習轉成可觀察的任務成果，開始理解 AI 如何協助教師做初判。',
    difficulty: 'beginner',
    estimatedHours: 2,
    suitableFor: ['兒童', '高中', '高職'],
    status: 'available',
    learn: makeSection('學習', '學習飛行挑戰規則與 AI 測評指標。', ['理解穩定度', '理解越界與方向控制']),
    practice: makeSection('練習', '用模擬器或安全小型機練習指定路線。', ['完成直線飛行', '完成定點懸停', '完成轉向']),
    build: makeSection('實作', '錄製一次完整飛行挑戰。', ['確認鏡頭穩定', '完整拍到任務區域']),
    assess: makeSection('AI 測評', '用影片上傳入口做初步穩定度與任務完成度判斷。', ['AI 初評分數', '教師人工確認']),
    certify: makeSection('成果認證', '保存挑戰影片與修正紀錄。', ['上傳影片', '整理失誤與改善'])
  },
  {
    id: 'M04',
    stage: 'build',
    order: 4,
    title: 'F450 工程組裝',
    subtitle: '從零完成一台 F450 開源四軸無人機',
    description: '完成機架、馬達、ESC、電源系統、電池與 CW / CCW 螺旋槳的基礎工程組裝。',
    difficulty: 'intermediate',
    estimatedHours: 3,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'in-progress',
    learn: makeSection('學習', '認識 F450 結構、馬達、ESC、電池與 CW / CCW 螺旋槳。', ['看懂機頭方向', '知道紅白機臂用途', '理解正反槳差異']),
    practice: makeSection('練習', '用圖片判斷 CW / CCW 與正反面。', ['辨識 CW 與 CCW', '判斷槳葉正反面', '認識四個馬達位置']),
    build: makeSection('實作', '完成 F450 機架、馬達、ESC、電源與槳葉安裝。', ['完成機架組裝', '安裝四顆馬達', '安裝 ESC', '完成電源連接', '安裝四個螺旋槳']),
    assess: makeSection('AI 測評', '上傳 F450 照片，由 YOLO 模型識別 CW / CCW、馬達、機臂與電池，再由規則引擎判斷是否需人工複核。', ['檢查槳葉', '檢查馬達', '檢查電池固定', '教師複核']),
    certify: makeSection('成果認證', '保存組裝照片、AI 檢測結果和最後完成成果。', ['上傳組裝照片', '保存 AI 報告', '整理 GitHub README'])
  },
  {
    id: 'M05',
    stage: 'build',
    order: 5,
    title: 'Pixhawk 飛控與接線',
    subtitle: '完成 Pixhawk 2.4.8 固定、接線與基礎校準',
    description: '把 F450 工程機接入 Pixhawk 2.4.8，完成飛控方向、GPS 羅盤、接收機與電源模組設定。',
    difficulty: 'intermediate',
    estimatedHours: 3,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'available',
    learn: makeSection('學習', '理解 Pixhawk 2.4.8 方向、接口與 Mission Planner 基礎。', ['飛控箭頭朝機頭', '理解 M1-M4', '理解 GPS 羅盤方向']),
    practice: makeSection('練習', '用接線圖練習辨識接口與常見錯誤。', ['辨識接收機接口', '辨識電源模組', '辨識 GPS 方向']),
    build: makeSection('實作', '完成飛控固定、接線、供電與拆槳馬達測試。', ['固定飛控', '接好 GPS', '接好接收機', '拆槳測試馬達']),
    assess: makeSection('AI 測評', '上傳接線照片，先做可見零件與方向提示，最終由老師確認。', ['照片清楚', '接口可辨識', '老師複核']),
    certify: makeSection('成果認證', '保存接線圖、照片與校準紀錄。', ['提交接線照片', '提交校準截圖'])
  },
  {
    id: 'M06',
    stage: 'build',
    order: 6,
    title: 'Mission Planner 航線任務',
    subtitle: '用地面站完成自主航線規劃與任務檢查',
    description: '學習 Mission Planner 的航點、起飛、返航與模擬任務流程。',
    difficulty: 'intermediate',
    estimatedHours: 2.5,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'available',
    learn: makeSection('學習', '學習 Mission Planner 介面、航點與基本飛行計畫。', ['認識 Takeoff', '認識 Waypoint', '認識 RTL']),
    practice: makeSection('練習', '在模擬環境中建立航線並檢查高度、速度與返航。', ['建立 3 個航點', '確認高度', '確認返航']),
    build: makeSection('實作', '完成一份可讀取與可重複執行的航線任務。', ['寫入航點', '讀回確認', '保存任務檔']),
    assess: makeSection('測評', '提交航線截圖與任務說明，由老師確認安全性。', ['航線清楚', '高度合理', '避開風險區']),
    certify: makeSection('存證', '把航線設定截圖與任務說明放入 GitHub。', ['上傳截圖', '上傳任務說明'])
  },
  {
    id: 'M07',
    stage: 'ai',
    order: 7,
    title: 'AI 目標檢測',
    subtitle: '建立 YOLO 資料集、標註流程與初版模型',
    description: '把 F450 照片轉成可訓練資料，學會標註、切分資料集、訓練與讀懂結果。',
    difficulty: 'intermediate',
    estimatedHours: 4,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'available',
    learn: makeSection('學習', '學習 YOLO、標註工具與資料集結構。', ['理解 images/labels', '理解 data.yaml', '理解 train/val']),
    practice: makeSection('練習', '用少量圖片練習框選槳葉、馬達、機臂與電池。', ['完成 50 張標註', '檢查類別一致', '匯出 YOLO 格式']),
    build: makeSection('實作', '訓練第一版 F450 零件偵測模型。', ['整理資料集', '啟動訓練', '保存 best.pt']),
    assess: makeSection('模型評估', '查看 precision、recall、mAP 與錯誤案例。', ['檢查混淆類別', '整理漏標案例']),
    certify: makeSection('存證', '提交 dataset、labels、模型結果與 README。', ['上傳資料集摘要', '上傳訓練結果'])
  },
  {
    id: 'M08',
    stage: 'ai',
    order: 8,
    title: '3D 數位工程',
    subtitle: '用 Fusion 360 / 3D 列印建立工程建模能力',
    description: '把 3D 課程和無人機零件、輔具或展示模型連起來。',
    difficulty: 'intermediate',
    estimatedHours: 4,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'optional',
    learn: makeSection('學習', '觀看 Fusion 360 與 3D 列印基礎影片。', ['理解草圖', '理解拉伸', '理解列印限制']),
    practice: makeSection('練習', '完成簡單零件草圖與尺寸標註。', ['畫出矩形/圓', '加上約束', '完成尺寸']),
    build: makeSection('實作', '設計一個無人機相關配件或展示件。', ['建立模型', '輸出檔案', '準備列印']),
    assess: makeSection('測評', '檢查尺寸、結構與列印可行性。', ['尺寸合理', '結構可用', '老師確認']),
    certify: makeSection('存證', '保存 3D 模型截圖、檔案與列印照片。', ['上傳模型', '上傳成品照'])
  },
  {
    id: 'M09',
    stage: 'ai',
    order: 9,
    title: 'AI 視覺無人機應用',
    subtitle: '把目標檢測能力放進無人機場景任務',
    description: '使用影像辨識與簡單規則，理解 AI 如何輔助巡檢、搜救或教學評分。',
    difficulty: 'advanced',
    estimatedHours: 4,
    suitableFor: ['高職', '大學', '成人'],
    status: 'optional',
    learn: makeSection('學習', '理解 AI 視覺任務、資料偏差與人工複核。', ['理解置信度', '理解誤判', '理解人工複核']),
    practice: makeSection('練習', '用不同角度圖片測試模型表現。', ['測正上方', '測側上方 45 度', '整理錯誤案例']),
    build: makeSection('實作', '建立一個 AI 視覺任務 Demo。', ['選擇任務', '整理輸入', '顯示結果']),
    assess: makeSection('測評', '比較模型在不同角度與光線下的表現。', ['記錄通過率', '記錄誤判']),
    certify: makeSection('存證', '保存 Demo、截圖、錯誤案例與改進建議。', ['上傳 Demo', '上傳報告'])
  },
  {
    id: 'M10',
    stage: 'project',
    order: 10,
    title: '行業應用任務',
    subtitle: '把無人機能力轉成巡檢、農業、搜救或城市案例',
    description: '讓學生選擇一個真實場景，拆成需求、資料、任務流程與成果展示。',
    difficulty: 'advanced',
    estimatedHours: 3,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'optional',
    learn: makeSection('學習', '理解行業需求與無人機任務邊界。', ['選擇應用場景', '理解安全與合規']),
    practice: makeSection('練習', '練習把場景拆成任務流程。', ['寫出任務目的', '列出需要資料']),
    build: makeSection('實作', '完成一份行業任務企劃。', ['任務流程', '資料需求', '評估方法']),
    assess: makeSection('測評', '由老師檢查任務是否合理、可行、安全。', ['可行性', '安全性', '成果可展示']),
    certify: makeSection('存證', '將企劃與展示素材放到 GitHub。', ['上傳企劃', '上傳展示圖'])
  },
  {
    id: 'M11',
    stage: 'project',
    order: 11,
    title: '飛行數據/黑匣子診斷',
    subtitle: '用飛控紀錄理解飛行狀態與錯誤原因',
    description: '從飛行日誌或黑匣子資料中找出異常，建立工程診斷思維。',
    difficulty: 'advanced',
    estimatedHours: 3,
    suitableFor: ['高職', '大學', '成人'],
    status: 'optional',
    learn: makeSection('學習', '認識飛行日誌、GPS、姿態與電源資料。', ['理解基本欄位', '理解異常訊號']),
    practice: makeSection('練習', '讀取範例日誌並找出可疑區段。', ['查看高度', '查看電壓', '查看姿態']),
    build: makeSection('實作', '完成一份飛行異常診斷報告。', ['描述現象', '提出原因', '提出改進']),
    assess: makeSection('測評', '老師檢查診斷邏輯與證據是否一致。', ['證據清楚', '推論合理']),
    certify: makeSection('存證', '保存日誌截圖、分析表與報告。', ['上傳報告', '上傳圖表'])
  },
  {
    id: 'M12',
    stage: 'project',
    order: 12,
    title: 'Capstone 綜合工程項目',
    subtitle: '整合飛行、工程、AI、3D 與成果發表',
    description: '完成一個可展示、可說明、可存證的 FDE-AI 綜合專題。',
    difficulty: 'advanced',
    estimatedHours: 6,
    suitableFor: ['高中', '高職', '大學', '成人'],
    status: 'optional',
    learn: makeSection('學習', '回顧前面任務，確認專題方向與成果格式。', ['選題', '訂目標', '確認成果規格']),
    practice: makeSection('練習', '練習簡報、Demo 與測試流程。', ['排練簡報', '測試 Demo']),
    build: makeSection('實作', '完成專題作品、展示影片與報告。', ['完成作品', '拍攝展示', '整理報告']),
    assess: makeSection('測評', '由 AI 初評與教師複核共同完成專題評估。', ['技術完成度', '展示清楚度', '安全與反思']),
    certify: makeSection('成果認證', '把程式、資料、模型、報告與影片整理成 GitHub Portfolio。', ['上傳 README', '上傳 code/data/models/report/media', '提交 Demo 影片'])
  }
];

export const missionPacks = missionTasks.map((task) => ({
  code: task.id,
  title: task.title,
  outcome: task.certify.title,
  focus: task.subtitle,
  status: task.status
}));

export const cohorts = [
  {
    id: 'cohort-001',
    name: 'FDE-AI 第一期',
    year: 2026,
    location: '台中',
    description: '第一期先以安全、模擬器、F450 工程、Mission Planner 與 AI 目標檢測建立 1.0 教學樣板。',
    learnedTasks: ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07'],
    youtubePlaylistUrl: 'https://www.youtube.com/channel/UCqKMXztPAsc2K6crQlKxzLg',
    showcaseVideos: [
      {
        phase: '01',
        title: '2026FDE-Ai無人載具人才孵化平台在職培訓01期',
        url: 'https://www.youtube.com/shorts/r6O-z1nxFfo'
      },
      {
        phase: '02',
        title: '2026FDE-Ai無人載具人才孵化在職培訓日誌',
        url: 'https://www.youtube.com/watch?v=G0M6rd3t9-4'
      },
      {
        phase: '03',
        title: '2026FDE-Ai無人載具人才孵化3d列印測繪小組日誌',
        url: 'https://www.youtube.com/watch?v=Nsv7kD52MnA'
      },
      {
        phase: '04',
        title: '結業啦！期待同學們前程似錦！',
        url: 'https://www.youtube.com/watch?v=YPpK_uQJTMg'
      },
      {
        phase: '05',
        title: '2026FDE_Ai無人載具在職培訓04期',
        url: 'https://www.youtube.com/watch?v=BVVj1zM4lU8'
      },
      {
        phase: '06',
        title: '2026FDE-Ai無人載具人才孵化在職培訓05期',
        url: 'https://www.youtube.com/watch?v=gW5HTVLLKJY'
      },
      {
        phase: '職前',
        title: '2026風電無人機巡檢ai應用職前教育（嘉義）',
        url: 'https://www.youtube.com/watch?v=oXK6lE6KFmI'
      }
    ],
    githubUrl: 'https://github.com/Elijahieee/fde-ai',
    coverImage: ''
  }
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
  assistantPrompt: '請描述你的組裝問題，系統會查詢 E 盤知識包整理出的本地 RAG；沒有教材命中時會提示補充資料。',
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

export const voiceAssistant = {
  locale: 'zh-TW',
  interactionMode: 'click-start-click-stop',
  ragFirst: true,
  knowledgeBaseDir: 'E:\\FDE_AI_Voice_RAG\\knowledge_base',
  endpoint: 'http://127.0.0.1:8765/api/voice/ask',
  healthEndpoint: 'http://127.0.0.1:8765/api/voice/health',
  controls: [
    { label: '開始語音提問', action: 'start' },
    { label: '停止', action: 'stop' }
  ],
  statuses: {
    idle: '待命：按一下開始語音提問',
    listening: '正在聽你說話，完成後按停止',
    searching: '正在先查 RAG 知識庫',
    answering: '正在產生台灣繁中回答',
    unsupported: '這個瀏覽器不支援語音辨識，請改用文字輸入'
  },
  safetyInstruction:
    '請使用台灣繁中回答；涉及槳葉、電池、通電、解鎖或實飛時，提醒學生停機檢查並請老師確認。'
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
    key: 'propeller-inspection',
    title: 'F450 槳葉正反及方向檢查',
    engine: 'YOLOv8 placeholder',
    acceptedEvidence: ['photo'],
    checks: ['槳葉 M1 = CCW', '槳葉 M2 = CCW', '槳葉 M3 = CW', '槳葉 M4 = CW', '錯誤項目交由 RAG 知識庫回答']
  },
  {
    key: 'hover-scoring',
    title: 'F450 四面懸停 AI 評分',
    engine: 'YOLOv8 hover scoring placeholder',
    acceptedEvidence: ['30-second-video'],
    checks: ['機頭朝前懸停', '機頭朝右懸停', '機頭朝後懸停', '機頭朝左懸停', '線下老師完成最終評分']
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
      mode: 'local-rag-only',
      sourceStatus: 'local-rag',
      topic,
      answer: `RAG 知識庫已優先命中本地資料：${sources.map((source) => source.title).join('、')}。${sources[0].content}`,
      sources: sources.map((source) => ({
        title: source.title,
        sourcePath: source.sourcePath,
        score: source.score
      })),
      voiceStatus: '本機 RAG 教材已命中；前端可用瀏覽器語音唸出回答。'
    };
  }

  return {
    mode: 'local-rag-only',
    sourceStatus: 'knowledge-missing',
    topic,
    answer:
      '本地 RAG 知識庫沒有找到足夠相近的內容。請把相關教材文字放進 E:\\FDE_AI_Voice_RAG\\knowledge_base，或補充對應的 .txt / .md 檔案後再詢問。',
    sources: [],
    voiceStatus: '目前為 RAG-only 模式，沒有連接 OpenAI API。'
  };
}

export function simulatePropellerAssessment(fileName = 'propeller-check.jpg') {
  return {
    type: 'propeller-photo',
    engine: 'YOLOv8 placeholder',
    fileName,
    status: 'NG',
    score: 82,
    teacherStatus: '待復核',
    summary: '模擬檢測完成：系統已依 F450 機頭方向比對 M1-M4 槳葉位置，錯誤項目會送入本機 RAG 知識庫產生修正建議。',
    detections: [
      { position: 'front-left', motor: 'M3', className: 'cw_propeller', confidence: 0.91, result: 'PASS' },
      { position: 'front-right', motor: 'M1', className: 'cw_propeller', confidence: 0.82, result: 'NG' },
      { position: 'rear-left', motor: 'M2', className: 'ccw_propeller', confidence: 0.88, result: 'PASS' },
      { position: 'rear-right', motor: 'M4', className: 'ccw_propeller', confidence: 0.9, result: 'NG' }
    ],
    motorChecks: [
      {
        motor: 'M3',
        position: '左前',
        detectedClass: 'cw_propeller',
        detectedDirection: 'CW',
        expectedClass: 'cw_propeller',
        expectedDirection: 'CW',
        bladeFace: 'CHECK',
        confidence: 0.91,
        errorCode: 'PASS',
        result: 'PASS'
      },
      {
        motor: 'M1',
        position: '右前',
        detectedClass: 'cw_propeller',
        detectedDirection: 'CW',
        expectedClass: 'ccw_propeller',
        expectedDirection: 'CCW',
        bladeFace: 'CHECK',
        confidence: 0.82,
        errorCode: 'DIRECTION_ERROR',
        result: 'NG'
      },
      {
        motor: 'M2',
        position: '左後',
        detectedClass: 'ccw_propeller',
        detectedDirection: 'CCW',
        expectedClass: 'ccw_propeller',
        expectedDirection: 'CCW',
        bladeFace: 'CHECK',
        confidence: 0.88,
        errorCode: 'PASS',
        result: 'PASS'
      },
      {
        motor: 'M4',
        position: '右後',
        detectedClass: 'ccw_propeller',
        detectedDirection: 'CCW',
        expectedClass: 'cw_propeller',
        expectedDirection: 'CW',
        bladeFace: 'CHECK',
        confidence: 0.9,
        errorCode: 'DIRECTION_ERROR',
        result: 'NG'
      }
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
