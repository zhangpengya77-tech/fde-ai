/*
 * FDE-AI 五大職業實訓課程｜結構化課程資料（2026-11-17）
 * - 首頁專區、課程總覽、五門課程詳情頁、職業飛手選課計算器都從這個檔案讀資料，不在頁面硬編碼。
 * - 之後教師後台若要維護課程介紹與圖片，只要改這份資料（或改由 API 提供同樣結構）。
 * - 同一份檔案同時給瀏覽器（window.FdePrograms）與 Node 測試（module.exports）使用。
 * - 時數規則：每天最多 7 小時（09:00–12:00、13:00–17:00，午休不計）；最後一天依實際時數提早結束。
 * - 用語原則：不寫保證就業、保證取證、政府認可或補助；資格類一律寫「依主管機關公告」。
 */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.FdePrograms = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_HOURS = 7;
  const SESSIONS = [
    { label: '上午', start: '09:00', end: '12:00', hours: 3 },
    { label: '下午', start: '13:00', end: '17:00', hours: 4 },
  ];

  /** 依總時數算出上課天數與最後一天時數 */
  function schedule(totalHours) {
    const days = Math.ceil(totalHours / DAY_HOURS);
    const lastDayHours = totalHours - DAY_HOURS * (days - 1);
    return { days, lastDayHours };
  }

  /** 某一天若只有 h 小時，算出下課時間（先上午 3 小時，再接下午） */
  function dayEndTime(h) {
    if (h <= 3) return `${String(9 + h).padStart(2, '0')}:00`;
    return `${13 + (h - 3)}:00`;
  }

  /** 把依序排列的階段（各有時數）切成每日課表：回傳 [{ day, hours, parts:[{stage, hours}] }] */
  function allocateDays(stages) {
    const days = [];
    let cur = null;
    for (const st of stages) {
      let left = st.hours;
      while (left > 0) {
        if (!cur || cur.hours === DAY_HOURS) { cur = { day: days.length + 1, hours: 0, parts: [] }; days.push(cur); }
        const take = Math.min(left, DAY_HOURS - cur.hours);
        cur.parts.push({ stage: st.title, hours: take });
        cur.hours += take; left -= take;
      }
    }
    return days;
  }

  // 職業飛手：共同基礎 28h＋每模組 20h；選滿 3 個以上加綜合考核 8h；超過 96 小時的部分為延伸訓練時數
  const PILOT = { baseHours: 28, moduleHours: 20, examHours: 8, examFrom: 3, standardCap: 96 };
  function pilotPlan(moduleCount) {
    const n = Math.max(0, Math.min(5, Math.floor(moduleCount)));
    const exam = n >= PILOT.examFrom ? PILOT.examHours : 0;
    const total = PILOT.baseHours + PILOT.moduleHours * n + exam;
    const extension = Math.max(0, total - PILOT.standardCap);
    return { modules: n, examHours: exam, totalHours: total, standardHours: total - extension, extensionHours: extension, ...schedule(total) };
  }

  const PENDING = '依實際公告';
  const AUTHORITY = '依主管機關公告';

  const programs = [
    // ───────────── 課程一 ─────────────
    {
      id: 'license', slug: 'drone-license', order: 1,
      title: '無人機證照考取專班',
      enTitle: 'Drone Pilot License Prep',
      // 2026-11-18 使用者指定：改為三種班別 7／21／35 小時（一日特訓班、三日專業基本級、五日專業高級證照 G1／G2／G3＋無人機日常維修）
      totalHours: 35, hoursLabel: '7／21／35 小時', daysLabel: '1／3／5 天（三種班別）',
      tagline: '模擬器＋實機飛行＋術科路線，系統化完成考照準備訓練。',
      positioning: '以模擬器、實機飛行與術科考照準備為主，建立正確的飛前檢查與安全飛行習慣。',
      audience: ['零基礎、想從頭學飛的人', '準備報考遙控無人機操作證的人', '想提升穩定操控能力的飛行者'],
      tags: ['法規與安全', '模擬器', '實機飛行', '術科路線', '飛前檢查 SOP'],
      formats: ['周末班', '常日班'],
      classSize: '開班人數依設備、場地、師資與安全條件而定，' + PENDING,
      // 三種班別（卡片與詳情頁依此顯示；每日細項沿用原課程內容，待教師確認）
      tiers: [
        { name: '一日特訓班', days: 1, hours: 7, items: ['法規與飛航安全重點', '模擬器基礎操控', '實機起降與定點懸停', '飛前檢查 SOP'] },
        { name: '三日專業基本級', days: 3, hours: 21, items: ['法規、安全與考照流程', '模擬器與基礎操控', '實機基礎飛行', '基本級術科路線強化與模擬考核'] },
        { name: '五日專業高級證照（G1／G2／G3）', days: 5, hours: 35, items: ['高級術科路線（依 G1／G2／G3 報考類別）', '路線節奏、修正技巧與錯誤動作分析', '無人機日常維修 🧰（機體、螺旋槳、電池與動力檢查保養）', '模擬考核與弱項強化'] },
      ],
      equipment: ['考照用多旋翼練習機', '遙控器', '飛行場與安全網／標線', '電池與充電安全設備'],
      software: ['FDE-AI 考照模擬器（瀏覽器版）', '電腦模擬飛行軟體'],
      outcomes: ['完成模擬器與實機訓練', '熟悉飛前檢查 SOP', '具備術科考照準備能力', '建立個人飛行訓練紀錄（存於 FDE-AI 學習成長日誌）'],
      careers: ['無人機操作助理', '飛行作業團隊助理', '銜接進階職業飛手培訓'],
      notes: ['本課程為「考照準備訓練」，是否通過考試依個人表現與主管機關規定；報考資格與考試規則' + AUTHORITY + '。'],
      platformLinks: [{ label: '考照模擬器', href: '/sim/app/?mode=exam&exam=0' }, { label: '學習成長日誌', href: '/student/growth/' }],
      art: 'license',
    },

    // ───────────── 課程二 ─────────────
    {
      id: 'seed', slug: 'seed-teacher', order: 2,
      title: 'FDE-AI 無人載具種子教師專案',
      enTitle: 'AI Unmanned Vehicle Seed Teacher Program',
      totalHours: 160,
      tagline: '操作、裝調、3D 建模、AI 視覺、產業實習與教學能力，一次培養跨領域種子教師。',
      positioning: '培養兼具無人載具操作、AI 應用、數位製造、產業認知與教學能力的跨領域種子教師。',
      audience: ['中小學與職校科技、資訊、自然領域教師', '想成為無人載具或 AI 課程講師的人', '社團指導老師與培訓機構教學人員'],
      tags: ['F450 裝調', '3D 建模列印', 'YOLO 視覺', '教案設計', '產業實習', '助教實習'],
      formats: ['周末班', '常日班'],
      minClass: 5,
      classSize: '5 人即可開班',
      stages: [
        { title: '無人載具基礎與飛行', hours: 14, items: ['飛行安全', '模擬器訓練', '飛行操作', '任務規劃'], art: 'simulator' },
        { title: 'F450 裝調檢修', hours: 28, items: ['機架與動力', '飛控安裝與調參', '故障排除', '維修與複測'], art: 'f450' },
        { title: '3D 建模與列印', hours: 21, items: ['Fusion 360', 'Blender', '結構建模', '零件列印'], art: 'cad' },
        { title: 'AI 視覺目標檢測', hours: 21, items: ['YOLO 原理與應用', '資料蒐集與標註', '模型訓練與應用'], art: 'ai' },
        { title: '產業應用與數位實訓平台', hours: 14, items: ['巡檢、測繪、農業應用', '數位孿生（開發中）', '學練做測證平台操作'], art: 'industry' },
        { title: '教案設計與教學能力', hours: 14, items: ['課程設計', '教材製作', '教學 SOP', '評量設計', '試講'], art: 'classroom' },
        { title: '無人機工廠產業實習', hours: 21, items: ['生產流程', '裝配作業', '檢測與品管'], art: 'factory', pending: '合作工廠與檔期：規劃安排，' + PENDING + '（依實際合作單位公告）' },
        { title: '真實課程助教實習', hours: 21, items: ['現場助教', '分組指導', '設備管理', '教學紀錄'], art: 'assistant', pending: '實習課程與檔期：規劃安排，' + PENDING },
        { title: '最終技術與教學考核', hours: 6, items: ['作品展示', '技術驗收', '教學評量'], art: 'exam' },
      ],
      mustKeep: '產業實習與助教實習為必修，不以一般課堂模擬完全取代。',
      equipment: ['F450 四旋翼套件與 Pixhawk 飛控', '3D 列印機', 'AI 運算電腦', '教學用投影與模擬器設備'],
      software: ['Mission Planner／QGroundControl', 'Fusion 360', 'Blender', 'YOLO（Ultralytics）與標註工具', 'FDE-AI 學練做測證平台'],
      outcomes: ['F450 組裝與調校作品', '3D 建模與列印作品', 'AI 視覺檢測成果', '教案、教材與教學 SOP', '工廠實習評價', '助教實習與帶教紀錄', '試講考核成果'],
      careers: ['無人載具實訓講師', '職業訓練助教', '校園科技社團指導', 'AI 與 3D 列印課程指導'],
      notes: ['種子教師專案 5 人即可開班；實際開班日期依報名狀況公告。'],
      platformLinks: [{ label: 'F450 數位孿生與接線實訓', href: '/f450-twin/' }, { label: '鷹眼 AI 檢測', href: './eagle' }],
      art: 'seed',
    },

    // ───────────── 課程三 ─────────────
    {
      id: 'pilot', slug: 'pro-pilot', order: 3,
      title: '專業無人機職業飛手專案',
      enTitle: 'Professional Drone Pilot Program',
      totalHours: null, hoursLabel: '48–96 小時（可選修）',
      tagline: '共同基礎＋產業模組選修，從會飛提升到能執行特定產業任務。',
      positioning: '從基本操作提升到執行特定產業任務：任務規劃、航線設計、實機作業與成果報告。',
      audience: ['已具基本飛行能力、想往產業任務發展的人', '巡檢、農業、測繪等相關從業人員', '想加入專業飛行團隊的人'],
      tags: ['任務規劃', 'Mission Planner／QGC', '巡檢', '植保', '測繪建模', '編隊（開發中）'],
      formats: ['周末班', '常日班', '可單獨加修模組'],
      classSize: '開班人數依設備、場地、師資與安全條件而定，' + PENDING,
      base: {
        title: '共同基礎', hours: PILOT.baseHours,
        items: ['職業飛行安全與風險評估', '任務規劃與航線設計', 'Mission Planner／QGC 操作', '模擬器任務訓練', '實機任務執行', '影像與任務資料採集', '作業紀錄與成果報告'],
        art: 'mission',
      },
      modules: [
        { code: 'A', title: '電力與設施巡檢', hours: 20, items: ['電塔、太陽能、建築設施巡檢', '巡檢航線設計', '影像採集', '異常識別'], art: 'inspection', jobs: ['巡檢飛手', '設備巡檢助理'] },
        { code: 'B', title: '農業植保', hours: 20, items: ['農業無人機認識', '噴灑任務規劃', '作業安全', '農田航線', '設備維護', '施作流程'], art: 'agri', jobs: ['農業無人機操作團隊', '農業技術服務助理'], regulated: true },
        { code: 'C', title: '高空清洗', hours: 20, items: ['建築外牆與高空設備清洗', '作業風險評估', '載荷控制', '地面安全管制', '清洗流程'], art: 'clean', jobs: ['高空清洗團隊', '無人機清洗作業助理'], regulated: true },
        { code: 'D', title: '航拍測繪與三維建模', hours: 20, items: ['航拍規劃', '影像採集', '攝影測量', 'WebODM', '正射影像', '三維模型'], art: 'mapping', jobs: ['測繪資料採集', '航拍建模助理'] },
        { code: 'E', title: '飛行表演與多機編隊', hours: 20, items: ['MAVLink 通訊', '主僚機觀念', '雙機 SITL 仿真', '同步航線', '編隊安全與異常應變', '表演編排'], art: 'formation', jobs: ['編隊技術助理', '表演團隊技術人員'], regulated: true, devStatus: '開發中：先以雙機仿真與安全驗證為主，不承諾大型商業燈光秀' },
      ],
      exam: { title: '綜合考核', hours: PILOT.examHours, note: '選修 3 個以上模組時加上 8 小時綜合考核；選 1～2 個模組時是否安排綜合考核' + PENDING + '。' },
      plans: [
        { label: '基礎＋1 個模組', modules: 1 },
        { label: '基礎＋2 個模組', modules: 2 },
        { label: '基礎＋3 個模組＋綜合考核', modules: 3 },
      ],
      equipment: ['任務用多旋翼', '巡檢與航拍相機', '農業與清洗作業設備（' + PENDING + '）', '地面站電腦'],
      software: ['Mission Planner', 'QGroundControl', 'WebODM', 'ArduPilot SITL'],
      outcomes: ['任務規劃與航線檔', '實機任務作業紀錄', '影像與任務資料成果', '任務成果報告'],
      careers: ['巡檢飛手', '設備巡檢助理', '農業無人機操作團隊', '農業技術服務助理', '高空清洗團隊', '無人機清洗作業助理', '測繪資料採集', '航拍建模助理', '編隊技術助理', '表演團隊技術人員'],
      qualificationNote: '從事農業噴灑、高空作業、飛行表演、多機編隊等作業所需的操作資格與許可，' + AUTHORITY + '；本課程只提供訓練，不代表取得任何資格。',
      notes: ['已完成共同基礎者，可再加修其他模組。', '選修 1～2 個模組的方案預設不含綜合考核，' + PENDING + '。'],
      platformLinks: [{ label: '仿真訓練', href: '/sim/' }, { label: '空域查詢', href: '/live/airspace/' }],
      art: 'pilot',
    },

    // ───────────── 課程四 ─────────────
    {
      id: 'rd', slug: 'rd-engineer', order: 4,
      title: '無人載具軟硬體研發工程師專案',
      enTitle: 'Unmanned Vehicle Hardware & Software R&D Engineer',
      totalHours: 320,
      tagline: '電路、PCB、結構、開源飛控、SITL、ROS 2、地面站二次開發到 AI 視覺，完整研發流程實作。',
      positioning: '從電路、PCB、結構設計、開源飛控到 AI 軟體、SITL、ROS 2、地面站二次開發與實際系統驗證。',
      audience: ['理工科系學生與畢業生', '想轉職無人載具研發的工程人員', '已有基礎、想系統化學習研發的人'],
      tags: ['KiCad PCB', 'Fusion 360', 'ArduPilot／PX4', 'SITL', 'ROS 2', 'QGC 二次開發', 'YOLO'],
      formats: ['常日班', '周末班'],
      classSize: '開班人數依設備、場地、師資與安全條件而定，' + PENDING,
      blocks: [
        { days: [1, 8], title: '電路與 PCB 開發', art: 'pcb', items: ['電學基礎與量測工具', '電路原理圖', 'KiCad PCB 設計', '焊接、配電與介面測試', '感測器整合', '故障檢測', 'PCB 階段驗收'] },
        { days: [9, 12], title: '結構設計與數位製造', art: 'cad', items: ['結構開發', 'Fusion 360／Blender', '3D 列印與裝配', '結構測試與優化'] },
        { days: [13, 18], title: 'AI 輔助開發、SITL 與 ROS 2', art: 'sitl', items: ['AI 輔助 Python 開發與 SITL 環境', 'SITL 與 QGC／Mission Planner 航線聯動', 'ROS 2 節點與遙測通訊', 'ROS 2 無人車 SLAM 與 Nav2 仿真', 'AI 視覺檢測與模擬任務聯動', '異常情境、AI 輔助除錯與綜合測試'] },
        { days: [19, 23], title: 'QGC 二次開發', art: 'gcs', items: ['Qt／QML 開發環境', 'QGC 原始碼編譯', '自訂遙測頁面', 'MAVLink 資料處理', 'AI 輔助開發、Git 版本管理與測試'] },
        { days: [24, 34], title: '開源飛控與多機型驗證', art: 'vtol', items: ['ArduPilot／PX4', 'Pixhawk／H743 飛控', 'MAVLink', '多旋翼 SITL 與實機測試', '固定翼結構、重心、舵面與飛行驗證', 'VTOL 垂直起降與過渡模式仿真', '跨機型綜合測試'] },
        { days: [35, 37], title: '無人車系統整合', art: 'rover', items: ['ROS 2 底盤控制', 'LiDAR SLAM', 'Nav2 自主導航', '避障、路徑規劃與故障排除'] },
        { days: [38, 39], title: '無人機測繪建模', art: 'mapping', items: ['測繪航線與影像採集', 'WebODM 三維重建', '正射影像與模型輸出'], note: '本階段已由無人船開發改為測繪建模。' },
        { days: [40, 46], title: 'AI 視覺與綜合工程專案', art: 'ai', items: ['YOLO 影像採集與標註', '模型訓練、部署與驗證', 'AI 與載具任務整合', '綜合工程專案設計', '系統測試與故障修正', '技術報告、程式碼與成果驗收'] },
      ],
      equipment: ['可調電源、三用電表、示波器、焊台', 'Pixhawk／H743 飛控', '多旋翼、固定翼、VTOL 機體', 'ROS 2 無人車（含 LiDAR）', '3D 列印機', 'AI 運算電腦'],
      software: ['KiCad', 'Fusion 360／Blender', 'ArduPilot／PX4 與 SITL', 'ROS 2（SLAM、Nav2）', 'Qt／QML 與 QGroundControl 原始碼', 'Mission Planner', 'WebODM', 'YOLO', 'Git'],
      outcomes: ['PCB 設計文件', '結構模型', '飛控參數檔', 'SITL 測試報告', 'ROS 2 專案', 'QGC 二次開發成果', '跨機型驗證紀錄', '測繪模型', '綜合工程作品集'],
      careers: ['無人載具研發助理工程師', '嵌入式系統工程技術人員', '飛控系統整合人員', '機器人軟體開發助理', 'AI 視覺應用工程技術人員'],
      notes: ['FDE-GCS 地面站、Gazebo 等模組目前為開發中／規劃中，課程中以實際可用版本教學。'],
      platformLinks: [{ label: 'AI PID 與濾波實驗室', href: '/pid-lab/' }, { label: '飛行健康 AI', href: '/flight-health/' }],
      art: 'rd',
    },

    // ───────────── 課程五 ─────────────
    {
      id: 'mro', slug: 'maintenance-engineer', order: 5,
      title: '無人載具裝調檢修與測試工程師專案',
      enTitle: 'Unmanned Vehicle Assembly, Maintenance & Test Engineer',
      totalHours: 160,
      tagline: '裝配、調校、檢測、故障診斷、維修、複測到品質驗收，培養現場技術人員。',
      positioning: '培養能完成裝配、調校、檢測、故障診斷、維修、複測與品質驗收的技術人員。與研發工程師專案不同，本課程以設備操作、硬體整合、維修與測試為主。',
      audience: ['想從事無人機裝配、維修、測試工作的人', '無人機門市、售後服務與技術支援人員', '職校機電、電子相關科系學生'],
      tags: ['F450 裝調', '故障診斷', '固定翼／VTOL', '無人車', '品質檢驗', '大型考照機'],
      formats: ['周末班', '常日班'],
      classSize: '開班人數依設備、場地、師資與安全條件而定，' + PENDING,
      days: [
        { title: '電學安全、工具與檢測規範', art: 'tools' },
        { title: 'F450 機架與動力裝配', art: 'f450' },
        { title: '配電、線束與電源測試', art: 'wiring' },
        { title: '飛控、感測器、接收機安裝與校準', art: 'fc' },
        { title: '無槳上電與地面檢查', art: 'checklist' },
        { title: '受控首飛與飛行測試', art: 'hover' },
        { title: '動力、電壓、振動故障診斷', art: 'diagnose' },
        { title: '維修、更換零件與複測', art: 'repair' },
        { title: '飛行日誌與健康分析', art: 'health' },
        { title: 'F450 裝調檢修 SOP', art: 'checklist' },
        { title: '固定翼、V 尾結構裝配', art: 'fixedwing' },
        { title: '舵面、重心與地面測試', art: 'fixedwing' },
        { title: '固定翼故障排查', art: 'diagnose' },
        { title: 'VTOL 結構與模式檢查', art: 'vtol' },
        { title: 'VTOL 故障診斷與維修', art: 'repair' },
        { title: '無人車底盤、動力與控制器', art: 'rover' },
        { title: '無人車感測器與功能測試', art: 'rover' },
        { title: '無人車故障診斷與維修', art: 'repair' },
        { title: '品質檢測與零件驗收', art: 'qc' },
        { title: '950 mm 以上大型考照機組裝', art: 'large' },
        { title: '大型機開源飛控整合與調校', art: 'fc' },
        { title: '大型機 SOP、機載電腦、熱成像、三軸雲台與 AI 模組整合', art: 'gimbal' },
        { title: '綜合考核、維修作品集與成果發表', art: 'exam' },
      ],
      groups: [
        { days: [1, 10], title: 'F450 多旋翼裝調檢修' },
        { days: [11, 15], title: '固定翼與 VTOL' },
        { days: [16, 18], title: '無人車' },
        { days: [19, 19], title: '品質檢測' },
        { days: [20, 22], title: '大型考照機專題' },
        { days: [23, 23], title: '綜合考核' },
      ],
      largeAircraft: {
        title: '大型考照機專題（D20–D22）',
        items: ['950 mm 以上機架', '動力、電調、配電與線束', 'Pixhawk／H743 飛控', 'ArduPilot／Mission Planner', '飛控校準、參數管理與失控保護', '飛前檢查與測試 SOP', '樹莓派 5 或 Jetson 系列機載電腦', '熱成像設備', '三軸雲台與舵機控制', 'AI 視覺目標檢測', '人物追蹤與雲台跟隨（須經當事人同意）', '電源、重量、散熱與系統安全檢查'],
        note: 'D22 為現成 AI 模組的安裝、調校與功能驗證，不要求從零開發 AI 模型；完整大型機驗收結合 D20–D23 的連續紀錄。',
      },
      boatNote: '無人船為本課程的擴展設備類型：說明推進、電源、控制、密封檢查與故障診斷基礎；目前 160 小時課表沒有單列無人船實訓日。',
      equipment: ['F450 套件與 Pixhawk 飛控', '固定翼（V 尾）與 VTOL 機體', '無人車底盤與感測器', '950 mm 以上大型考照機', '樹莓派 5 或 Jetson 機載電腦', '熱成像設備與三軸雲台', '電表、電源供應器、轉速與電流量測工具'],
      software: ['Mission Planner', 'ArduPilot', 'FDE-AI 飛行健康 AI（飛行日誌分析）', 'Betaflight Configurator'],
      outcomes: ['F450 裝調檢修紀錄', '固定翼與 VTOL 測試報告', '無人車維修紀錄', '飛行健康與故障診斷報告', '大型考照機 SOP 文件包', 'AI 模組與雲台整合測試紀錄', '設備履歷與維修作品集'],
      careers: ['無人載具裝配技術員', '無人機維修技術員', '設備測試技術員', '品質檢驗人員', '飛控調校技術人員', '售後維修與技術服務人員'],
      notes: ['影像追蹤相關操作須經當事人同意。'],
      platformLinks: [{ label: 'F450 數位孿生與接線模擬器', href: '/f450-twin/wiring.html' }, { label: '飛行健康 AI', href: '/flight-health/' }],
      art: 'mro',
    },
  ];

  // 衍生欄位：天數、最後一天時數、每日課表
  for (const p of programs) {
    if (p.id === 'pilot') {
      p.schedule = pilotPlan(3);
      continue;
    }
    p.schedule = schedule(p.totalHours);
    if (p.stages) p.daily = allocateDays(p.stages);
    if (p.blocks) {
      p.daily = [];
      for (const b of p.blocks) for (let d = b.days[0]; d <= b.days[1]; d++) p.daily.push({ day: d, hours: d === p.schedule.days ? p.schedule.lastDayHours : DAY_HOURS, parts: [{ stage: b.title, hours: d === p.schedule.days ? p.schedule.lastDayHours : DAY_HOURS }] });
      for (const b of p.blocks) b.hours = p.daily.filter((d) => d.day >= b.days[0] && d.day <= b.days[1]).reduce((s, d) => s + d.hours, 0);
    }
    if (p.days) {
      p.daily = p.days.map((d, i) => ({ day: i + 1, hours: i + 1 === p.schedule.days ? p.schedule.lastDayHours : DAY_HOURS, parts: [{ stage: d.title, hours: i + 1 === p.schedule.days ? p.schedule.lastDayHours : DAY_HOURS }] }));
    }
  }

  const home = {
    title: '五大職業實訓課程｜從考取證照到專業就業',
    intro: 'FDE-AI 以學、練、做、測、證為核心，提供無人機證照考取、AI 無人載具種子教師培育、職業飛手訓練、軟硬體研發及裝調檢修測試五大實訓課程，結合模擬器、真實設備、AI 技術與產業應用，培養具備實作能力的專業人才。',
  };

  const rules = {
    dayHours: DAY_HOURS,
    sessions: SESSIONS,
    lunch: '12:00–13:00 午休（不計時數）',
    lastDay: '最後一天不滿 7 小時時，依實際時數提早結束',
    formats: ['周末班', '常日班'],
  };

  return { programs, home, rules, schedule, allocateDays, dayEndTime, pilotPlan, PILOT, AUTHORITY, PENDING };
});
