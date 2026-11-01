/**
 * FDE Flight Health AI - 前端主控邏輯 (主站集成版)
 * 嚴格解耦環境、禁止離線自動進 Demo、真實驗證與 Demo 隔離
 */

const AppState = {
  currentStage: 1, // 1: 上傳, 2: 報告, 3: 回饋, 4: 結論, 5: 成長
  totalStages: 5,
  backendStatus: "checking", // "online" | "offline" | "unconfigured" | "checking"
  isDemoMode: false, // 嚴格規定：預設為 false，嚴禁離線自動進 Demo！
  flightSessionId: null,
  uploadedFile: null,
  isRunning: false, // 是否正在分析中（仅用于按钮 loading 态，不阻塞学员）
  aircraftName: "F450-01 一號機 (Quad-X)",
  trainingTask: "四面懸停訓練 (Hovering)",

  // 真實日誌分析結果
  diagnosisData: null,

  // V1.2：教師專業證據（/teacher-result 拉取，含 safety_events / raw_events）
  teacherEvidence: null,
  teacherEvidenceLoaded: false,

  // 飛手主觀體感
  pilotFeedback: {
    rating: "poor",
    symptoms: ["左右漂", "起飛容易翻"],
    phases: ["起飛", "懸停"],
    notes: "起飛時右邊下沉明顯，需手動大幅打桿補償"
  },

  // 關聯融合結果
  correlationResult: null,

  // 最終結論 (8項)
  finalConclusion: null,

  // 教師復核
  teacherReview: {
    status: "pending",
    teacherName: "王教官",
    notes: "已在現場觀察到右側 2 號馬達啟動延遲，更換電調與槳葉後進行低空懸停驗證。"
  }
};

// 獨立的標準 DEMO 數據包（與真實分析完全隔離）
// 格式與後端 /result 端點返回格式一致（student_view + ai_diagnosis）
const DEMO_PAYLOAD = {
  // ── 學員視圖（來自後端 student_view）──
  student_view: {
    overall_status: "danger",
    display_status: "危險，不建議飛行",
    main_finding: "檢測到危險項：02 馬達輸出（電機）。不建議飛行，請先排除並由老師確認。",
    next_action: "先處理紅色危險項，修好後重新飛一次並上傳新日誌確認。",
    health_cards: [
      {
        card_id: "battery",
        title: "01 電池與供電",
        subtitle: "電池電壓（每片電芯）＋飛控供電",
        critical: true,
        status: "NORMAL",
        display_status: "健康",
        metric: "最低 3.71V/片（3S 共 11.1V）· 第 182 秒 · 飛控 5.04V",
        main_finding: "電池電壓正常，帶載最低 3.71V/片。",
        next_action: "按標準飛前檢查繼續觀察。"
      },
      {
        card_id: "propulsion",
        title: "02 馬達輸出（電機）",
        subtitle: "四顆馬達輸出平衡、飽和、懸停油門",
        critical: true,
        status: "DANGER",
        display_status: "危險，不建議飛行",
        metric: "M1 1421 / M2 1666 / M3 1410 / M4 1430 · 差 256µs · 懸停油門 48%",
        main_finding: "四顆馬達輸出相差 256µs，M2 一直在多出力。",
        next_action: "拆槳檢查 M2：槳葉正反與裂痕、馬達軸與軸承、電調與焊點、馬達座是否歪斜，最後確認重心。"
      },
      {
        card_id: "vibration",
        title: "03 振動",
        subtitle: "機體振動與加速度計削頂",
        critical: true,
        status: "INSPECT",
        display_status: "需要檢查",
        metric: "最大 32.6 m/s² · 第 95 秒 · Clip +0",
        main_finding: "振動超過 30 m/s² 持續 1.4 秒（第 95 秒），建議處理後再飛。",
        next_action: "檢查飛控減震墊、槳葉動平衡與裂痕、馬達螺絲與機架是否鬆動。"
      },
      {
        card_id: "stability",
        title: "04 姿態追蹤",
        subtitle: "實際姿態 vs 飛控期望姿態",
        critical: true,
        status: "NORMAL",
        display_status: "健康",
        metric: "最大偏差 3.2° · 第 40 秒",
        main_finding: "姿態追蹤良好（最大偏差 3.2°）。",
        next_action: "按標準飛前檢查繼續觀察。"
      },
      {
        card_id: "events",
        title: "05 事件與失效保護",
        subtitle: "錯誤、失效保護、墜機、空中斷電",
        critical: true,
        status: "NORMAL",
        display_status: "健康",
        metric: "0 個錯誤事件",
        main_finding: "沒有失效保護、墜機或錯誤事件。",
        next_action: "按標準飛前檢查繼續觀察。"
      },
      {
        card_id: "gps",
        title: "06 GPS 定位",
        subtitle: "定位類型、衛星數、HDOP（看飛行模式）",
        critical: false,
        status: "NORMAL",
        display_status: "健康",
        metric: "最少 13 顆星 · HDOP 最高 0.9",
        main_finding: "GPS 定位穩定（最少 13 顆星）。",
        next_action: "按標準飛前檢查繼續觀察。"
      },
      {
        card_id: "compass",
        title: "07 羅盤／磁干擾",
        subtitle: "磁場強度與馬達電流干擾",
        critical: false,
        status: "NORMAL",
        display_status: "健康",
        metric: "磁場 448 mG · 磁干擾 12%",
        main_finding: "羅盤磁場正常。",
        next_action: "按標準飛前檢查繼續觀察。"
      },
      {
        card_id: "ekf",
        title: "08 EKF 位置估算",
        subtitle: "飛控「位置裁判」的方差",
        critical: false,
        status: "UNKNOWN",
        display_status: "未檢測",
        metric: "未檢測",
        main_finding: "本次日誌沒有 EKF 方差（XKF4/NKF4）紀錄，這一項未檢測。未檢測不代表正常。",
        missing_reason: "沒有 EKF 方差（XKF4/NKF4）紀錄",
        next_action: "下次飛行前確認飛控有記錄這項資料，再重新分析。"
      }
    ]
  },

  // ── AI 確定性診斷（來自後端 ai_diagnosis）──
  ai_diagnosis: {
    source: "deterministic_template",
    what_happened: "動力輸出命令分配不均，某一側持續偏高，飛機可能動力失衡。",
    plain_language: "飛機在動力分配上需要額外補償，先排除槳葉、馬達、電調、接線與重心問題。",
    log_evidence_summary: "日誌發現動力輸出命令分配不均；這不是馬達真實轉速。",
    pilot_feedback_summary: "尚未提交飛手反饋。",
    correlation_summary: "當前只有日誌證據，尚不能判斷飛手感受是否一致。",
    check_first: ["先檢查槳葉，再檢查馬達、電調、接線和重心。"],
    do_not_do: ["暫時不要自行修改飛控參數，也不要自動寫入飛控。"],
    next_test: ["完成檢查後進行一次短時間、低高度、可控環境復測並保留新日誌。"]
  },

  // ── DEMO 保留原始數據，僅供 Legacy 教師抽屜顯示（不暴露給學員 API）──
  _demo_raw: {
    overall_status: "inspect",
    health: {
      motors: {
        available: true,
        average_spread: 245.0,
        channels: {
          motor1: { average: 1420.5 },
          motor2: { average: 1665.5 },
          motor3: { average: 1410.2 },
          motor4: { average: 1430.0 }
        }
      },
      battery: { available: true, minimum_voltage: 11.42, average_voltage: 11.85 },
      gps: { available: true, best_fix: 3, worst_fix: 3, maximum_hdop: 0.85 },
      vibration: { available: true, maximum_x: 18.4, maximum_y: 22.1, maximum_z: 32.6, clip_growth: 0 }
    },
    diagnostics: [
      {
        rule_id: "MOT-001",
        category: "MOTOR",
        severity: "inspect",
        finding: "四路 Motor Command（電機輸出命令）明顯不均衡；這不是電機真實轉速。",
        evidence: [{ field: "motors.*.command", average_spread: 245.0 }]
      },
      {
        rule_id: "VIB-001",
        category: "VIBRATION",
        severity: "attention",
        finding: "Vibration（振動）數據在部分區段稍高。",
        evidence: [{ field: "vibration.xyz", maximum: 32.6 }]
      }
    ]
  }
};


// 頁面初始化
document.addEventListener("DOMContentLoaded", () => {
  renderStepper();
  setupEventListeners();
  checkServiceConnection();
  refreshFlightHealthState();
});

/**
 * 統一按鈕可用狀態：僅依「是否已選擇日誌」與「是否分析中」決定。
 * 不再依賴教師模型綁定 / 後端是否在線 —— 這正是本次修復的核心。
 */
