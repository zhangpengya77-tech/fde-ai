/**
 * FDE-AI 2.0｜Platform Integration｜Assess → Official Vision API client.
 *
 * 正式學生「測 Assess」流程只走 /api/v1/vision/* 的 PROP_DIRECTION / FOUR_SIDE_HOVER。
 * 不再使用 legacy 本機 YOLO，也不把模擬結果當成真實 AI 測評結果。
 * 當正式後端或 ACTIVE model 不可用時，一律回傳「目前尚無可用模型」錯誤，
 * 由上層明確顯示提示訊息。
 */
(function attachFdeVisionClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FdeVisionClient = api;
  }
})(globalThis, function createFdeVisionClient() {
  const NO_MODEL_MESSAGE = '目前尚無可用模型，請稍後再試或聯絡教師。';
  const ANALYSIS_FAILED_MESSAGE = '分析失敗，請稍後再試或聯絡教師。';
  const SUPPORTED_VIDEO = ['.mp4', '.mov', '.webm', '.avi'];

  function isLoopback(hostname) {
    return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  }

  function normalizeBase(value, kind, pageLocation) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (kind === 'public' && url.protocol !== 'https:') return null;
      if (pageLocation?.protocol === 'https:' && url.protocol === 'http:' && !isLoopback(url.hostname)) return null;
      return { base: url.href.replace(/\/+$/, '') };
    } catch {
      return null;
    }
  }

  /** 解析正式 Vision API base：優先用已發布的 PUBLIC url，其次本機。 */
  function visionApiBase(config, pageLocation) {
    const cfg = config || {};
    const local = normalizeBase(cfg.VISION_API_BASE_URL, 'local', pageLocation);
    const publicApi = normalizeBase(cfg.PUBLIC_VISION_API_URL, 'public', pageLocation);
    const sameOrigin = normalizeBase(pageLocation?.origin, 'local', pageLocation);
    const mode = cfg.VISION_API_MODE || 'auto';
    const localPage = pageLocation && isLoopback(pageLocation.hostname);
    const chosen = mode === 'local'
      ? local
      : mode === 'public'
        ? publicApi
        : localPage
          ? (local || publicApi)
          : (publicApi || sameOrigin || local);
    return chosen ? chosen.base : null;
  }

  function fail(code, message, detail) {
    const error = new Error(message);
    error.code = code;
    error.detail = detail || '';
    return error;
  }

  function noModelError(detail) {
    return fail('VISION_NO_ACTIVE_MODEL', NO_MODEL_MESSAGE, detail);
  }

  function unavailableError(detail) {
    return fail('VISION_API_UNAVAILABLE', NO_MODEL_MESSAGE, detail);
  }

  function stripDataUrl(value) {
    const text = String(value || '');
    const marker = 'base64,';
    const index = text.indexOf(marker);
    return index >= 0 ? text.slice(index + marker.length) : text;
  }

  function isSupportedVideo(fileName) {
    return SUPPORTED_VIDEO.some((ext) => String(fileName || '').toLowerCase().endsWith(ext));
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function throwForFailure(payload, response) {
    // 後端不可用或沒有 ACTIVE model：一律提示「目前尚無可用模型」。
    if (!response || !response.ok) {
      // Live 錯誤信封為 {error: {code, message}}；舊格式 {error: "code"} 仍相容。
      const error = payload?.error;
      const code = typeof error === 'string' ? error : String(error?.code || '');
      const message = typeof error === 'object' && error ? String(error.message || '') : '';
      const noModelCodes = ['active_model_required', 'opencv_unavailable', 'model_unavailable'];
      if (noModelCodes.includes(code) || noModelCodes.includes(message)) {
        throw noModelError(noModelCodes.includes(code) ? code : message);
      }
      throw unavailableError(code || `HTTP_${response?.status || 'unknown'}`);
    }
    return null;
  }

  /** PROP_DIRECTION：正式槳葉方向檢測。 */
  async function propCheck(options) {
    const {
      fetchImpl = typeof fetch === 'function' ? fetch : null,
      base, imageDataUrl, imageWidth, imageHeight, fileName = '', confidenceThreshold = 0.5,
      judge = null,
    } = options || {};
    if (!base) throw unavailableError('missing_vision_base');
    if (!fetchImpl) throw unavailableError('missing_fetch');
    const body = {
      image_base64: stripDataUrl(imageDataUrl),
      image_width: Number(imageWidth) || 0,
      image_height: Number(imageHeight) || 0,
      confidence_threshold: confidenceThreshold,
      input_reference: fileName,
    };
    let response;
    try {
      response = await fetchImpl(`${base}/api/v1/vision/prop-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw unavailableError(error?.message || 'network_error');
    }
    const payload = await readJson(response);
    throwForFailure(payload, response);
    if (!payload || payload.model == null) throw noModelError('no_active_model');
    // 2026-11-08：學員頁一律傳入共用判定模組（judge），畫面結果改由 judgePropellers 依偵測框判定；
    // 後端 evaluate_prop 的結果保留在 backendFinalResult 供稽核，不再決定畫面上的對錯。
    if (judge) return adaptJudgedPropResult(payload, fileName, judge, Number(imageWidth) || 0, Number(imageHeight) || 0);
    return adaptPropResult(payload, fileName);
  }

  /**
   * 以共用判定模組（prop-live/prop-judge.js）產生學生結果卡片。
   * judge = { judgePropellers, formatJudgement, rules, messages }
   * 狀態對應：CORRECT→PASS、WRONG→NG、UNCERTAIN→CHECK（UNCERTAIN 時四個位置都顯示 CHECK，不出現 PASS）。
   */
  function adaptJudgedPropResult(payload, fileName, judge, imageWidth, imageHeight) {
    const { rules, messages } = judge;
    const raw = Array.isArray(payload && payload.detections) ? payload.detections : [];
    let judgement = judge.judgePropellers(raw, rules);
    let text = judge.formatJudgement(judgement, messages);
    // 2026-11-14：嚴格規則判為「無法判斷」時，改給參考判定，學員仍能看到每支槳的對錯並取得 AI 說明
    if (judgement.state === 'UNCERTAIN') {
      const ref = bestEffortJudgement(raw, rules, imageWidth, imageHeight);
      if (ref) { judgement = ref.judgement; text = ref.text; }
    }
    const finalResult = judgement.state === 'CORRECT' ? 'PASS' : (judgement.state === 'WRONG' || (judgement.state === 'BEST_EFFORT' && judgement.wrong.length)) ? 'NG' : 'CHECK';
    const quadrantOf = {};
    for (const [q, motor] of Object.entries(rules.motorIds || {})) quadrantOf[motor] = q;
    const motorChecks = ['M1', 'M2', 'M3', 'M4'].map((motor) => {
      const q = quadrantOf[motor];
      const item = judgement.positions[q];
      const place = `${messages.positions[q] || q}（${motor}）`;
      if (!item) {
        return {
          motor, result: 'CHECK', position: place, detectedDirection: 'CHECK',
          expectedDirection: rules.layout[q] || 'CHECK', confidence: null,
          reason: judgement.state === 'BEST_EFFORT' ? '未辨識到此槳，請重拍或由老師確認' : (messages.uncertainReason[judgement.reasonCode] || messages.state.UNCERTAIN),
        };
      }
      return {
        motor, result: item.ok ? 'PASS' : 'NG', position: place, detectedDirection: item.detected,
        expectedDirection: item.expected, confidence: item.confidence, reason: item.ok ? (judgement.state === 'BEST_EFFORT' ? '參考判定，請老師確認' : '') : '旋向錯誤',
      };
    });
    const simulationMode = payload?.simulation_mode === true;
    return {
      fileName: fileName || '未命名檢測檔案',
      engine: 'AI 視覺評測',
      simulationMode,
      resultLabel: simulationMode ? (payload?.result_label || 'DEMO 模擬結果') : '',
      summary: text.headline,
      judgeLines: text.lines,
      judgeState: judgement.state,
      judgeReason: judgement.reasonCode,
      ruleVersion: judgement.ruleVersion,
      overlayBoxes: judgement.boxes,
      imageWidth,
      imageHeight,
      motorChecks,
      detections: motorChecks
        .filter((item) => item.confidence !== null)
        .map((item) => ({ motor: item.motor, label: item.detectedDirection, confidence: item.confidence })),
      finalResult,
      backendFinalResult: payload?.final_result || null,
    };
  }

  /**
   * 2026-11-14：參考判定（低信心時的退路）。
   * 規則：信心 ≥ candidateConfidence 的 CW/CCW 框，重疊者留高信心，最多取 4 個；
   * 以偵測框重心（不足 3 個時用畫面中心）分四象限，與 layout 比對給綠／紅；沒偵測到的位置為待確認。
   * 參考判定的整體結果最多是 NG 或 CHECK，絕不給 PASS——槳葉安裝仍須老師確認。
   */
  function bestEffortJudgement(raw, rules, imageWidth, imageHeight) {
    const boxOf = (d) => {
      const b = d && (d.bbox || d.box);
      return Array.isArray(b) && b.length === 4 ? b.map(Number) : null;
    };
    const iou = (a, b) => {
      const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
      const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
      const inter = ix * iy;
      const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
      return ua > 0 ? inter / ua : 0;
    };
    const cands = raw
      .map((d) => ({ cls: String(d.class || d.className || ''), confidence: Number(d.confidence), box: boxOf(d) }))
      .filter((c) => c.box && rules.classes.includes(c.cls) && c.confidence >= rules.candidateConfidence)
      .sort((a, b) => b.confidence - a.confidence);
    const kept = [];
    for (const c of cands) if (kept.length < 4 && kept.every((k) => iou(k.box, c.box) <= rules.maxOverlapIoU)) kept.push(c);
    if (!kept.length) return null;
    const centers = kept.map((k) => [(k.box[0] + k.box[2]) / 2, (k.box[1] + k.box[3]) / 2]);
    const cx = kept.length >= 3 ? centers.reduce((t, c) => t + c[0], 0) / centers.length : (imageWidth || 0) / 2;
    const cy = kept.length >= 3 ? centers.reduce((t, c) => t + c[1], 0) / centers.length : (imageHeight || 0) / 2;
    const positions = {};
    kept.forEach((k, i) => {
      const q = (centers[i][1] < cy ? 'T' : 'B') + (centers[i][0] < cx ? 'L' : 'R');
      if (positions[q]) return;   // 同象限已有較高信心的框
      positions[q] = { position: q, expected: rules.layout[q], detected: k.cls, confidence: k.confidence, bbox: k.box, ok: k.cls === rules.layout[q] };
    });
    const wrong = Object.keys(positions).filter((q) => !positions[q].ok);
    const missing = ['TL', 'TR', 'BL', 'BR'].filter((q) => !positions[q]);
    const boxes = Object.values(positions).map((v) => ({ bbox: v.bbox, class: v.detected, confidence: v.confidence, color: v.ok ? 'green' : 'red', position: v.position }));
    const headline = wrong.length
      ? `參考判定：有 ${wrong.length} 支槳葉方向可能裝錯（請老師確認）`
      : missing.length
        ? `參考判定：已辨識的槳葉方向正確，另有 ${missing.length} 支未辨識（請老師確認）`
        : '參考判定：四支槳葉方向皆正確（辨識信心偏低，請老師確認）';
    const lines = [];
    if (missing.length) lines.push(`未辨識位置：${missing.map((q) => `${q}（${(rules.motorIds || {})[q] || ''}）`).join('、')}，建議從正上方俯視、機頭朝上重拍。`);
    lines.push('此為辨識信心偏低時的參考判定，不代表可以起飛，請由老師確認。');
    return {
      judgement: { ruleVersion: rules.version || '', state: 'BEST_EFFORT', reasonCode: wrong.length ? 'WRONG_PROP' : 'PARTIAL', positions, wrong, boxes, allReversed: false },
      text: { tone: wrong.length ? 'red' : 'green', headline, lines },
    };
  }

  /** FOUR_SIDE_HOVER：正式四面懸停檢測（後端抽幀 + 分析）。 */
  async function hoverAnalyze(options) {
    const {
      fetchImpl = typeof fetch === 'function' ? fetch : null,
      base, fileDataUrl, fileName = '', frameIntervalSeconds = 0.5,
    } = options || {};
    if (!base) throw unavailableError('missing_vision_base');
    if (!fetchImpl) throw unavailableError('missing_fetch');
    if (!isSupportedVideo(fileName)) {
      throw fail('VISION_UNSUPPORTED_FILE', '請上傳 mp4 / mov / webm / avi 影片檔案。', fileName);
    }
    let response;
    try {
      response = await fetchImpl(`${base}/api/v1/vision/hover-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: fileName,
          file_base64: stripDataUrl(fileDataUrl),
          frame_interval_seconds: frameIntervalSeconds,
        }),
      });
    } catch (error) {
      throw unavailableError(error?.message || 'network_error');
    }
    const payload = await readJson(response);
    throwForFailure(payload, response);
    if (!payload) throw unavailableError('empty_response');
    return adaptHoverResult(payload, fileName);
  }

  /** 官方 evaluate_prop 結果 → 既有學生結果卡片形狀。 */
  function adaptPropResult(payload, fileName) {
    const positions = (payload && payload.positions) || {};
    const motorChecks = ['M1', 'M2', 'M3', 'M4'].map((motor) => {
      const item = positions[motor] || {};
      const result = item.result === 'PASS' || item.result === 'NG' ? item.result : 'CHECK';
      return {
        motor,
        result,
        position: motor,
        detectedDirection: item.detected || 'CHECK',
        expectedDirection: item.expected || 'CHECK',
        bladeFace: item.blade_face || 'CHECK',
        confidence: typeof item.confidence === 'number' ? item.confidence : null,
        reason: item.reason || '',
      };
    });
    const detections = motorChecks
      .filter((item) => item.confidence !== null)
      .map((item) => ({ motor: item.motor, label: item.detectedDirection, confidence: item.confidence }));
    const final = payload?.final_result;
    const finalResult = final === 'PASS' ? 'PASS' : final === 'NG' ? 'NG' : 'CHECK';
    // DEMO 模擬推論必須明確標示，避免與真實 YOLO 測評混淆。
    const simulationMode = payload?.simulation_mode === true;
    return {
      fileName: fileName || '未命名檢測檔案',
      engine: 'AI 視覺評測',
      simulationMode,
      resultLabel: simulationMode ? (payload?.result_label || 'DEMO 模擬結果') : '',
      summary: finalResult === 'PASS'
        ? '四個槳葉旋向皆與 F450 配置一致。'
        : '部分槳葉需要確認，請依下方 M1-M4 結果調整後再檢測。',
      motorChecks,
      detections,
      finalResult,
    };
  }

  /** 官方 analyze_hover 結果 → 既有學生結果卡片形狀（不暴露 Registry / Dataset / Benchmark 等資訊）。 */
  function adaptHoverResult(payload, fileName) {
    const data = payload || {};
    const score = Number.isFinite(data.score) ? data.score : 0;
    const passed = data.result === 'PASS';
    const metrics = [
      { label: '評分結果', value: passed ? 'PASS' : 'NG' },
      { label: '分數', value: `${score} 分` },
      { label: '未知幀數', value: String(data.unknown_frames ?? 0) },
      { label: '平均中心偏移', value: data.average_center_offset_m == null ? '待確認' : `${data.average_center_offset_m} m` },
    ];
    return {
      engine: 'AI 四面懸停評測',
      score,
      fileName: fileName || '未命名影片',
      summary: passed
        ? '四個方向懸停皆已完成，位移維持在可接受範圍。'
        : '尚未完成四面懸停，請確認機頭朝前、右、後、左四個方向皆已拍攝。',
      metrics,
      teacherReview: 'AI 評測結果僅供練習參考，實際考核由教師現場確認。',
    };
  }

  return {
    NO_MODEL_MESSAGE,
    ANALYSIS_FAILED_MESSAGE,
    SUPPORTED_VIDEO,
    isLoopback,
    visionApiBase,
    stripDataUrl,
    isSupportedVideo,
    adaptPropResult,
    adaptJudgedPropResult,
    adaptHoverResult,
    propCheck,
    hoverAnalyze,
    noModelError,
    unavailableError,
  };
});