function updateStartButtonState() {
  const btn = document.getElementById("start-analyze-btn");
  if (!btn) return;
  const canRun = !!AppState.uploadedFile && !AppState.isRunning;
  if (canRun) {
    btn.removeAttribute("disabled");
    btn.removeAttribute("title");
  } else {
    btn.setAttribute("disabled", "disabled");
    if (!AppState.uploadedFile) {
      btn.setAttribute("title", "請先上傳飛行日誌");
    } else if (AppState.isRunning) {
      btn.setAttribute("title", "正在分析中，請稍候");
    }
  }
}

/**
 * 診斷引擎狀態（非阻塞）：向統一引擎端點詢問當前生效引擎。
 * 失敗時靜默保留預設「系統標則規則」，絕不因此阻塞學員。
 */
async function refreshFlightHealthState() {
  const label = document.getElementById("flight-health-engine-status");
  if (!label) return;
  try {
    // engine-status 端点位于分析后端根路径（非 /api/v1 下）。
    // 页面由 :8111 同源提供，但 :8111 无此端点代理 → 必须直连分析后端（LAN 模式为 :8040）。
    const apiBase = window.FLIGHT_HEALTH_CONFIG?.getActiveApiBase();
    if (!apiBase) return; // 未配置：保留默认文案
    const rootBase = apiBase.replace(/\/api\/v1\/?$/, "");
    const resp = await fetch(`${rootBase}/api/flight-health/engine-status`);
    if (!resp.ok) throw new Error("bad status");
    const data = await resp.json();
    label.textContent = "診斷引擎：" + (data.display_name || "系統標準規則");
    label.classList.remove("engine-unknown");
    label.classList.add(
      data.teacher_model_active ? "engine-teacher" : "engine-builtin"
    );
  } catch (err) {
    // 失敗不阻塞學員：保留預設文案
    label.textContent = "診斷引擎：系統標準規則";
    label.classList.remove("engine-teacher");
    label.classList.add("engine-builtin");
  }
}

// 服務連線檢測（僅作「資訊提示」用途，絕不因此禁用分析按鈕或強制 DEMO）
async function checkServiceConnection() {
  const banner = document.getElementById("service-status-banner");
  if (!banner) {
    updateStartButtonState();
    return;
  }

  const apiBase = window.FLIGHT_HEALTH_CONFIG?.getActiveApiBase();

  // 1. 若生產環境尚未配置 API（屬部署設定問題，與「教師模型綁定」無關）
  if (!apiBase) {
    AppState.backendStatus = "unconfigured";
    banner.className = "status-banner unconfigured";
    banner.innerHTML = `
      <div>
        <strong>⚪ 飛行健康分析服務尚未配置</strong><br>
        <span style="font-size:11px;">正式環境 API 路由尚未設定（由部署人員配置）。您仍可上傳日誌，分析將在服務可用時進行。</span>
      </div>
      <div>
        <button type="button" class="btn-secondary" onclick="enterDemoMode()">查看 DEMO 演示</button>
      </div>
    `;
    updateStartButtonState();
    return;
  }

  // 2. 有配置 API，發起快速健康探針
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), window.FLIGHT_HEALTH_CONFIG.PROBE_TIMEOUT_MS || 2000);
    const resp = await fetch(`${apiBase}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (resp.ok) {
      AppState.backendStatus = "online";
      banner.className = "status-banner online";
      banner.innerHTML = `
        <div>
          <strong>🟢 飛行健康 AI 服務已連接</strong>
          <span style="font-size:11px; margin-left:6px; opacity:0.8;">(後端主機在線)</span>
        </div>
        <div>
          <button type="button" class="btn-secondary" style="font-size:11px;" onclick="enterDemoMode()">查看 DEMO 演示</button>
        </div>
      `;
    } else {
      throw new Error("HTTP not 200");
    }
  } catch (err) {
    // 3. 離線：僅資訊提示，不禁用按鈕、不強制 DEMO
    AppState.backendStatus = "offline";
    banner.className = "status-banner offline";
    banner.innerHTML = `
      <div>
        <strong>⚪ 飛行健康 AI 服務目前離線</strong><br>
        <span style="font-size:11px;">教師診斷主機尚未啟動。您仍可先上傳日誌，待主機恢復後點擊「開始自動健康檢查」。</span>
      </div>
      <div style="display:flex; gap:6px;">
        <button type="button" class="btn-secondary" style="font-size:11px;" onclick="checkServiceConnection()">重新檢測服務</button>
        <button type="button" class="btn-secondary" style="font-size:11px;" onclick="enterDemoMode()">查看 DEMO 演示</button>
      </div>
    `;
  }
  // 無論在線 / 離線，按鈕都依「已選日誌 + 非分析中」決定，絕不阻塞
  updateStartButtonState();
}

// 僅用於顯示「非阻塞」的資訊提示文字（不再禁用按鈕、不再要求 DEMO）
function showUploadHint(message) {
  const hint = document.getElementById("upload-hint-msg");
  if (hint) {
    hint.textContent = message ? `提示：${message}` : "";
    hint.style.display = message ? "block" : "none";
  }
}

// 主動進入 DEMO 模式
function enterDemoMode() {
  AppState.isDemoMode = true;
  AppState.diagnosisData = JSON.parse(JSON.stringify(DEMO_PAYLOAD));

  const demoBanner = document.getElementById("demo-top-banner");
  if (demoBanner) demoBanner.classList.remove("hidden");

  evaluateCorrelator();
  generateFinalConclusion();
  renderReportPage();
  renderGrowthCard();

  goToStage(2);
}

// 退出 DEMO 模式
function exitDemoMode() {
  AppState.isDemoMode = false;
  AppState.diagnosisData = null;

  const demoBanner = document.getElementById("demo-top-banner");
  if (demoBanner) demoBanner.classList.add("hidden");

  goToStage(1);
  checkServiceConnection();
}

// 步驟導航切換
function goToStage(stageNum) {
  if (stageNum < 1 || stageNum > AppState.totalStages) return;
  AppState.currentStage = stageNum;
  renderStepper();

  document.querySelectorAll(".stage-panel").forEach((panel) => {
    panel.classList.remove("active");
  });

  const target = document.getElementById(`stage-${stageNum}`);
  if (target) {
    target.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (stageNum === 2) renderReportPage();
  if (stageNum === 4) {
    renderCorrelatorBox();
    renderConclusionBox();
  }
  if (stageNum === 5) renderGrowthCard();
}

function renderStepper() {
  const container = document.getElementById("stepper-five");
  if (!container) return;

  const stages = [
    { num: 1, label: "① 上傳" },
    { num: 2, label: "② 報告" },
    { num: 3, label: "③ 回饋" },
    { num: 4, label: "④ 結論" },
    { num: 5, label: "⑤ 成長" }
  ];

  container.innerHTML = `
    <div class="stepper-connect-bar"></div>
    ${stages
      .map(
        (s) => `
      <button type="button" class="step-node ${s.num === AppState.currentStage ? "active" : ""} ${s.num < AppState.currentStage ? "done" : ""}" onclick="goToStage(${s.num})">
        <div class="step-num-circle">${s.num < AppState.currentStage ? "✓" : s.num}</div>
        <div class="step-node-text">${s.label}</div>
      </button>
    `
      )
      .join("")}
  `;
}

// 事件綁定
function setupEventListeners() {
  const dropzone = document.getElementById("upload-dropzone");
  const fileInput = document.getElementById("file-input");

  if (dropzone && fileInput) {
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) handleFile(e.target.files[0]);
    });
  }

  // 飛手評價按鈕
  document.querySelectorAll(".rating-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".rating-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      AppState.pilotFeedback.rating = btn.dataset.val;
    });
  });

  // 症狀晶片多選
  document.querySelectorAll("#symptom-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      const val = chip.textContent.trim();
      const idx = AppState.pilotFeedback.symptoms.indexOf(val);
      if (idx >= 0) AppState.pilotFeedback.symptoms.splice(idx, 1);
      else AppState.pilotFeedback.symptoms.push(val);
    });
  });

  // 階段晶片多選
  document.querySelectorAll("#phase-chips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      const val = chip.textContent.trim();
      const idx = AppState.pilotFeedback.phases.indexOf(val);
      if (idx >= 0) AppState.pilotFeedback.phases.splice(idx, 1);
      else AppState.pilotFeedback.phases.push(val);
    });
  });

  // 提交手感回饋
  const submitBtn = document.getElementById("submit-feedback-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      const notesEl = document.getElementById("pilot-notes-input");
      if (notesEl) AppState.pilotFeedback.notes = notesEl.value;
      saveFeedbackLocally();
      showFeedbackSavedHint();
      evaluateCorrelator();
      generateFinalConclusion();
      goToStage(4);
    });
  }

  // 教師審核標籤
  document.querySelectorAll(".review-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".review-tab-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      AppState.teacherReview.status = btn.dataset.status;
      renderGrowthCard();
    });
  });

  // 教師抽屜開關
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  const drawerCloseBtn = document.getElementById("drawer-close-btn");
  const openDrawerTopBtn = document.getElementById("open-drawer-top-btn");

  if (openDrawerTopBtn) openDrawerTopBtn.addEventListener("click", () => openDrawer());
  if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", () => closeDrawer());
  if (drawerBackdrop) {
    drawerBackdrop.addEventListener("click", (e) => {
      if (e.target === drawerBackdrop) closeDrawer();
    });
  }
}

function handleFile(file) {
  AppState.uploadedFile = file;
  const label = document.getElementById("selected-file-label");
  if (label) {
    label.textContent = `已選擇日誌：${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  }
  // 只要選了日誌就啟用按鈕（是否分析中由 AppState.isRunning 控制），不依賴後端在線或 DEMO
  updateStartButtonState();
  refreshFlightHealthState();
}

// 啟動真實日誌分析流程
async function startAnalysis() {
  const apiBase = window.FLIGHT_HEALTH_CONFIG?.getActiveApiBase();

  // CASE4：無日誌時禁用並提示（唯一會硬性擋下的條件）
  if (!AppState.uploadedFile) {
    alert("請先選擇或拖曳飛控日誌檔案 (.BIN / .LOG)。");
    return;
  }

  // 服務未配置（部署設定問題，與教師模型綁定無關）：如實告知，但不強制 DEMO
  if (!apiBase) {
    alert("飛行健康分析服務尚未配置 API 路由（請由部署人員設定）。設定完成前暫無法分析真實日誌；您可點擊上方「查看 DEMO 演示」預覽流程。");
    return;
  }

  // 注意：不再要求「後端在線」才能點擊。若主機真的離線，會在真實請求中拿到錯誤並如實回報，
  //       絕不以 DEMO 偽造分析結果。診斷引擎由後端統一解析（教師模型 → 否則內建規則引擎）。

  const dropBox = document.getElementById("upload-box-area");
  const analyzingBox = document.getElementById("analyzing-box-area");

  // 清除上次错误提示（若有）
  clearAnalysisError();

  // 進入分析中態：禁用按鈕（loading），分析結束再恢復
  AppState.isRunning = true;
  updateStartButtonState();
  dropBox.style.display = "none";
  analyzingBox.style.display = "block";

  try {
    // 1. 建立會話
    const sResp = await fetch(`${apiBase}/flights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aircraft_name: AppState.aircraftName,
        training_task: AppState.trainingTask
      })
    });
    if (!sResp.ok) throw new Error("會話建立失敗 (HTTP " + sResp.status + ")");
    const sData = await sResp.json();
    AppState.flightSessionId = sData.flight_id;

    // 2. 上傳日誌
    const formData = new FormData();
    formData.append("file", AppState.uploadedFile);
    const uResp = await fetch(`${apiBase}/flights/${AppState.flightSessionId}/log`, {
      method: "POST",
      body: formData
    });
    if (!uResp.ok) throw new Error("日誌上傳失敗 (HTTP " + uResp.status + ")");

    // 3. 觸發分析（後端統一解析引擎：教師模型 → 否則內建規則引擎，真實解析 .bin）
    const aResp = await fetch(`${apiBase}/flights/${AppState.flightSessionId}/analyze`, { method: "POST" });
    if (!aResp.ok) throw new Error("日誌分析處理失敗 (HTTP " + aResp.status + ")");

    // 4. 讀取學員安全結果（/result 端點：只含 student_view + ai_diagnosis，不含教師原始證據鏈）
    //    注意：教師專業視圖需透過 /teacher-result + X-FDE-Teacher-Mode: DEV-LOCAL 取得
    const dResp = await fetch(`${apiBase}/flights/${AppState.flightSessionId}/result`);
    if (!dResp.ok) throw new Error("分析結果讀取失敗 (HTTP " + dResp.status + ")");
    AppState.diagnosisData = await dResp.json();
    // V1.2：新架次 → 重置教師證據快取
    AppState.teacherEvidence = null;
    AppState.teacherEvidenceLoaded = false;


    // 成功分析真實數據
    AppState.isDemoMode = false;
    AppState.isRunning = false;
    updateStartButtonState();
    dropBox.style.display = "block";
    analyzingBox.style.display = "none";
    clearAnalysisError();

    evaluateCorrelator();
    generateFinalConclusion();
    goToStage(2);
  } catch (err) {
    // 嚴格規定：真實分析失敗時，顯示真實錯誤，禁止擅自以 Demo 數據冒充完成！
    AppState.isRunning = false;
    updateStartButtonState();
    dropBox.style.display = "block";
    analyzingBox.style.display = "none";

    // 網路層錯誤（TypeError: Failed to fetch）：連不上分析服務，給明確中文說明
    const isNetworkError = (err instanceof TypeError) || !err.message;
    const reason = isNetworkError
      ? "無法連接到飛行健康分析服務（網路連線失敗）。請確認分析服務已啟動，或點擊「重新檢測服務」後再重試。"
      : err.message;
    showAnalysisError(reason);
  }
}

// 分析失败内联提示（红色卡片 + 重试按钮，不再用 alert 阻断）
function showAnalysisError(message) {
  clearAnalysisError();
  const box = document.getElementById("upload-box-area");
  if (!box) return;
  const errBox = document.createElement("div");
  errBox.id = "analysis-error-box";
  errBox.style.cssText = "margin-top:12px; padding:12px 14px; border-radius:10px; background:rgba(255,90,90,.12); border:1px solid rgba(255,107,107,.45); color:#ff9d9d; font-size:13px; line-height:1.6;";
  const title = document.createElement("strong");
  title.textContent = "⚠️ 分析失敗";
  const text = document.createElement("p");
  text.textContent = message;
  text.style.margin = "6px 0 10px 0";
  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.className = "btn-primary";
  retryBtn.textContent = "🔄 重試分析";
  retryBtn.style.minHeight = "44px";
  retryBtn.onclick = () => startAnalysis();
  errBox.appendChild(title);
  errBox.appendChild(text);
  errBox.appendChild(retryBtn);
  box.appendChild(errBox);
}

function clearAnalysisError() {
  const errBox = document.getElementById("analysis-error-box");
  if (errBox) errBox.remove();
}

// 狀態對應輔助（統一四色語義：🟢通過 / 🟠需要檢查 / 🔴危險 / ⚪無法判斷）
function getStatusMeta(statusStr) {
  const key = String(statusStr ?? "").toUpperCase();
  switch (key) {
    case "NORMAL":
    case "PASS":
      return { icon: "🟢", label: "健康", cssClass: "status-normal" };
    case "ABNORMAL":
    case "NOTICE":
    case "ATTENTION":
    case "INFO":
    case "INSPECT":
    case "WARNING":
      return { icon: "🟠", label: "需要檢查", cssClass: "status-inspect" };
    case "STOP":
    case "CRITICAL":
    case "DANGER":
      return { icon: "🔴", label: "危險", cssClass: "status-stop" };
    case "UNKNOWN":
    case "UNASSESSED":
    case "INSUFFICIENT_DATA":
    default:
      return { icon: "⚪", label: "未檢測", cssClass: "status-unassessed" };
  }
}

// 渲染 ② 健康報告看板 (第一屏三問 + 四大卡)
// ⚠️ 本函式嚴格使用後端 student_view，禁止再讀取 data.health / data.diagnostics 等原始工程欄位
// 2026-10-16：第一屏三問與日誌基本資訊改為完全數據驅動（原先為硬編碼「動力不均衡」文案，
// 與真實八卡數據源不一致，教師已回報此矛盾）。
function renderReportPage() {
  const data = AppState.diagnosisData;
  if (!data) return;

  // 優先讀取後端 student_view；DEMO 模式也是同格式
  const sv = data.student_view;
  if (!sv) return;

  // 第一屏：整體健康狀態徽章
  const overallMeta = getStatusMetaFromEngine(sv.overall_status);
  const badgeEl = document.getElementById("hero-overall-badge");
  if (badgeEl) {
    badgeEl.className = `status-badge ${overallMeta.cssClass}`;
    badgeEl.innerHTML = `${overallMeta.icon} ${overallMeta.label}`;
  }

  // 第一屏：日誌基本資訊（來源檔案 / 解析訊息數 / 分析引擎）
  const logInfoEl = document.getElementById("hero-log-info");
  if (logInfoEl) {
    const parts = [];
    if (sv.source_file) parts.push(`日誌檔案：${sv.source_file}`);
    if (typeof sv.parsed_message_count === "number") {
      parts.push(`已解析 ${sv.parsed_message_count} 條飛控訊息`);
    }
    if (sv.engine_display) parts.push(`分析引擎：${sv.engine_display}`);
    logInfoEl.textContent = parts.join(" · ");
  }

  // 第一屏三問（數據驅動，嚴禁硬編碼）
  const q1El = document.getElementById("hero-q1-answer");
  if (q1El) {
    q1El.innerHTML = `總體狀態為 <strong>${sv.display_status || overallMeta.label}（${overallMeta.icon}）</strong>。`;
  }
  const q2El = document.getElementById("hero-q2-answer");
  if (q2El) {
    q2El.innerHTML = `<strong>${sv.main_finding || "暫無整體結論。"}</strong>`;
  }
  const q3El = document.getElementById("hero-q3-answer");
  if (q3El) {
    q3El.innerHTML = sv.next_action || "請由教師複核後確認下一步。";
  }

  // 八項健康卡：從後端 student_view.health_cards 讀取（固定順序 01→08，依實務優先順序）。
  // 2026-11-01 改版：依真實飛行日誌實務重排為
  //   battery 電池與供電 / propulsion 馬達輸出（電機）/ vibration 振動 / stability 姿態追蹤 /
  //   events 事件與失效保護 / gps GPS 定位 / compass 羅盤磁干擾 / ekf EKF 位置估算
  // 唯一權威映射：後端 builtin_rule_engine.CARD_DEFS 的 card_id → 前端 DOM 卡片 id。
  // 未知 card_id 於下方明確記錄，不靜默丟棄；後端沒提供的卡顯示 ⚪ 未檢測（不留白）。
  const cardIdMap = {
    battery: "battery-card",
    propulsion: "propulsion-card",
    vibration: "vibration-card",
    stability: "stability-card",
    events: "events-card",
    gps: "gps-card",
    compass: "compass-card",
    ekf: "ekf-card"
  };

  const cards = sv.health_cards || [];
  // 先把八張卡全部重置為「無資料」佔位，避免上一份報告殘留
  Object.values(cardIdMap).forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = "";
      delete el.dataset.status;
    }
  });
  cards.forEach((card) => {
    // 2026-10-17：先歸一化兩套已知後端契約的 card_id（沙箱 gps / 教師 positioning 等），
    // 再映射到 DOM 容器；未知 id 仍明確記錄，不靜默丟棄。
    const canonical = canonicalCardId(card.card_id);
    const htmlId = canonical ? cardIdMap[canonical] : null;
    if (!htmlId) {
      // 契約不符：未知 card_id 必須明確記錄（教師要求），不靜默丟棄。
      console.warn("[FlightHealth] 未知 card_id，卡片未渲染，請檢查後端契約：", card.card_id, card);
      return;
    }
    renderCardFromBackend(htmlId, card);
  });
  // 後端未提供的卡：明確顯示 ⚪ 未檢測，未檢測不代表正常
  Object.values(cardIdMap).forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.innerHTML.trim()) {
      el.dataset.status = "status-unassessed";
      el.innerHTML = `
        <div>
          <div class="card-top-row">
            <span class="card-title">${el.dataset.title || "健康檢查"}</span>
            <span class="status-badge status-unassessed">⚪ 未檢測</span>
          </div>
          <div class="card-finding-text">目前的分析引擎沒有提供這一項，未檢測不代表正常。</div>
        </div>`;
    }
  });

  // 本次飛行安全提醒（V1.2）：只顯示後端已核驗的 safety_alerts，無事件則整塊隱藏
  renderSafetyAlerts(sv.safety_alerts || []);
}

/**
 * 渲染「本次飛行安全提醒」區塊。
 * 規則：只呈現後端 student_view.safety_alerts（已核驗事件）；
 * 無事件時隱藏整個區塊；絕不斷言零件損壞。
 */
function renderSafetyAlerts(alerts) {
  const panel = document.getElementById("safety-alerts-panel");
  const list = document.getElementById("safety-alerts-list");
  if (!panel || !list) return;
  if (!Array.isArray(alerts) || alerts.length === 0) {
    panel.hidden = true;
    list.innerHTML = "";
    return;
  }
  list.innerHTML = alerts
    .map(
      (a) => `
      <div class="safety-alert-item">
        <div class="safety-alert-head">${a.title || ""}</div>
        <div class="safety-alert-hint">${a.hint || ""}</div>
      </div>`
    )
    .join("");
  panel.hidden = false;
}

/**
 * 保存學生手感問卷到本機（僅主觀感受，不含飛控原始資料）。
 * 使用 localStorage 獨立 key，不影響任何後端 / 教師資料。
 */
function saveFeedbackLocally() {
  try {
    const payload = {
      rating: AppState.pilotFeedback.rating || null,
      symptoms: AppState.pilotFeedback.symptoms || [],
      phases: AppState.pilotFeedback.phases || [],
      notes: AppState.pilotFeedback.notes || "",
      savedAt: new Date().toISOString(),
      sessionId: AppState.flightSessionId || null
    };
    localStorage.setItem("fde_pilot_feedback_v1", JSON.stringify(payload));
  } catch (err) {
    console.warn("手感問卷本機保存失敗（不影響分析）：", err);
  }
}

function showFeedbackSavedHint() {
  const hint = document.getElementById("feedback-save-hint");
  if (!hint) return;
  hint.hidden = false;
  setTimeout(() => {
    hint.hidden = true;
  }, 2600);
}

/**
 * 從後端 student_view.health_cards 單張卡資料渲染 HTML
 * status 使用後端枚舉值（normal / inspect / danger / unknown，兼容舊 EngineStatus 枚舉）
 * 2026-10-16：字段缺省兜底，杜絕卡片出現 undefined / 空白。
 */
function renderCardFromBackend(htmlId, card) {
  const el = document.getElementById(htmlId);
  if (!el) return;
  const meta = getStatusMetaFromEngine(card.status);
  // 必填顯示字段缺失 → 明確標示「結果字段缺失／待驗證」，並記錄卡片 ID 與缺失字段名（教師要求）。
  // 絕不把缺失字段直接插入頁面造成 undefined。
  const missingFields = [];
  if (!card.title) missingFields.push("title");
  if (!card.status) missingFields.push("status");
  if (!card.main_finding) missingFields.push("main_finding");
  if (!card.next_action) missingFields.push("next_action");
  if (missingFields.length) {
    console.warn(
      "[FlightHealth] 卡片必填字段缺失，已以「待驗證」佔位 → card_id=",
      card.card_id || htmlId,
      "缺字段=",
      missingFields
    );
  }
  const title = card.title || "健康檢查（結果字段缺失／待驗證）";
  const finding = card.main_finding || "⚠️ 結果字段缺失／待驗證：本卡未取得判定結論，請教師複核。";
  const next = card.next_action || "⚠️ 結果字段缺失／待驗證：請由教師複核確認下一步。";
  const missing = card.missing_reason
    ? `<div class="card-missing-reason">未檢測原因：${card.missing_reason}（未檢測不代表正常）</div>`
    : "";
  const subtitle = card.subtitle
    ? `<div class="card-subtitle">${card.critical ? '<span class="card-critical-tag">關鍵</span>' : ""}${card.subtitle}</div>`
    : "";
  const metric = card.metric ? `<div class="card-metric">📊 ${card.metric}</div>` : "";
  el.dataset.status = meta.cssClass;
  el.innerHTML = `
    <div>
      <div class="card-top-row">
        <span class="card-title">${title}</span>
        <span class="status-badge ${meta.cssClass}">${meta.icon} ${meta.label}</span>
      </div>
      ${subtitle}
      ${metric}
      <div class="card-finding-text">${finding}</div>
      ${missing}
      <div class="card-next-strip">👉 ${next}</div>
    </div>
    <button type="button" class="card-expand-btn" onclick="openDrawer('${title}')">
      查看專業資料 &gt;
    </button>
  `;
}

/**
 * 學員端統一四色語義（V1.0 簡化改版 + 2026-10-16 補齊內建引擎四色枚舉）：
 *   🟢 通過   (NORMAL)
 *   🟠 需要檢查 (NOTICE / ABNORMAL / INSPECT 非安全關鍵)
 *   🔴 危險   (stop / critical / DANGER)
 *   ⚪ 無法判斷 (INSUFFICIENT_DATA / UNKNOWN，絕不顯示為綠色)
 * 說明：後端內建規則引擎輸出 normal / inspect / danger / unknown 小寫枚舉，
 * 此前只認 EngineStatus 大寫枚舉，導致 inspect/danger 卡被誤顯灰色。
 */
function getStatusMetaFromEngine(engineStatus) {
  switch (String(engineStatus).toUpperCase()) {
    case "NORMAL":
    case "PASS":
      return { icon: "🟢", label: "健康", cssClass: "status-normal" };
    case "NOTICE":
    case "ABNORMAL":
    case "INSPECT":
    case "WARNING":
      return { icon: "🟠", label: "需要檢查", cssClass: "status-inspect" };
    case "STOP":
    case "CRITICAL":
    case "DANGER":
      return { icon: "🔴", label: "危險", cssClass: "status-stop" };
    case "INSUFFICIENT_DATA":
    case "UNKNOWN":
    default:
      return { icon: "⚪", label: "未檢測", cssClass: "status-unassessed" };
  }
}

/**
 * 舊版 determineStatus：已廢棄，保留供 Legacy 教師抽屜 / 成長記錄卡使用
 * 主報告頁面已全面改用 renderCardFromBackend + student_view
 * @deprecated 僅允許在 openDrawer / renderGrowthCard 中使用
 */
function determineStatus(subsystem) {
  const data = AppState.diagnosisData;
  // 優先讀取 student_view.health_cards
  const sv = data?.student_view;
  if (sv?.health_cards) {
    const subMap = { motors: "propulsion", battery: "battery", gps: "gps", vibration: "vibration" };
    const cardId = subMap[subsystem];
    const card = cardId ? sv.health_cards.find((c) => c.card_id === cardId) : null;
    if (card) {
      // 統一走 normalizeSeverity：同時相容舊枚舉（NORMAL/NOTICE/ABNORMAL/INSUFFICIENT_DATA）
      // 與後端現行枚舉（normal/inspect/danger/unknown）；避免真實日誌一律被誤判為 unassessed。
      return normalizeSeverity(card.status);
    }
  }
  // 無 student_view 時回退讀取 DEMO _demo_raw（僅限 DEMO 模式）
  const raw = data?._demo_raw;
  if (!raw?.health?.[subsystem]) return "unassessed";
  if (!raw.health[subsystem].available) return "unassessed";
  const rules = raw.diagnostics || [];
  const categoryMap = { motors: "MOTOR", battery: "BATTERY", gps: "GPS", vibration: "VIBRATION" };
  const cat = categoryMap[subsystem];
  if (cat) {
    const r = rules.find((i) => i.category === cat);
    return r ? r.severity : "normal";
  }
  return "normal";
}


function renderCard(id, title, statusStr, finding, plain, next) {
  const el = document.getElementById(id);
  if (!el) return;
  const meta = getStatusMeta(statusStr);

  el.innerHTML = `
    <div>
      <div class="card-top-row">
        <span class="card-title">${title}</span>
        <span class="status-badge ${meta.cssClass}">${meta.icon} ${meta.label}</span>
      </div>
      <div class="card-finding-text">${finding}</div>
      <div class="card-plain-text"><strong>大白話：</strong>${plain}</div>
      <div class="card-next-strip">👉 先查：${next}</div>
    </div>
    <button type="button" class="card-expand-btn" onclick="openDrawer('${title}')">
      查看專業資料 >
    </button>
  `;
}

// 狀態枚舉正規化：內建引擎（normal/inspect/danger/unknown）與舊 EngineStatus
// （NORMAL/NOTICE/ABNORMAL/STOP/CRITICAL/INSUFFICIENT_DATA）統一為四色語義。
function normalizeSeverity(statusStr) {
  switch (String(statusStr || "").toUpperCase()) {
    case "NORMAL":
    case "PASS":
      return "normal";
    case "NOTICE":
    case "ABNORMAL":
    case "INSPECT":
    case "WARNING":
      return "inspect";
    case "STOP":
    case "CRITICAL":
    case "DANGER":
      return "danger";
    default:
      return "unknown";
  }
}

// ── 2026-10-17 P0 修復：已知兩套後端契約的 card_id 歸一化 ──────────────────────
// 沙箱內建引擎 / 參考後端（本倉，2026-11-01 改版）使用：battery|propulsion|vibration|stability|events|gps|compass|ekf
// 教師正式診斷主機（:8040，D:\FDE-Flight-Health-AI）使用：propulsion|battery|positioning|stability|rc_signal|flight_mode|altitude_control|sensors
// 教師主機若仍送舊卡（rc_signal / flight_mode / altitude_control / sensors），這些不在新八卡內：
//   console 明確記錄，對應新卡位顯示 ⚪ 未檢測，待教師主機同步新八卡契約。
// 兩套命名皆為「已知且刻意的契約」，此處僅做顯式橋接（非雙 key 掩蓋漂移）：
//   未知 id 仍回傳 null 並明確記錄，不靜默丟棄。
const CARD_ID_CANONICAL = {
  battery: "battery",
  propulsion: "propulsion",
  vibration: "vibration",
  stability: "stability",
  events: "events",
  gps: "gps",
  positioning: "gps",
  compass: "compass",
  ekf: "ekf",
};

function canonicalCardId(rawId) {
  if (!rawId) return null;
  return CARD_ID_CANONICAL[String(rawId)] || null;
}

// 關聯層融合計算（2026-10-16 重寫：數據驅動，杜絕硬編碼結論）
// P0-5 要求：日誌證實事實 / 學員主觀感受 / AI 推斷建議 / 待教師確認事項 四類分開呈現；
// 學員感受不得直接當成已證實故障；日誌與感受矛盾時顯示「需進一步確認」；
// 數據不足（卡片 UNKNOWN）時絕不聲稱方向一致。
function evaluateCorrelator() {
  const sv = (AppState.diagnosisData && AppState.diagnosisData.student_view) || {};
  const cards = sv.health_cards || [];
  const symptoms = AppState.pilotFeedback.symptoms || [];
  const notes = AppState.pilotFeedback.notes || "";

  const statusOf = (cid) => {
    const c = cards.find((x) => x.card_id === cid);
    return c ? normalizeSeverity(c.status) : "unknown";
  };
  const cardOf = (cid) => cards.find((x) => x.card_id === cid) || null;
  const motorSev = statusOf("propulsion");
  const gpsSev = statusOf("gps");
  const hasMotorIssue = symptoms.some((s) => ["左右漂", "起飛容易翻", "油門很大但飛不起來"].includes(s));
  const hasGpsIssue = symptoms.some((s) => s.includes("GPS"));
  const knownCards = cards.filter((c) => normalizeSeverity(c.status) !== "unknown");
  const allUnknown = cards.length > 0 && knownCards.length === 0;

  // 數據不足：不得聲稱方向一致，明確標記待進一步確認
  if (allUnknown) {
    AppState.correlationResult = {
      statusTag: '<span style="color:#94a3b8;">⚪ 日誌數據不足，需進一步確認 (insufficient_data)</span>',
      logFact: sv.main_finding || "本次日誌未能解析出足夠的判定數據。",
      pilotFeeling: notes || symptoms.join("、") || "尚未提交飛手回饋。",
      isConsistent: "目前日誌證據不足，無法確認日誌與飛手感受是否一致，請教師複核。",
      nextSuggestion: "補齊完整飛行日誌後重新分析，或由教師結合專業資料層判斷。"
    };
    return;
  }

  // 日誌證實動力異常 + 學員有對應感受 → 方向一致（證據來自真實卡數據）
  if (hasMotorIssue && (motorSev === "inspect" || motorSev === "danger")) {
    const c = cardOf("propulsion");
    AppState.correlationResult = {
      statusTag: '<span style="color:#35e6a8;">🟢 日誌與飛手感受方向一致 (aligned)</span>',
      logFact: c ? c.main_finding : "動力健康卡顯示輸出不均衡。",
      pilotFeeling: notes || symptoms.join("、"),
      isConsistent: "日誌證據與飛手感受方向一致，但仍屬「需檢查」級別，先排除硬體再復飛。",
      nextSuggestion: (c && c.next_action) || "先檢查槳葉，再檢查馬達、電調、接線和重心。"
    };
    return;
  }

  // 學員說動力問題但日誌正常 → 需進一步確認（不得當成已證實故障）
  if (hasMotorIssue && motorSev === "normal") {
    AppState.correlationResult = {
      statusTag: '<span style="color:#f5b84b;">🟡 飛手有感受，日誌未見對應異常 (not_confirmed)</span>',
      logFact: cardOf("propulsion") ? cardOf("propulsion").main_finding : "動力輸出命令均衡。",
      pilotFeeling: notes || symptoms.join("、"),
      isConsistent: "日誌中未發現與感受對應的異常證據，需進一步確認（可能為操作習慣或外界因素）。",
      nextSuggestion: "換時段復飛並記錄日誌比對；必要時請教師複核查看原始證據。"
    };
    return;
  }

  // GPS 同理：感受與日誌證據分兩種走向
  if (hasGpsIssue && (gpsSev === "inspect" || gpsSev === "danger")) {
    const c = cardOf("gps");
    AppState.correlationResult = {
      statusTag: '<span style="color:#35e6a8;">🟢 日誌與飛手感受方向一致 (aligned)</span>',
      logFact: c ? c.main_finding : "定位健康卡顯示異常。",
      pilotFeeling: notes || symptoms.join("、"),
      isConsistent: "日誌證據與飛手感受方向一致。",
      nextSuggestion: (c && c.next_action) || "到開闊區域複測，並由教師查看定位證據。"
    };
    return;
  }
  if (hasGpsIssue && gpsSev === "normal") {
    AppState.correlationResult = {
      statusTag: '<span style="color:#f5b84b;">🟡 飛手有感受，但日誌證據不足 (not_confirmed)</span>',
      logFact: cardOf("gps") ? cardOf("gps").main_finding : "GPS 數據未見異常。",
      pilotFeeling: notes || symptoms.join("、"),
      isConsistent: "日誌中目前未發現足夠證據確認 GPS 異常，需進一步確認。",
      nextSuggestion: "下一次重點在無風空曠處觀察 Loiter 模式，重新記錄並比對新日誌。"
    };
    return;
  }

  // 無對應感受：僅在有真實數據時才可稱「平穩一致」
  AppState.correlationResult = {
    statusTag: '<span style="color:#35e6a8;">🟢 數據方向平穩一致 (aligned)</span>',
    logFact: sv.main_finding || "各項遙測指標未觸發異常規則。",
    pilotFeeling: notes || "手感回饋基本正常。",
    isConsistent: "主客觀方向一致。",
    nextSuggestion: sv.next_action || "保持良好飛行規範，可開展下一個訓練科目。"
  };
}

function renderCorrelatorBox() {
  const cr = AppState.correlationResult;
  if (!cr) return;

  const box = document.getElementById("correlator-four-blocks");
  if (!box) return;

  box.innerHTML = `
    <div style="font-size:14px; font-weight:800; margin-bottom:8px;">判定結果：${cr.statusTag}</div>
    <div class="corr-sub-card">
      <div class="corr-sub-title">📋 1. 日誌看到什麼</div>
      <div class="corr-sub-content">${cr.logFact}</div>
    </div>
    <div class="corr-sub-card">
      <div class="corr-sub-title">🙋 2. 飛手感覺什麼</div>
      <div class="corr-sub-content">${cr.pilotFeeling}</div>
    </div>
    <div class="corr-sub-card">
      <div class="corr-sub-title">⚖️ 3. 兩者是否一致</div>
      <div class="corr-sub-content">${cr.isConsistent}</div>
    </div>
    <div class="corr-sub-card">
      <div class="corr-sub-title">🛠️ 4. 下一步建議</div>
      <div class="corr-sub-content">${cr.nextSuggestion}</div>
    </div>
  `;
}

// 產生本次最終飛行結論 (8項) — 2026-10-16 重寫：完全由真實分析結果生成
// P0-5 四類可信度分區：
//   1-3 欄 = 日誌證實事實（來自後端健康卡真實判定）
//   4 欄 = 學員主觀感受（明示為感受，非證實故障）
//   5 欄 = 綜合判斷（AI 推斷建議，不得覆蓋規則引擎安全判定）
//   6-8 欄 = 下一步與複測（待教師確認事項以文字明示）
function generateFinalConclusion() {
  const sv = (AppState.diagnosisData && AppState.diagnosisData.student_view) || {};
  const cards = sv.health_cards || [];
  const feedback = AppState.pilotFeedback || {};
  const notes = feedback.notes || "";
  const symptoms = (feedback.symptoms || []).join("、");

  const dangerCards = cards.filter((c) => normalizeSeverity(c.status) === "danger");
  const inspectCards = cards.filter((c) => normalizeSeverity(c.status) === "inspect");
  const unknownCards = cards.filter((c) => normalizeSeverity(c.status) === "unknown");
  const problemCards = dangerCards.concat(inspectCards);
  const worst = dangerCards.length ? dangerCards[0] : (inspectCards.length ? inspectCards[0] : null);

  let what, plain, logEvidence, synthesis, steps, doNot, nextTest, pending;

  if (problemCards.length) {
    // 有日誌證實的異常卡 → 結論建立在真實證據上
    what = problemCards.map((c) => c.main_finding).join("；");
    plain = worst
      ? `${worst.title}出現${worst.status === "danger" ? "危險" : "需要檢查"}的變化，屬於日誌已記錄的客觀數據，先按提示排查硬體。`
      : "日誌已記錄需要關注的變化。";
    logEvidence = problemCards
      .map((c) => `【${c.title}】${c.main_finding}`)
      .join("\n");
    const feeling = notes || symptoms || "未提交具體感受。";
    synthesis = `【綜合判斷】日誌證實 ${problemCards.length} 項需要關注；學員主觀感受：「${feeling}」。建議先處理日誌記錄的異常項，再結合感受複測。`;
    steps = problemCards.map((c) => `${c.title}：${c.next_action}`);
    doNot = "❌ 暫不要先修改飛控參數！硬體物理問題無法透過軟體參數解決。";
    nextTest = "完成排查後進行 10 秒低空懸停，重新上傳新日誌比對。";
    pending = unknownCards.length
      ? `待教師確認：${unknownCards.map((c) => c.title).join("、")} 因數據不足暫無法判斷。`
      : "";
  } else if (unknownCards.length) {
    // 全部/部分無法判斷 → 明示待教師確認，絕不偽造結論
    what = "本次日誌未能解析出足夠的判定數據，八項健康卡暫無法完整判斷。";
    plain = "日誌數據不足，系統不會猜測飛機狀態，這份報告需要教師複核後才可作為飛行許可依據。";
    logEvidence = sv.main_finding || "未能從日誌解析出任何有效數據。";
    const feeling = notes || symptoms || "未提交具體感受。";
    synthesis = `【綜合判斷】日誌證據不足（待教師確認）；學員主觀感受：「${feeling}」。當前不構成任何安全結論。`;
    steps = ["聯繫教師確認日誌完整性與分析結果。", "如日誌完整則排查上傳流程或分析服務。"].concat(
      unknownCards.map((c) => `${c.title}：${c.missing_reason || "缺少必要數據"}`)
    );
    doNot = "❌ 在教師複核前，不要僅憑本報告判斷飛機適航性。";
    nextTest = "補齊完整日誌後重新分析。";
    pending = "待教師確認：全部八項健康卡均缺少可判定數據。";
  } else {
    // 全部正常
    what = "各項健康檢查均未發現異常。";
    plain = "本次飛行各項指標平穩，未觸發任何需要關注的規則。";
    logEvidence = sv.main_finding || "各項遙測指標未觸發異常規則。";
    const feeling = notes || symptoms || "手感回饋正常。";
    // P0-5：日誌正常但學員回饋有對應症狀時，兩者矛盾 → 顯示「需進一步確認」，
    //        不得把「日誌未見異常」說成已排除學員感受（感受未被日誌證實）。
    const contradicting = AppState.correlationResult
      && String(AppState.correlationResult.statusTag || "").includes("not_confirmed");
    synthesis = contradicting
      ? `【綜合判斷】日誌未見異常（日誌證實）；學員主觀感受：「${feeling}」。兩者存在差異，該感受未被日誌證實，需進一步確認。`
      : `【綜合判斷】日誌未見異常（日誌證實）；學員主觀感受：「${feeling}」。`;
    steps = ["按標準飛前檢查繼續下一階段訓練。"];
    doNot = "❌ 即使日誌正常，仍需遵守帶班教官的現場複核。";
    nextTest = "可開展下一個訓練科目，並持續記錄飛行日誌。";
    pending = contradicting
      ? "待教師確認：學員回饋與日誌結果存在差異，需教師複核原始證據後再決定下一步。"
      : "";
  }

  AppState.finalConclusion = { what, plain, logEvidence, pilotFeeling: notes || symptoms || "未提交具體感受。", synthesis, steps, doNot, nextTest, pending };
}

function renderConclusionBox() {
  const c = AppState.finalConclusion;
  if (!c) return;

  const box = document.getElementById("conclusion-eight-fields");
  if (!box) return;

  box.innerHTML = `
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">1. 發生什麼</div>
      <div class="conclusion-item-body">${c.what}</div>
    </div>
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">2. 大白話解釋</div>
      <div class="conclusion-item-body">${c.plain}</div>
    </div>
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">3. 日誌證據</div>
      <div class="conclusion-item-body">${c.logEvidence}</div>
    </div>
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">4. 飛手感受（主觀）</div>
      <div class="conclusion-item-body">${c.pilotFeeling}</div>
    </div>
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">5. 綜合判斷（AI 推斷建議）</div>
      <div class="conclusion-item-body">${c.synthesis}</div>
    </div>
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">6. 建議先檢查（依序排查）</div>
      <div style="font-size:13px; line-height:1.5;">
        ${c.steps.map((s) => `<div>${s}</div>`).join("")}
      </div>
    </div>
    ${c.pending ? `<div class="alert-do-not" style="background:rgba(148,163,184,.14); border-color:rgba(148,163,184,.4); color:#cbd5e1;">⏳ ${c.pending}</div>` : ""}
    <div class="alert-do-not">${c.doNot}</div>
    <div class="conclusion-item-row">
      <div class="conclusion-item-label">8. 下一次建議測試</div>
      <div class="conclusion-item-body">${c.nextTest}</div>
    </div>
  `;
}

// AI 飛行助教 (8部曲) — 2026-10-16 改為數據驅動：
// 嚴禁硬編碼故障故事（對健康日誌仍稱「2號馬達偏高」＝謊報）。
// 全部答案取自本次真實分析結果與學員回饋。
function askAI(presetQ) {
  const inputEl = document.getElementById("ai-input-text");
  const q = presetQ || (inputEl ? inputEl.value.trim() : "");
  if (!q) return;

  const ansBox = document.getElementById("ai-answer-panel");
  if (!ansBox) return;

  const sv = (AppState.diagnosisData && AppState.diagnosisData.student_view) || {};
  const cards = sv.health_cards || [];
  const problemCards = cards.filter((c) => normalizeSeverity(c.status) === "danger" || normalizeSeverity(c.status) === "inspect");
  const unknownCards = cards.filter((c) => normalizeSeverity(c.status) === "unknown");
  const feeling = (AppState.pilotFeedback && (AppState.pilotFeedback.notes || (AppState.pilotFeedback.symptoms || []).join("、"))) || "尚未提交飛行感受";
  const cr = AppState.correlationResult || {};

  const statusLine = sv.main_finding || "本次日誌未能解析出足夠的判定數據。";
  const problemLine = problemCards.length
    ? problemCards.map((c) => `${c.title}：${c.main_finding}`).join("；")
    : "各項遙測指標均未觸發異常規則。";
  const pendingLine = unknownCards.length
    ? `另有 ${unknownCards.length} 項健康卡因數據不足無法判斷（${unknownCards.map((c) => c.title).join("、")}），需教師複核。`
    : "";
  const alignLine = cr.isConsistent || "尚未提交飛行感受，無法比對。";
  const stepsLine = problemCards.length
    ? problemCards.map((c, i) => `${i + 1}. ${c.title}：${c.next_action}`).join("<br/>")
    : "按標準飛前檢查繼續下一階段訓練。";

  ansBox.innerHTML = `
    <div style="font-weight:800; margin-bottom:8px;">❓ 諮詢問題：${q}</div>
    <div class="ai-step-item"><span class="ai-step-name">1. 現在發生什麼：</span> ${statusLine}</div>
    <div class="ai-step-item"><span class="ai-step-name">2. 大白話是什麼意思：</span> ${sv.display_status ? `整體判定為「${sv.display_status}」。` : "日誌數據不足，系統不會猜測飛機狀態。"}</div>
    <div class="ai-step-item"><span class="ai-step-name">3. 日誌看到什麼：</span> ${problemLine}</div>
    <div class="ai-step-item"><span class="ai-step-name">4. 你的飛行感受是什麼：</span> ${feeling}</div>
    <div class="ai-step-item"><span class="ai-step-name">5. 兩者是否一致：</span> ${alignLine}</div>
    <div class="ai-step-item"><span class="ai-step-name">6. 先檢查什麼：</span><br/>${stepsLine}</div>
    <div class="ai-step-item"><span class="ai-step-name">7. 暫時不要做什麼：</span> ❌ 先不要去改飛控參數！硬體物理沒修好，改參數只會讓問題更隱蔽或加劇危險。</div>
    <div class="ai-step-item"><span class="ai-step-name">8. 如果還是不正常，再看什麼：</span> ${pendingLine || "若硬體排查無誤仍舊偏高，請教官使用電表檢測電調輸出，或執行電調行程校準。"}</div>
  `;
}

// 渲染 ⑤ 成長記錄卡
function renderGrowthCard() {
  const container = document.getElementById("growth-card-preview-area");
  if (!container) return;

  const data = AppState.diagnosisData;
  // 2026-11-01 修復：整體狀態在 student_view 內；讀不到時必須是「未檢測」，絕不預設為健康
  const overallMeta = getStatusMeta(data?.student_view?.overall_status || data?.overall_status || "unknown");
  const rev = AppState.teacherReview;

  // 2026-10-17 修復：成長卡「主要問題」不得硬編碼故障故事（違反本檔 1170 行紀律）。
  // 一律取自當次真實分析結果；全綠時明確顯示「未發現異常」，絕不謊報。
  const _gcCards = (data?.student_view && data.student_view.health_cards) || [];
  const _gcProblems = _gcCards.filter(
    (c) => normalizeSeverity(c.status) === "inspect" || normalizeSeverity(c.status) === "danger"
  );
  const _gcWorst = _gcProblems[0];
  const _gcMain = _gcWorst
    ? `${_gcWorst.title}：${_gcWorst.main_finding}`
    : "本次各項健康檢查均未發現異常。";
  const _gcFusion =
    AppState.correlationResult && AppState.correlationResult.isConsistent
      ? AppState.correlationResult.isConsistent
      : (_gcProblems.length
          ? "客觀數據顯示需檢查項，待教師複核。"
          : "客觀數據未見異常（主客觀方向平穩）。");
  const _gcNext =
    (AppState.finalConclusion && AppState.finalConclusion.steps && AppState.finalConclusion.steps[0]) ||
    (_gcWorst ? _gcWorst.next_action : "按標準飛前檢查繼續下一階段訓練。");

  let revTag = '<span class="status-badge status-attention">待教師復核</span>';
  if (rev.status === "confirmed") revTag = '<span class="status-badge status-normal">教官已確認</span>';
  else if (rev.status === "caution") revTag = '<span class="status-badge status-attention">教官提示注意</span>';
  else if (rev.status === "retest_required") revTag = '<span class="status-badge status-stop">需重新測試</span>';

  container.innerHTML = `
    <div class="growth-card-header">
      <div>
        <div style="font-size:18px; font-weight:900;">FDE 飛行健康成長記錄</div>
        <div style="font-size:12px; font-weight:700; color:#00c2ff; margin-top:2px;">
          ${AppState.aircraftName} · ${AppState.trainingTask}
        </div>
      </div>
      <div style="font-size:11px; text-align:right; color:var(--text-muted);">
        <div>日期：${new Date().toISOString().split("T")[0]}</div>
        <div>狀態：${overallMeta.icon} ${overallMeta.label}</div>
      </div>
    </div>

    ${(() => {
      const cards = (AppState.diagnosisData && AppState.diagnosisData.student_view && AppState.diagnosisData.student_view.health_cards) || [];
      if (cards.length) {
        return (
          '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">' +
          cards
            .map((c) => {
              const m = getStatusMeta(c.status);
              const short = c.title.replace(/^\d+\s*/, "");
              return `<span class="status-badge ${m.cssClass}">${short}: ${m.label}</span>`;
            })
            .join("") +
          "</div>"
        );
      }
      return `
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
      <span class="status-badge ${getStatusMeta(determineStatus("motors")).cssClass}">動力: ${getStatusMeta(determineStatus("motors")).label}</span>
      <span class="status-badge ${getStatusMeta(determineStatus("battery")).cssClass}">電池: ${getStatusMeta(determineStatus("battery")).label}</span>
      <span class="status-badge ${getStatusMeta(determineStatus("gps")).cssClass}">定位: ${getStatusMeta(determineStatus("gps")).label}</span>
      <span class="status-badge ${getStatusMeta(determineStatus("vibration")).cssClass}">穩定: ${getStatusMeta(determineStatus("vibration")).label}</span>
    </div>`;
    })()}

    <div style="font-size:12px; line-height:1.5; margin-bottom:10px;">
      <div><strong>主要問題：</strong>${_gcMain}</div>
      <div><strong>飛手手感：</strong>${AppState.pilotFeedback.notes || "起飛下沉"} (手感: ${AppState.pilotFeedback.rating})</div>
      <div><strong>客觀融合：</strong>${_gcFusion}</div>
      <div><strong>下一步建議：</strong>${_gcNext}</div>
    </div>

    <div style="border-top:1px dashed var(--border); padding-top:8px; display:flex; justify-content:space-between; align-items:center;">
      <div style="font-size:12px; color:var(--text-muted);">
        <strong>教師簽署：</strong>${rev.teacherName} · ${rev.notes}
      </div>
      <div>${revTag}</div>
    </div>

    <div style="background:rgba(11, 23, 38, 0.7); border:1px solid var(--border); border-radius:6px; padding:8px; font-size:11px; color:var(--text-muted); margin-top:10px;">
      <strong>前後架次比對（預留槽位）：</strong>初次飛行記錄 (Session 1)。待上傳下一架次日誌後自動比對動力改善幅度。
    </div>
  `;
}

/**
 * V1.2：教師模式下拉取 /teacher-result，把 safety_events / raw_events
 * 合併進 AppState.teacherEvidence，供專業證據區塊顯示。
 * 僅在教師模式且有 flightSessionId 時執行；失敗靜默降級。
 */
async function ensureTeacherEvidenceLoaded() {
  if (AppState.teacherEvidenceLoaded) return;
  if (!AppState.flightSessionId) return;
  try {
    const apiBase = window.FLIGHT_HEALTH_CONFIG?.getActiveApiBase();
    if (!apiBase) return;
    const resp = await fetch(`${apiBase}/flights/${AppState.flightSessionId}/teacher-result`, {
      headers: { "X-FDE-Teacher-Mode": "DEV-LOCAL" }
    });
    if (!resp.ok) return;
    const teacher = await resp.json();
    const analysis = teacher.teacher_result || {};
    AppState.teacherEvidence = {
      safety_events: teacher.safety_events || [],
      raw_events: teacher.raw_events || [],
      rule_results: teacher.rule_results || [],
      // 2026-10-16：八卡證據鏈（規則 ID / 狀態 / 實測原始字段 / 缺失原因）
      health_cards: analysis.health_cards || [],
      parsed_message_count: analysis.parsed_message_count,
      main_finding: analysis.main_finding
    };
    AppState.teacherEvidenceLoaded = true;
  } catch (err) {
    // 靜默降級：教師證據載入失敗不影響主報告
  }
}

// 教師模式抽屜 (預設絕對折疊，僅主動觸發時滑出)
async function openDrawer(focusItem) {
  const backdrop = document.getElementById("drawer-backdrop");
  if (!backdrop) return;
  backdrop.classList.add("open");

  const body = document.getElementById("drawer-content-body");
  if (!body) return;

  // V1.2：教師模式下補拉 /teacher-result（含 raw_events / safety_events），
  //       失敗不阻斷，仍顯示既有資料。
  await ensureTeacherEvidenceLoaded();

  const data = AppState.diagnosisData;
  const teacherCards = (AppState.teacherEvidence && AppState.teacherEvidence.health_cards) || [];

  body.innerHTML = `
    <div style="background:rgba(0, 194, 255, 0.1); border:1px solid var(--border); border-radius:8px; padding:8px 10px; font-size:12px; color:#ddf3ff; margin-bottom:12px;">
      🔒 <strong>教師/工程師專業資料層 (Layer 2)</strong><br/>
      保留 ArduPilot 原始遙測、時間區間與規則證據鏈。
    </div>

    <h4 style="font-size:13px; font-weight:800; margin-bottom:6px;">1. 八卡判定證據鏈（規則 ID / 實測原始字段 / 閾值）</h4>
    ${teacherCards.length > 0 ? renderTeacherCardEvidence(teacherCards) : '<div style="font-size:12px; color:var(--text-muted);">教師證據層暫無資料（DEMO 模式或教師結果未就緒）。</div>'}

    ${renderTeacherSafetyEvidence(data)}
  `;
}

/**
 * 教師八卡證據鏈：每張卡的規則 ID、狀態、判斷依據的實測原始字段值、
 * 實際找到的消息類型與缺失原因——供教師查核「為何是這個顏色」。
 */
function renderTeacherCardEvidence(cards) {
  const fmtVal = (v) => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return `
    <table class="raw-table">
      <tr><th>健康卡</th><th>規則</th><th>狀態</th><th>實測證據（原始字段）</th><th>缺失說明</th></tr>
      ${cards.map((c) => {
        const meta = getStatusMetaFromEngine(c.status);
        const ev = c.evidence && Object.keys(c.evidence).length
          ? Object.entries(c.evidence).map(([k, v]) => `${k}=${fmtVal(v)}`).join("；")
          : "—";
        const found = (c.evidence_found_types || []).join(" / ") || "—";
        return `<tr>
          <td>${c.title}</td>
          <td>${c.rule_id || "—"}</td>
          <td><span class="status-badge ${meta.cssClass}">${meta.icon} ${meta.label}</span></td>
          <td>${ev}<br/><span style="font-size:10px; color:var(--text-muted);">實際命中消息：${found}</span></td>
          <td>${c.missing_reason || "—"}</td>
        </tr>`;
      }).join("")}
    </table>`;
}

/**
 * 教師專業證據：安全事件 + 原始 MSG/EV/ERR（V1.2）。
 * 只呈現後端已核驗資料；無資料時明確標示「無法判定」，不生成虛假證據鏈。
 */
function renderTeacherSafetyEvidence(data) {
  const evidence = AppState.teacherEvidence || {};
  const events = Array.isArray(evidence.safety_events)
    ? evidence.safety_events
    : (Array.isArray(data?.safety_events) ? data.safety_events : []);
  const rawEvents = Array.isArray(evidence.raw_events)
    ? evidence.raw_events
    : (Array.isArray(data?.raw_events) ? data.raw_events : []);

  const fmt = (v) =>
    v === null || v === undefined || v === "" ? "—" : String(v);
  const fmtTime = (us) =>
    typeof us === "number" ? (us / 1e6).toFixed(3) + "s（飛控時間）" : "—";

  let html =
    '<h4 style="font-size:13px; font-weight:800; margin:10px 0 6px;">3. 安全事件與原始證據（V1.2）</h4>';

  if (events.length === 0) {
    html +=
      '<div style="font-size:12px; color:var(--text-muted);">本次日誌未擷取到可配對的安全事件；無法判定，不生成虛假證據鏈。</div>';
  } else {
    html += events
      .map(
        (e) => `
      <div style="background:rgba(11,23,38,0.7); border:1px solid var(--border); border-radius:6px; padding:8px; margin-bottom:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between;">
          <strong>[${e.rule_id}] ${e.category} / ${e.event_type}</strong>
          <span>${e.recovered ? "已恢復" : (e.recovery_confirmed ? "單次事件" : "未確認恢復")}</span>
        </div>
        <table class="raw-table" style="margin-top:4px;">
          <tr><th>原始事件</th><td>${fmt(e.raw_name)}</td></tr>
          <tr><th>原始飛控時間</th><td>${fmtTime(e.start_raw_time_us)}${e.end_raw_time_us ? " → " + fmtTime(e.end_raw_time_us) : ""}</td></tr>
          <tr><th>飛行相對時間</th><td>${fmt(e.start_time_s)}s${e.end_time_s !== null && e.end_time_s !== undefined ? " → " + e.end_time_s + "s" : ""}</td></tr>
          <tr><th>持續時間</th><td>${e.duration_s !== null && e.duration_s !== undefined ? e.duration_s + "s" : "—"}</td></tr>
          <tr><th>飛行階段</th><td>${fmt(e.phase)}</td></tr>
          <tr><th>資料來源</th><td>${(e.raw_evidence || []).map((r) => fmt(r.raw_field)).join(" / ") || "—"}</td></tr>
        </table>
      </div>`
      )
      .join("");
  }

  if (rawEvents.length > 0) {
    const msgRows = rawEvents
      .filter((r) => r.source_field === "MSG.Message" && r.raw_time_us)
      .map(
        (r) => `
        <tr>
          <td>${fmt(r.message)}</td>
          <td>${fmtTime(r.raw_time_us)}</td>
          <td>${r.relative_time_s !== null && r.relative_time_s !== undefined ? r.relative_time_s + "s" : "—"}</td>
        </tr>`
      )
      .join("");
    html += `
      <details style="margin-top:8px;">
        <summary style="cursor:pointer; font-size:12px; font-weight:700;">原始飛控訊息 (MSG) — 展開查看</summary>
        <table class="raw-table" style="margin-top:6px;">
          <tr><th>原始訊息</th><th>飛控時間</th><th>相對時間</th></tr>
          ${msgRows || '<tr><td colspan="3">無</td></tr>'}
        </table>
      </details>`;
  }

  return html;
}

function closeDrawer() {
  const backdrop = document.getElementById("drawer-backdrop");
  if (backdrop) backdrop.classList.remove("open");
}
