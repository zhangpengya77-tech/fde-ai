(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FdeLiveCoach = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function cameraConstraints() {
    return {
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    };
  }

  function cameraConstraintCandidates(devices = [], selectedDeviceId = '', preferEnvironment = false) {
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    const deviceId = selectedDeviceId || (cameras.length === 1 ? cameras[0].deviceId : '');
    const ideals = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
    if (preferEnvironment) return [
      { video: { facingMode: { ideal: 'environment' }, ...ideals }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: { facingMode: { ideal: 'user' } }, audio: false },
      { video: true, audio: false }
    ];
    if (deviceId) return [{ video: { deviceId: { exact: deviceId }, ...ideals }, audio: false }, { video: { deviceId: { exact: deviceId } }, audio: false }, { video: true, audio: false }];
    return [{ video: { ...ideals }, audio: false }, { video: true, audio: false }];
  }

  function mobileFacingCandidates(facingMode = 'environment') {
    const ideals = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
    return [
      { video: { facingMode: { exact: facingMode }, ...ideals }, audio: false },
      { video: { facingMode: { ideal: facingMode } }, audio: false },
      { video: true, audio: false }
    ];
  }

  function cameraConstraintsForDevices(devices = [], selectedDeviceId = '', preferEnvironment = false) {
    return cameraConstraintCandidates(devices, selectedDeviceId, preferEnvironment)[0];
  }

  async function openCameraWithFallback(mediaDevices, candidates, onFallback = () => {}) {
    const failedAttempts = [];
    for (let index = 0; index < candidates.length; index += 1) {
      try {
        const stream = await mediaDevices.getUserMedia(candidates[index]);
        return { stream, fallbackUsed: index > 0, failedAttempts, constraintIndex: index };
      } catch (error) {
        failedAttempts.push({ name: error.name || 'Error', message: error.message || '', constraint: error.constraint || '' });
        if (index < candidates.length - 1) onFallback(failedAttempts[failedAttempts.length - 1], index + 1);
        else { error.failedAttempts = failedAttempts; throw error; }
      }
    }
    throw new Error('camera_candidates_empty');
  }

  async function replaceCameraStream(mediaDevices, currentStream, candidates, restoreCandidates = []) {
    stopStream(currentStream);
    try {
      return await openCameraWithFallback(mediaDevices, candidates);
    } catch (switchError) {
      if (!restoreCandidates.length) throw switchError;
      const restored = await openCameraWithFallback(mediaDevices, restoreCandidates);
      return { ...restored, restored: true, switchError };
    }
  }

  function bindPushToTalk(button, options = {}) {
    const { recognitionFactory = null, onState = () => {}, onResult = () => {}, onError = () => {}, onNoResult = () => {}, onUnavailable = () => {}, stateMachine = null, readyLabel = '🎙 按住說話' } = options;
    let recognition = null;
    let listening = false;
    let resultDelivered = false;
    let latestTranscript = '';
    function setState(state, label) {
      button.dataset.state = state.toLowerCase();
      button.setAttribute('aria-pressed', state === 'LISTENING' ? 'true' : 'false');
      button.textContent = label;
      onState(state);
      stateMachine?.transition(state);
    }
    function releaseButton() { listening = false; recognition = null; button.dataset.state = 'ready'; button.setAttribute('aria-pressed', 'false'); button.textContent = readyLabel; }
    function reset() { releaseButton(); onState('IDLE'); stateMachine?.reset(); }
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (!recognitionFactory) { const message = '當前瀏覽器不支持語音輸入。請使用 Safari 打開，或使用「文字問 AI」。'; reset(); onUnavailable(message); return; }
      try {
        recognition = recognitionFactory();
        resultDelivered = false;
        latestTranscript = '';
        recognition.onstart = () => setState('LISTENING', '🎙 正在聽……');
        recognition.onresult = (resultEvent) => {
          latestTranscript = Array.from(resultEvent.results || []).map((result) => result[0]?.transcript || '').join(' ').trim();
          const finalSeen = Array.from(resultEvent.results || []).some((result) => result.isFinal !== false);
          if (latestTranscript && finalSeen && !resultDelivered) {
            resultDelivered = true;
            listening = false;
            setState('ASKING', 'AI 正在思考…');
            onResult(latestTranscript);
          }
        };
        recognition.onspeechend = () => {
          if (!resultDelivered && recognition && typeof recognition.stop === 'function') {
            listening = false;
            recognition.stop();
            setState('TRANSCRIBING', '正在識別語音…');
          }
        };
        recognition.onend = () => {
          if (resultDelivered) return;
          if (latestTranscript) {
            resultDelivered = true;
            setState('ASKING', 'AI 正在思考…');
            onResult(latestTranscript);
            return;
          }
          onNoResult();
          reset();
        };
        recognition.onerror = (errorEvent) => { reset(); onError(errorEvent.error || 'voice_input_failed'); };
        recognition.start();
        listening = true;
        setState('LISTENING', '🎙 正在聽……');
      } catch (error) { reset(); onError(error.message || 'voice_input_failed'); }
    });
    function finish(event, cancelled) {
      event.preventDefault();
      if (!listening || !recognition) return;
      listening = false;
      if (cancelled && typeof recognition.abort === 'function') recognition.abort();
      else if (typeof recognition.stop === 'function') recognition.stop();
      if (!resultDelivered) setState('TRANSCRIBING', '正在識別語音…');
    }
    button.addEventListener('pointerup', (event) => finish(event, false));
    button.addEventListener('pointercancel', (event) => finish(event, true));
    return { reset, releaseButton };
  }

  function shouldAutoStartCamera({ taskSelected = false, permissionGranted = false, cameraActive = false } = {}) {
    return Boolean(taskSelected && permissionGranted && !cameraActive);
  }

  // 2026-11-04：學員不講話時語音助教「靜置待命」——瀏覽器回報沒聽到聲音（no-speech／aborted／空白結束）
  // 不再當成錯誤關閉，而是安靜地重新聆聽；只有麥克風權限或裝置錯誤才真的停止。
  const SILENT_SPEECH_CODES = new Set(['no-speech', 'aborted']);
  const RETRYABLE_SPEECH_CODES = new Set(['network']);
  const FATAL_SPEECH_CODES = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

  function createHandsFreeVoiceCoach({ recognitionFactory = null, onTranscript = () => {}, onInterim = () => {}, onState = () => {}, onError = () => {}, isBusy = () => false, isPageActive = () => true, endGraceMs = 750, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout, silentRestartMs = 400, maxRetryableFailures = 5 } = {}) {
    let enabled = false;
    let activeCycle = null;
    let sequence = 0;
    let restartTimer = null;
    let retryableFailures = 0;
    function canListen() { return enabled && isPageActive() && !isBusy() && !activeCycle; }
    /** 靜置後重新聆聽：保持開啟狀態，不顯示錯誤、不呼叫 AI。 */
    function restartQuietly(cycle, delayMs = silentRestartMs) {
      if (!cycle || cycle.submitted || cycle.cancelled) return;
      if (cycle.graceTimer) clearTimeoutImpl(cycle.graceTimer);
      cycle.cancelled = true;
      if (activeCycle === cycle) activeCycle = null;
      if (!enabled) return;
      onState('VOICE_STANDBY');
      if (restartTimer) clearTimeoutImpl(restartTimer);
      restartTimer = setTimeoutImpl(() => { restartTimer = null; listen(); }, delayMs);
    }
    function submitCycle(cycle) {
      if (!cycle || cycle.submitted || !cycle.transcript.trim()) return false;
      cycle.submitted = true;
      if (cycle.graceTimer) clearTimeoutImpl(cycle.graceTimer);
      if (activeCycle === cycle) activeCycle = null;
      onState('ASKING');
      onTranscript(cycle.transcript.trim(), cycle.id);
      return true;
    }
    function failCycle(cycle, code) {
      if (!cycle || cycle.submitted || cycle.cancelled) return;
      if (cycle.graceTimer) clearTimeoutImpl(cycle.graceTimer);
      if (activeCycle === cycle) activeCycle = null;
      enabled = false;
      onError(code);
      onState('IDLE');
    }
    function listen() {
      if (!canListen() || !recognitionFactory) return false;
      const recognition = recognitionFactory();
      const cycle = { id: `voice-${Date.now()}-${++sequence}`, recognition, transcript: '', submitted: false, cancelled: false, graceTimer: null };
      activeCycle = cycle;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'zh-TW';
      recognition.onstart = () => onState('LISTENING');
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results || []).map((result) => result[0]?.transcript || '').join(' ').trim();
        const finalSeen = Array.from(event.results || []).some((result) => result.isFinal === true);
        if (!transcript || cycle.submitted || cycle.cancelled) return;
        cycle.transcript = transcript;
        onInterim(transcript, finalSeen, cycle.id);
        if (finalSeen) submitCycle(cycle);
      };
      recognition.onerror = (event) => {
        const code = event.error || 'voice_input_failed';
        // 學員沒講話：靜置待命，安靜地重新聆聽
        if (SILENT_SPEECH_CODES.has(code) && !cycle.transcript.trim()) { restartQuietly(cycle); return; }
        // 網路短暫失敗：退避重試，連續失敗太多次才停止
        if (RETRYABLE_SPEECH_CODES.has(code) && retryableFailures < maxRetryableFailures) {
          retryableFailures += 1;
          restartQuietly(cycle, silentRestartMs * 2 ** retryableFailures);
          return;
        }
        if (!FATAL_SPEECH_CODES.has(code) && cycle.transcript.trim()) { submitCycle(cycle); return; }
        failCycle(cycle, code);
      };
      recognition.onend = () => {
        if (cycle.cancelled || cycle.submitted || activeCycle !== cycle) return;
        onState('TRANSCRIBING');
        cycle.graceTimer = setTimeoutImpl(() => {
          if (cycle.transcript.trim()) { retryableFailures = 0; submitCycle(cycle); }
          else restartQuietly(cycle);  // 這一輪沒聽到話：繼續靜置待命
        }, endGraceMs);
      };
      try {
        recognition.start();
        return true;
      } catch (error) {
        activeCycle = null;
        enabled = false;
        onError(error);
        onState('IDLE');
        return false;
      }
    }
    function stopCurrent() {
      if (restartTimer) { clearTimeoutImpl(restartTimer); restartTimer = null; }
      const cycle = activeCycle;
      activeCycle = null;
      if (!cycle) return;
      cycle.cancelled = true;
      if (cycle.graceTimer) clearTimeoutImpl(cycle.graceTimer);
      if (typeof cycle.recognition.stop === 'function') cycle.recognition.stop();
    }
    function enable() { enabled = true; retryableFailures = 0; onState('VOICE_STANDBY'); return listen(); }
    function pause() { enabled = false; stopCurrent(); onState('IDLE'); }
    function suspend() { stopCurrent(); if (enabled) onState('VOICE_STANDBY'); }
    function resumeAfterAnswer() { if (enabled) { onState('VOICE_STANDBY'); return listen(); } return false; }
    function handleVisibilityChange() { if (!isPageActive()) suspend(); else if (enabled) resumeAfterAnswer(); }
    return { enable, pause, suspend, resumeAfterAnswer, handleVisibilityChange, isEnabled: () => enabled };
  }

  function createLivePreviewMonitor(video, { onFrame = () => {}, onFrozen = () => {}, now = () => Date.now(), frozenAfterMs = 4000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    let frameRequest = null;
    let watchdog = null;
    let lastFrameAt = 0;
    let running = false;
    function frame(_timestamp, metadata = {}) {
      if (!running) return;
      lastFrameAt = now();
      onFrame(lastFrameAt, metadata);
      frameRequest = video.requestVideoFrameCallback?.(frame) ?? null;
    }
    function checkFrozen(at = now()) {
      if (running && lastFrameAt && at - lastFrameAt > frozenAfterMs) onFrozen();
    }
    function start() {
      if (running) return;
      running = true;
      frameRequest = video.requestVideoFrameCallback?.(frame) ?? null;
      watchdog = setIntervalImpl(() => checkFrozen(), 1000);
      watchdog?.unref?.();
    }
    function stop() {
      running = false;
      if (frameRequest !== null) video.cancelVideoFrameCallback?.(frameRequest);
      if (watchdog !== null) clearIntervalImpl(watchdog);
      frameRequest = null;
      watchdog = null;
      lastFrameAt = 0;
    }
    return { start, stop, checkFrozen, lastFrameTimestamp: () => lastFrameAt };
  }

  const INTERACTION_TIMEOUTS = Object.freeze({ LISTENING: 15000, TRANSCRIBING: 5000, ASKING: 20000, CAPTURING_FRAME: 3000, VISION_PROCESSING: 20000, SPEAKING: 30000 });

  function createInteractionStateMachine({ onChange = () => {}, onTimeout = () => {}, timeouts = INTERACTION_TIMEOUTS, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
    let current = 'IDLE';
    let timer = null;
    function clearWatchdog() { if (timer !== null) clearTimeoutImpl(timer); timer = null; }
    function emit(state, detail = {}) { current = state; onChange({ state, ...detail }); }
    function transition(state, detail = {}) {
      clearWatchdog();
      emit(state, detail);
      const timeout = timeouts[state];
      if (timeout) timer = setTimeoutImpl(() => {
        timer = null;
        onTimeout({ state, ...detail });
        emit('ERROR', { reason: `${state.toLowerCase()}_timeout` });
        emit('IDLE', { recoveredFromTimeout: state });
      }, timeout);
    }
    function reset(detail = {}) { clearWatchdog(); emit('IDLE', detail); }
    return { transition, reset, state: () => current };
  }

  function cameraErrorState(error = {}) {
    const detail = { name: error.name || 'Error', message: error.message || error.name || 'unknown', constraint: error.constraint || '' };
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return { state: 'NO CAMERA', ...detail };
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return { state: 'PERMISSION REQUIRED', ...detail };
    return { state: 'CAMERA ERROR', ...detail };
  }

  async function checkHealth(fetchImpl = fetch, endpoint = '/api/live/health') {
    try {
      const response = await fetchImpl(endpoint, { cache: 'no-store' });
      if (!response.ok) throw new Error('health request failed');
      const payload = await response.json();
      if (!payload || !payload.components) throw new Error('invalid health response');
      return payload;
    } catch {
      return {
        status: 'offline',
        components: { live_backend: 'offline', vision: 'unknown' }
      };
    }
  }

  function captureFrame(video, canvas, clock = performance.now.bind(performance), options = {}) {
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('camera_not_ready');
    }
    const maxWidth = options.maxWidth || 640;
    const maxHeight = options.maxHeight || 480;
    const mimeType = options.mimeType || 'image/jpeg';
    const quality = options.quality ?? 0.75;
    const scale = Math.min(1, maxWidth / video.videoWidth, maxHeight / video.videoHeight);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const captureStarted = clock();
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const captureMs = Math.max(0, Number((clock() - captureStarted).toFixed(1)));
    const encodeStarted = clock();
    const imageData = canvas.toDataURL(mimeType, quality);
    const encodeMs = Math.max(0, Number((clock() - encodeStarted).toFixed(1)));
    return {
      imageData,
      captureMs,
      encodeMs,
      mimeType,
      width: canvas.width,
      height: canvas.height
    };
  }

  function scaleBoxForContain(box, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const renderedWidth = sourceWidth * scale;
    const renderedHeight = sourceHeight * scale;
    const offsetX = (targetWidth - renderedWidth) / 2;
    const offsetY = (targetHeight - renderedHeight) / 2;
    return [
      offsetX + box[0] * scale,
      offsetY + box[1] * scale,
      offsetX + box[2] * scale,
      offsetY + box[3] * scale
    ].map((value) => Number(value.toFixed(2)));
  }

  function drawDetectionOverlay(canvas, detections, sourceWidth, sourceHeight) {
    const width = canvas.clientWidth || sourceWidth;
    const height = canvas.clientHeight || sourceHeight;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.font = '600 14px system-ui';
    context.lineWidth = 3;

    detections.forEach((detection) => {
      const [x1, y1, x2, y2] = scaleBoxForContain(
        detection.box,
        sourceWidth,
        sourceHeight,
        width,
        height
      );
      const label = `${detection.class} ${(detection.confidence * 100).toFixed(1)}%`;
      context.strokeStyle = '#45e0ff';
      context.fillStyle = 'rgba(3, 15, 26, 0.88)';
      context.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const labelWidth = context.measureText(label).width + 12;
      context.fillRect(x1, Math.max(0, y1 - 24), labelWidth, 24);
      context.fillStyle = '#eaffff';
      context.fillText(label, x1 + 6, Math.max(16, y1 - 7));
    });
  }

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach((track) => track.stop());
  }

  async function submitSnapshot(fetchImpl, sessionId, payload, clock = performance.now.bind(performance)) {
    const started = clock();
    const response = await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    const uploadMs = Math.max(0, Number((clock() - started).toFixed(1)));
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('invalid_server_response');
    }
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.error?.code || 'snapshot_failed');
      error.status = response.status;
      error.code = body?.error?.code || 'snapshot_failed';
      throw error;
    }
    return {
      payload: body,
      uploadMs,
      responseBytes: new TextEncoder().encode(text).byteLength
    };
  }

  function devLog(event, detail = {}) {
    if (typeof console !== 'undefined' && console.info) console.info(event, detail);
  }

  function isCameraFrameReady(stream, video) {
    const track = stream?.getVideoTracks?.()[0];
    const enoughData = video?.readyState === undefined || video.readyState >= 2;
    return Boolean(track && track.readyState !== 'ended' && enoughData && video.videoWidth > 0 && video.videoHeight > 0);
  }

  async function performCaptureInteraction({ captureFrame, sendImage, setBusy, onError, log = devLog }) {
    log('CAPTURE_CLICKED');
    setBusy(true);
    try {
      const captured = captureFrame();
      log('FRAME_CAPTURED', { width: captured.width, height: captured.height });
      log('JPEG_ENCODED', { encode_ms: captured.encodeMs, bytes: Math.round((captured.imageData.length - captured.imageData.indexOf(',') - 1) * 0.75) });
      await sendImage(captured);
    } catch (error) {
      onError(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  function triggerFilePicker(fileInput, log = devLog) {
    log('UPLOAD_CLICKED');
    fileInput.click();
  }

  async function performUploadInteraction(file, useFile, log = devLog) {
    if (!file) return false;
    log('FILE_SELECTED', { name: file.name || '', type: file.type || '' });
    await useFile(file);
    return true;
  }

  function detectionResultHtml(detections) {
    if (!detections.length) return '<li class="empty-result">未識別到目標零件</li>';
    return detections.map((item) =>
      `<li><strong>${escapeHtml(item.class)}</strong><span>${(item.confidence * 100).toFixed(1)}%</span><code>[${item.box.join(', ')}]</code></li>`
    ).join('');
  }
  async function parseJsonResponse(response) {
    const body = await response.json();
    if (!response.ok) { const error = new Error(body?.error?.message || 'request_failed'); error.status = response.status; error.code = body?.error?.code; throw error; }
    return body;
  }

  async function confirmStep(fetchImpl, sessionId) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  }

  async function simulateVision(fetchImpl, sessionId, scenario) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/simulate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario }) }));
  }

  async function saveTrainingEvidence(fetchImpl, sessionId, evidence) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/evidence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evidence) }));
  }

  // P1-1 (AI Model Center): student uploads a YOLO .pt as an inert EvidenceRecord.
  async function submitP1ModelOutcome(fetchImpl, sessionId, file, note) {
    if (!file) throw new Error('請選擇 .pt 模型檔');
    if (!String(file.name).toLowerCase().endsWith('.pt')) throw new Error('僅接受 .pt 檔案');
    return saveTrainingEvidence(fetchImpl, sessionId, {
      evidence_type: 'YOLO_MODEL',
      source: 'STUDENT_UPLOAD',
      file_reference: `dev-upload://${file.name}`,
      metadata: {
        model_filename: file.name,
        model_task_type: 'PROP_DETECTION',
        size_bytes: file.size || 0,
        student_note: String(note || '').slice(0, 500),
      },
    });
  }

  async function fetchP1ModelSubmissions(fetchImpl, sessionId) {
    const response = await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/model-submissions`, {
      headers: { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' },
    });
    return parseJsonResponse(response);
  }

  async function reviewP1ModelSubmission(fetchImpl, sessionId, evidenceId, decision, note = '') {
    const response = await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/model-submissions/${encodeURIComponent(evidenceId)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' },
      body: JSON.stringify({ decision, note }),
    });
    return parseJsonResponse(response);
  }

  // P1-2：教師主動觸發 PROP Sandbox Benchmark；結果僅供審核，不會部署
  async function startP1Benchmark(fetchImpl, sessionId, evidenceId) {
    const response = await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/model-submissions/${encodeURIComponent(evidenceId)}/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' },
      body: '{}',
    });
    return parseJsonResponse(response);
  }

  async function fetchP1Benchmarks(fetchImpl, sessionId, evidenceId) {
    const response = await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/model-submissions/${encodeURIComponent(evidenceId)}/benchmarks`, {
      headers: { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' },
    });
    return parseJsonResponse(response);
  }

  // 將 Benchmark 結果轉為教師可讀的摘要
  function renderP1Benchmark(body) {
    const benchmark = body?.benchmark || {};
    const metrics = benchmark.metrics || {};
    const vset = body?.validation_set || {};
    const runtime = body?.runtime || {};
    const rows = [
      `狀態：${benchmark.status || '—'}`,
      `模型類別：${(benchmark.model_classes || []).join(', ') || '—'}`,
      `Validation Set：${vset.validation_set || '—'} · ${vset.available ? 'AVAILABLE' : 'NOT AVAILABLE'}`,
      `Runtime：${runtime.ready ? 'READY' : 'MISSING'}（ultralytics=${runtime.ultralytics || '—'} / torch=${runtime.torch || '—'}）`,
      `Real Model：${benchmark.model_file_hash && benchmark.model_file_hash !== 'NOT_AVAILABLE' ? 'READY' : 'MISSING'}`,
      `Real Metrics：${Object.keys(metrics).length ? 'AVAILABLE' : 'PENDING'}`,
    ];
    if (Object.keys(metrics).length) {
      rows.push(`Precision：${metrics.precision ?? '—'}`);
      rows.push(`Recall：${metrics.recall ?? '—'}`);
      rows.push(`mAP50：${metrics.map50 ?? '—'}`);
      rows.push(`mAP50-95：${metrics.map50_95 ?? '—'}`);
      rows.push(`Inference Time：${metrics.inference_time_ms ?? '—'} ms`);
    } else {
      rows.push('指標：尚無（等待 Golden Set 或驗證失敗）');
    }
    return rows.map((row) => `<p>${escapeHtml(row)}</p>`).join('');
  }

  async function saveTrainingReflection(fetchImpl, sessionId, reflection) {
    if (!String(reflection?.original_text || '').trim()) throw new Error('student_original_summary_required');
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/reflection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reflection) }));
  }

  async function submitTeacherReview(fetchImpl, sessionId, decision, note = '', taskId = null, stepId = null) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/teacher-review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' }, body: JSON.stringify({ task_id: taskId, step_id: stepId, decision, note }) }));
  }

  // ---- MP-12 Frontend Integration：只呼叫 Backend 既有 3 支 endpoint，不在前端複製任何狀態邏輯 ----
  async function selectMpSubtask(fetchImpl, sessionId, subtaskId) {
    return parseJsonResponse(await fetchImpl(
      `/api/live/sessions/${encodeURIComponent(sessionId)}/training/mp12/${encodeURIComponent(subtaskId)}/select`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    ));
  }

  async function completeMpSubtask(fetchImpl, sessionId, subtaskId) {
    return parseJsonResponse(await fetchImpl(
      `/api/live/sessions/${encodeURIComponent(sessionId)}/training/mp12/${encodeURIComponent(subtaskId)}/complete`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
    ));
  }

  async function submitMpTeacherReview(fetchImpl, sessionId, subtaskId, review) {
    // 教師權限沿用 Main v2.0 既有機制：X-FDE-Role + X-FDE-Teacher-ID（不重新引入 MP-12 原 repo 的 PIN Gate）
    return parseJsonResponse(await fetchImpl(
      `/api/live/sessions/${encodeURIComponent(sessionId)}/training/mp12/${encodeURIComponent(subtaskId)}/teacher-review`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' },
        body: JSON.stringify({ teacher_id: 'MOCK_TEACHER', decision: review.decision, reason: review.reason, note: review.note })
      }
    ));
  }

  async function fetchTrainingTaskView(fetchImpl, sessionId, taskId) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/tasks/${encodeURIComponent(taskId)}`));
  }

  async function submitTrainingStepFact(fetchImpl, sessionId, stepId, fact = 'LEARNER_CONFIRMED') {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/steps/${encodeURIComponent(stepId)}/facts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fact }) }));
  }

  async function acknowledgeTrainingStepSafety(fetchImpl, sessionId, stepId) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/steps/${encodeURIComponent(stepId)}/safety-ack`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  }

  async function setClassroomValidation(fetchImpl, sessionId, enabled) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/classroom-validation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: Boolean(enabled) })
    }));
  }

  async function recordClassroomEvent(fetchImpl, sessionId, event) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/classroom-validation/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event)
    }));
  }

  async function fetchClassroomValidationReport(fetchImpl, sessionId) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/classroom-validation/report`));
  }

  const STUDENT_LABELS = Object.freeze({
    FC_MAIN_OUT_1: '飛控 MAIN OUT 1（1號電機輸出接口）',
    FC_MAIN_OUT_2: '飛控 MAIN OUT 2（2號電機輸出接口）',
    FC_MAIN_OUT_3: '飛控 MAIN OUT 3（3號電機輸出接口）',
    FC_MAIN_OUT_4: '飛控 MAIN OUT 4（4號電機輸出接口）',
    ERR_POWER_POLARITY: '電源正負極需要重新確認。'
  });

  function studentFacingLabel(identifier) {
    if (!identifier) return '—';
    return STUDENT_LABELS[identifier] || String(identifier).replaceAll('_', ' ').toLowerCase();
  }

  const STUDENT_TASK_STATUS = Object.freeze({
    NOT_STARTED: '未開始',
    IN_PROGRESS: '進行中',
    PENDING_TEACHER_REVIEW: '待教師確認',
    NEED_REWORK: '需重新檢查',
    COMPLETED: '已完成',
    BLOCKED: '尚未解鎖'
  });

  function studentTaskStatus(status) {
    return STUDENT_TASK_STATUS[status] || '準備中';
  }

  const TASK_COMPLETION_POLICIES = Object.freeze({
    TASK_01: 'AI_ASSISTED_COMPLETE', TASK_02: 'TEACHER_CONFIRM', TASK_03: 'AI_ASSISTED_COMPLETE',
    TASK_04: 'TEACHER_CONFIRM', TASK_05: 'HYBRID_CONFIRM', TASK_06: 'TEACHER_CONFIRM',
    TASK_07: 'HYBRID_CONFIRM', TASK_08: 'HYBRID_CONFIRM', TASK_09: 'AI_ASSISTED_COMPLETE',
    TASK_10: 'TEACHER_CONFIRM', TASK_11: 'TEACHER_CONFIRM', TASK_12: 'TEACHER_CONFIRM'
  });

  function taskCompletionPolicy(taskId) { return TASK_COMPLETION_POLICIES[taskId] || 'LEARNER_COMPLETE'; }
  function showTaskMap(elements) { if (elements.taskMapScreen) elements.taskMapScreen.hidden = false; if (elements.taskDetailScreen) elements.taskDetailScreen.hidden = true; }
  function showTaskDetail(elements) { if (elements.taskMapScreen) elements.taskMapScreen.hidden = true; if (elements.taskDetailScreen) elements.taskDetailScreen.hidden = false; }

  function initializeStudentTaskMap(elements, training) {
    renderTrainingState(elements, training || {});
    showTaskMap(elements);
  }

  function renderTaskMapLoadError(elements) {
    if (elements.trainingTaskList) elements.trainingTaskList.innerHTML = '<li class="task-map-error">任務地圖載入失敗。<button type="button" data-retry-task-map>重新載入</button></li>';
    showTaskMap(elements);
  }

  function bindTaskMapRetry(container, retry) {
    container?.addEventListener('click', async (event) => {
      if (!event.target.closest?.('[data-retry-task-map]')) return;
      await retry();
    });
  }

  async function handleVoiceTranscript(transcript, setInput, submit) {
    const question = String(transcript || '').trim();
    if (!question) return;
    setInput(question);
    await submit(question);
  }

  function questionRequiresVision(question = '') {
    const value = String(question);
    // 安全相關問題不靠畫面判斷（簡繁體都要排除）
    if (/上電|上電|通電|通電|解鎖|解鎖|起飛|起飛|馬達測試|馬達測試|電機測試|電機測試|failsafe|prearm|飛前|飛前|放行|真實飛行|真實飛行|安全/i.test(value)) return false;
    // 2026-11-04：補上繁體與口語說法，鏡頭開著時學員這樣問，AI 會讀取當前畫面
    return /幫我看|幫我看|看一下|看看|畫面|畫面|鏡頭|鏡頭|這個是什麼|這個是什麼|這是什麼|對不對|對不對|對嗎|對嗎|正不正確|裝好了|裝好了|裝對|裝對|裝錯|裝錯|有沒有問題|有沒有問題|方向|接對|接對|接線|接線|插對|插對|槳葉|槳葉|螺旋槳|螺旋槳|電調|電調|飛控|飛控|馬達|馬達/i.test(value);
  }

  function cameraPreviewPolicy() {
    return { localPreview: true, continuousVision: false, captureMode: 'explicit_single_frame' };
  }

  const TRADITIONAL_STUDENT_REPLACEMENTS = [
    ['需要教師確認', '需要教師確認'],
    ['目前畫面', '目前畫面'],
    ['實訓', '實訓'], ['關鍵', '關鍵'], ['教師', '教師'], ['複核', '複核'], ['整體', '整體'],
    ['當前', '當前'], ['任務', '任務'], ['建議', '建議'], ['攝像頭', '攝像頭'], ['頁面', '頁面'],
    ['複製', '複製'], ['鏈接', '連結'], ['服務', '服務'], ['視覺', '視覺'], ['連接', '連線'],
    ['開啟', '開啟'], ['選擇', '選擇'], ['學習', '學習'], ['組裝', '組裝'], ['調參', '調參'],
    ['真機', '真機'], ['協助', '協助'], ['環節', '環節'], ['狀態', '狀態'], ['圖例', '圖例'],
    ['開始', '開始'], ['進行', '進行'], ['確認', '確認'], ['檢查', '檢查'], ['載入', '載入'],
    ['返回', '返回'], ['準備', '準備'], ['步驟', '步驟'], ['現在', '現在'], ['怎麼', '怎麼'],
    ['為什麼', '為什麼'], ['暫無', '暫無'], ['語音', '語音'], ['正在聽', '正在聽'], ['識別', '識別'],
    ['處理', '處理'], ['回答', '回答'], ['畫面', '畫面'], ['下一步', '下一步'], ['再試一次', '再試一次'],
    ['閱讀', '閱讀'], ['提醒', '提醒'], ['證據', '證據'], ['總結', '總結'], ['幫助', '幫助'],
    ['發送', '傳送'], ['關閉', '關閉'], ['切換', '切換'], ['上傳', '上傳'], ['設置', '設定'],
    ['錯誤', '錯誤'], ['網絡', '網路'], ['資料', '資料'], ['無法', '無法'], ['這個', '這個'],
    ['已經', '已經'], ['內容', '內容'], ['說明', '說明'], ['進入', '進入'], ['完成', '完成']
  ];

  function toTraditionalStudentText(value) {
    return TRADITIONAL_STUDENT_REPLACEMENTS.reduce((text, pair) => text.split(pair[0]).join(pair[1]), String(value ?? ''));
  }

  function applyTraditionalStudentLanguage(root, MutationObserverImpl = typeof MutationObserver === 'undefined' ? null : MutationObserver) {
    if (!root) return null;
    const translateNode = (node) => {
      if (node?.nodeType === 3) {
        const translated = toTraditionalStudentText(node.nodeValue);
        if (translated !== node.nodeValue) node.nodeValue = translated;
        return;
      }
      if (!node?.querySelectorAll) return;
      const walker = node.ownerDocument?.createTreeWalker?.(node, 4);
      if (walker) { let textNode; while ((textNode = walker.nextNode())) translateNode(textNode); }
      for (const element of [node, ...node.querySelectorAll('[placeholder],[title],[aria-label]')]) {
        for (const attr of ['placeholder', 'title', 'aria-label']) {
          if (element?.hasAttribute?.(attr)) element.setAttribute(attr, toTraditionalStudentText(element.getAttribute(attr)));
        }
      }
    };
    translateNode(root);
    if (!MutationObserverImpl) return null;
    const observer = new MutationObserverImpl((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') translateNode(mutation.target);
        for (const node of mutation.addedNodes || []) translateNode(node);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return observer;
  }

  function assistantVisualActionState(cameraActive) {
    return cameraActive
      ? { action: 'OBSERVE_FRAME', label: '🤖 AI 看當前畫面' }
      : { action: 'OPEN_CAMERA', label: '📷 打開攝像頭' };
  }

  function voiceEntryState(supported) {
    return supported
      ? { label: '🎙 按住說話', available: true }
      : { label: '🎙 語音暫不可用', available: false };
  }

  function genericVisualObservationQuestion() {
    return '請看一下當前畫面，並結合我正在學習的步驟，用簡單的話告訴我看到了什麼、現在是否需要調整。';
  }

  function studentStepProgressLabel(step) {
    return step && Number(step.order) > 0 ? `當前第 ${Number(step.order)} 步` : '正在準備當前步驟…';
  }

  function studentCurrentStepView(step = {}) {
    if (step.step_id === 'T01_WORKSPACE') return {
      title: '準備工作區域',
      how: ['清空桌面', '把 F450 零件全部集中擺放', '電池先不要接電', '槳葉暫時不要安裝'],
      doneWhen: ['所有零件都在桌面', '飛機沒有接電', '槳葉沒有安裝', '工作區域沒有雜物']
    };
    const instruction = step.student_instruction || step.instruction || '依照當前提示完成這一項操作。';
    const doneWhen = [];
    if (step.evidence_required?.length) doneWhen.push('需要的學習證據已經保存');
    if (step.teacher_gate) doneWhen.push('教師已經現場確認');
    if (!doneWhen.length) doneWhen.push('當前操作已經完成，並與頁面說明一致');
    return { title: step.title || '正在準備當前步驟…', how: [instruction], doneWhen };
  }

  function detectBrowserCapabilities({ userAgent = '', mediaDevices = null, speechRecognition = null, speechSynthesis = null } = {}) {
    const embedded = /Aweme|BytedanceWebview|TikTok|musical_ly|Toutiao|NewsArticle|MicroMessenger|FBAN|FBAV/i.test(userAgent);
    const safari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|Chrome|Android/i.test(userAgent) && !embedded;
    const constraints = mediaDevices?.getSupportedConstraints?.() || {};
    return { browser: embedded ? 'Embedded WebView' : safari ? 'Safari' : 'Browser', embedded, camera: Boolean(mediaDevices?.getUserMedia), speechInput: Boolean(speechRecognition), speechOutput: Boolean(speechSynthesis), facingMode: Boolean(constraints.facingMode) };
  }

  function selectChineseVoice(voices = []) {
    return voices.find((voice) => /^zh[-_]TW$/i.test(voice.lang || ''))
      || voices.find((voice) => /^zh[-_]CN$/i.test(voice.lang || ''))
      || voices.find((voice) => /^zh/i.test(voice.lang || '')) || null;
  }

  function createSpeechReply({ synthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    const supported = Boolean(synthesis && Utterance);
    return {
      supported,
      speak(text, callbacks = {}) {
        if (!supported || !String(text || '').trim()) return false;
        synthesis.cancel();
        const utterance = new Utterance(String(text).trim());
        const voice = selectChineseVoice(synthesis.getVoices?.() || []);
        utterance.voice = voice;
        utterance.lang = voice?.lang || 'zh-TW';
        utterance.rate = 0.95;
        utterance.onstart = callbacks.onStart || null;
        utterance.onend = callbacks.onEnd || null;
        utterance.onerror = callbacks.onError || null;
        synthesis.speak(utterance);
        return true;
      },
      stop() { if (supported) synthesis.cancel(); }
    };
  }

  function voiceAnswerSummary(text = '') {
    const sentences = String(text).match(/[^。！？!?]+[。！？!?]?/g) || [];
    return sentences.slice(0, 3).join('').slice(0, 220);
  }

  function deliverAiAnswer(answer, { autoSpeak = false, speechReply = null, callbacks = {} } = {}) {
    const text = String(answer || '').trim();
    const spoken = Boolean(autoSpeak && speechReply?.speak(voiceAnswerSummary(text), callbacks));
    return { text, spoken };
  }

  async function askLiveCoach(fetchImpl, sessionId, question, captureCurrentFrame, options = {}) {
    const requestId = options.requestId || `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const interactionId = options.interactionId || requestId;
    const payload = { question: String(question || '').trim(), request_id: requestId, interaction_id: interactionId };
    if (questionRequiresVision(payload.question)) {
      const captured = captureCurrentFrame?.();
      if (!captured?.imageData) throw new Error('camera_frame_required');
      payload.image_data = captured.imageData;
    }
    const controller = options.controller || (typeof AbortController !== 'undefined' ? new AbortController() : null);
    const timeoutMs = options.timeoutMs ?? 20000;
    let timeout;
    try {
      const request = fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/ask`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FDE-Request-ID': requestId }, body: JSON.stringify(payload), signal: controller?.signal
      });
      const response = await Promise.race([
        request,
        new Promise((_, reject) => { timeout = setTimeout(() => { controller?.abort(); reject(new Error('ask_timeout')); }, timeoutMs); })
      ]);
      return parseJsonResponse(response);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function studentCoachMessage(state, teacherRequired = false) {
    const messages = {
      NO_DETECTION: '目前沒有清楚看到目標零件，請把零件完整放到鏡頭中央。',
      UNCERTAIN: 'AI 目前看不清楚，請調整角度或請老師確認。',
      NG: '目前看到的內容與這一步不符，請依照提示調整後再試一次。',
      PASS_CANDIDATE: 'AI 初步檢查沒有發現明顯問題。',
      TEACHER_CHECK: '此步驟涉及安全操作，必須由教師確認後才能繼續。',
      TASK_COMPLETED: '這個任務已經完成，可以準備下一項任務。'
    };
    const base = messages[state] || 'AI 助教已準備好，可以在需要時幫你檢查。';
    return teacherRequired && state !== 'TEACHER_CHECK' ? `${base} 下一步請等待教師複核。` : base;
  }

  function studentTeacherStatus(status) {
    const labels = {
      NOT_REQUIRED: '當前步驟無需教師確認',
      REQUIRED: '此步驟需要教師確認',
      PENDING: '等待教師確認',
      PENDING_TEACHER_REVIEW: '等待教師確認',
      APPROVE: '教師已確認',
      APPROVED: '教師已確認',
      REJECT_REWORK: '教師要求重新檢查',
      NEED_REWORK: '需依照教師意見重新檢查'
    };
    return labels[status] || '當前步驟無需教師確認';
  }

  function shouldTriggerVision(training, reason) {
    if (reason === 'student_request') return true;
    if (!['sop_vision_check', 'auto_observation'].includes(reason)) return false;
    return Boolean(training?.task?.vision_tasks?.length);
  }

  const STUDENT_STEP_GROUP_DEFINITIONS = Object.freeze({
    TASK_01: [['準備區域',['T01_WORKSPACE']],['認識零件',['T01_FRAME','T01_MOTORS','T01_ESC','T01_PIXHAWK','T01_GPS','T01_ACCESSORIES']],['完成清點',['T01_CHECKLIST']],['AI 輔助檢查',[]],['證據與總結',['T01_EVIDENCE','T01_REFLECTION']]],
    TASK_02: [['瞭解測試',['T02_PURPOSE','T02_NO_PROP']],['準備連接',['T02_TESTER','T02_CONNECT_SET1']],['教師確認',['T02_PREPOWER_TEACHER']],['測試四組',['T02_M1','T02_M2','T02_M3','T02_M4','T02_CROSS_TEST']],['複核與記錄',['T02_FINAL_TEACHER','T02_RECORD']]],
    TASK_03: [['準備機架',['T03_LAYOUT','T03_FORWARD','T03_ARMS','T03_FRAME_CHECK']],['確認位置',['T03_TESTED_MOTORS','T03_POSITIONS']],['安裝馬達',['T03_SCREW','T03_INSTALL']],['完成檢查',['T03_MECHANICAL']],['證據與總結',['T03_EVIDENCE','T03_REFLECTION']]],
    TASK_04: [['認識與規劃',['T04_ESC_SIGNAL','T04_ROUTING']],['極性與絕緣',['T04_HEATSHRINK','T04_PDB_POLARITY','T04_XT60']],['焊接前確認',['T04_PRESOLDER_TEACHER']],['焊接與電氣檢查',['T04_SOLDER','T04_VISUAL','T04_CONTINUITY','T04_ELECTRICAL_APPROVAL']],['證據與總結',['T04_EVIDENCE','T04_REFLECTION']]],
    TASK_05: [['安裝飛控',['T05_PIXHAWK','T05_ARROW']],['連接馬達輸出',['T05_MAIN_OUT']],['安裝 GPS',['T05_GPS_INSTALL','T05_GPS_DIRECTION','T05_GPS_CONNECT']],['連接外設',['T05_RECEIVER','T05_TELEMETRY','T05_POWER_MODULE']],['證據與複核',['T05_EVIDENCE','T05_REVIEW']]],
    TASK_06: [['機械檢查',['T06_MECHANICAL','T06_MOTOR_SCREW']],['電氣檢查',['T06_ESC_WIRING','T06_POLARITY']],['飛控與外設',['T06_FC','T06_GPS','T06_RADIO']],['證據與自檢',['T06_EVIDENCE','T06_SELF_CHECK']],['教師放行與總結',['T06_TEACHER_RELEASE','T06_REFLECTION']]],
    TASK_07: [['首次上電前確認',['T07_PREPOWER_REVIEW','T07_FIRST_POWER_TEACHER']],['連接 Mission Planner',['T07_MP_CONNECT']],['飛控與機架確認',['T07_FC_FIRMWARE_AIRFRAME']],['加速度計校準',['T07_ACCEL_PREP','T07_ACCEL_CALIBRATION']],['羅盤校準',['T07_COMPASS_PREP','T07_COMPASS_CALIBRATION']],['遙控器校準',['T07_RADIO_PREP','T07_RADIO_CALIBRATION']],['Receiver 狀態',['T07_RECEIVER_STATUS']],['Motor 輸出映射',['T07_MOTOR_OUTPUT_MAPPING']],['飛行模式',['T07_FLIGHT_MODES']],['失控保護',['T07_FAILSAFE']],['GPS 狀態',['T07_GPS_STATUS']],['RTL 返航',['T07_RTL']],['基礎參數',['T07_BASE_PARAMETERS']],['配置總複核',['T07_FINAL_CONFIG_REVIEW']],['證據與總結',['T07_EVIDENCE','T07_REFLECTION']]]
  });

  function studentStepGroupDefinitions(taskId) {
    return (STUDENT_STEP_GROUP_DEFINITIONS[taskId] || []).map(([title, stepIds], index) => ({ id: `${taskId}_GROUP_${index + 1}`, title, step_ids: [...stepIds] }));
  }

  function studentStepGroups(taskId, steps = [], currentStepId = '', taskState = 'IN_PROGRESS') {
    let definitions = studentStepGroupDefinitions(taskId);
    if (!definitions.length) definitions = steps.map((step, index) => ({ id: `${taskId || 'TASK'}_GROUP_${index + 1}`, title: step.title || `步驟 ${index + 1}`, step_ids: [step.step_id || step.id] }));
    const orderById = new Map(steps.map((step, index) => [step.step_id || step.id, index]));
    const currentIndex = orderById.has(currentStepId) ? orderById.get(currentStepId) : 0;
    return definitions.map((group, groupIndex) => {
      const indices = group.step_ids.map((id) => orderById.get(id)).filter(Number.isInteger);
      let state = 'FUTURE';
      if (taskState === 'COMPLETED') state = 'COMPLETED';
      else if (group.step_ids.includes(currentStepId) || (!group.step_ids.length && steps[currentIndex]?.vision_task)) state = 'CURRENT';
      else if (indices.length && Math.max(...indices) < currentIndex) state = 'COMPLETED';
      else if (!currentStepId && groupIndex === 0) state = 'CURRENT';
      return { ...group, state };
    });
  }

  function studentStepToolVisibility(step = {}) {
    const stepId = step.step_id || step.id || '';
    return {
      camera: true,
      aiCheck: Boolean(step.vision_task),
      evidence: Boolean(step.evidence_required?.length),
      reflection: /REFLECTION$/.test(stepId) || /學習總結/.test(step.title || ''),
      teacher: Boolean(step.teacher_gate),
      safety: Boolean(step.safety_reminders?.length)
    };
  }

  function studentPrimaryAction(training = {}) {
    if (training.task_state === 'COMPLETED') return { kind: 'MAP', label: '返回任務地圖' };
    if (training.task_state === 'PENDING_TEACHER_REVIEW') return { kind: 'WAIT', label: '等待教師確認' };
    if (training.task_state === 'NEED_REWORK') return { kind: 'REWORK', label: '重新完成這一步' };
    if (training.task_state === 'NOT_STARTED' || training.task_state === 'BLOCKED') return { kind: 'START', label: '開始任務' };
    const step = training.current_step || {};
    const taskId = training.task?.id || training.current_task_id;
    if (taskId === 'TASK_08' && step.step_id === 'T08_TEACHER_FINAL_REVIEW') return { kind: 'TEACHER', label: '請教師最終複核' };
    if (step.teacher_gate) return { kind: 'TEACHER', label: '請教師確認' };
    if (step.evidence_required?.length) return { kind: 'EVIDENCE', label: '保存學習證據' };
    if (/REFLECTION$/.test(step.step_id || step.id || '') || /學習總結/.test(step.title || '')) return { kind: 'REFLECTION', label: '保存學習總結' };
    if (!training.current_training_step_id && !Object.keys(step).length) return training.task?.teacher_review_required
      ? { kind: 'TASK_REVIEW', label: '提交教師複核' }
      : { kind: 'TASK_COMPLETE', label: '完成任務' };
    if (taskId === 'TASK_08') return { kind: 'STEP', label: '記錄檢查結果' };
    return { kind: 'STEP', label: '我完成了' };
  }

  function trainingCompletionFeedback(previousStepId, currentStepId, taskState) {
    if (taskState === 'COMPLETED') return { type: 'TASK', title: 'Task 已完成', canContinue: true };
    if (previousStepId && currentStepId && previousStepId !== currentStepId) return { type: 'STEP', title: '✅ 這一步完成', canContinue: true };
    return null;
  }

  // ---- MP-12 Frontend Integration（SELECTIVE PORT from MP-12 repo；Backend 為唯一權威） ----

  function mpSubtaskAction(subtask = {}) {
    if (subtask.status === 'COMPLETED') return { kind: 'DONE', label: '此子任務已完成', disabled: true };
    if (subtask.status === 'PENDING_TEACHER_REVIEW') return { kind: 'WAIT', label: '等待教師現場確認', disabled: true };
    if (subtask.teacher_required) return { kind: 'COMPLETE', label: '我已完成，請教師複核', disabled: false };
    return { kind: 'COMPLETE', label: subtask.status === 'NEED_REWORK' ? '重新完成並提交' : '完成此子任務', disabled: false };
  }

  function setMp12View(elements, requestedView, { scroll = false } = {}) {
    const view = requestedView === 'DETAIL' ? 'DETAIL' : 'MAP';
    const detailVisible = view === 'DETAIL';
    if (elements.mp12MapView) elements.mp12MapView.hidden = detailVisible;
    if (elements.mp12DetailView) elements.mp12DetailView.hidden = !detailVisible;
    if (elements.missionPlannerPanel) elements.missionPlannerPanel.dataset.view = view;
    if (detailVisible && scroll && typeof elements.mp12DetailView?.scrollIntoView === 'function') {
      elements.mp12DetailView.scrollIntoView({ block: 'start' });
    }
    return view;
  }

  function renderMissionPlannerState(elements, missionPlanner = null, { devMode = false } = {}) {
    if (!missionPlanner || !Array.isArray(missionPlanner.items)) {
      if (elements.missionPlannerPanel) elements.missionPlannerPanel.hidden = true;
      return;
    }
    const current = missionPlanner.current_subtask
      || missionPlanner.items.find((item) => item.subtask_id === missionPlanner.current_subtask_id)
      || missionPlanner.items[0]
      || {};
    if (elements.missionPlannerPanel) elements.missionPlannerPanel.hidden = false;
    if (elements.mp12Progress) elements.mp12Progress.textContent = missionPlanner.progress || '0 / 12';
    if (elements.mp12TaskList) {
      elements.mp12TaskList.innerHTML = missionPlanner.items.map((item) => {
        const status = item.status || 'NOT_STARTED';
        return `<li data-state="${escapeHtml(status)}"><button type="button" data-mp-subtask="${escapeHtml(item.subtask_id)}"><strong>${escapeHtml(item.subtask_id)}</strong><span>${escapeHtml(item.title)}</span><small>${escapeHtml(studentTaskStatus(status))}</small></button></li>`;
      }).join('');
    }
    if (elements.mp12Title) elements.mp12Title.textContent = `${current.subtask_id || ''}｜${current.title || '等待選擇'}`;
    if (elements.mp12Objective) elements.mp12Objective.textContent = current.objective || '—';
    if (elements.mp12Procedure) elements.mp12Procedure.innerHTML = (current.procedure || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (elements.mp12Checks) elements.mp12Checks.innerHTML = (current.completion_checks || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    // 安全提示僅為顯示；安全放行由 Backend Safety Gate 判定，前端不自行判定
    if (elements.mp12Safety) elements.mp12Safety.innerHTML = (current.safety_rules || []).map((item) => `<p>⚠ ${escapeHtml(item)}</p>`).join('');
    if (elements.mp12Evidence) elements.mp12Evidence.textContent = (current.evidence_types || []).join(' / ') || '不強制上傳';
    const action = mpSubtaskAction(current);
    if (elements.mp12CompleteSubtask) {
      elements.mp12CompleteSubtask.textContent = action.label;
      elements.mp12CompleteSubtask.dataset.action = action.kind;
      elements.mp12CompleteSubtask.disabled = action.disabled;
    }
    if (elements.mp12TeacherReview) {
      elements.mp12TeacherReview.hidden = !(
        devMode
        && current.teacher_required
        && current.status === 'PENDING_TEACHER_REVIEW'
      );
    }
    if (elements.mp12CompletedBanner) {
      elements.mp12CompletedBanner.hidden = missionPlanner.completed !== true;
    }
  }

  function renderTrainingState(elements, training = {}) {
    const task = training.task || {};
    const step = training.current_step || task.steps?.find((item) => item.step_id === training.current_training_step_id) || task.steps?.[0] || {};
    const order = Number(task.order || 1);
    const reminders = task.safety_reminders || [];
    const steps = task.steps || [];
    if (elements.trainingProgress) elements.trainingProgress.textContent = training.progress || '0 / 12';
    if (elements.mapProgress) elements.mapProgress.textContent = training.progress || '0 / 12';
    if (elements.trainingTaskNumber) elements.trainingTaskNumber.textContent = `Task ${String(order).padStart(2, '0')} / 12`;
    if (elements.trainingTitle) elements.trainingTitle.textContent = task.title || '等待任務資料';
    if (elements.trainingObjective) elements.trainingObjective.textContent = task.objective || '—';
    if (elements.trainingStepNumber) elements.trainingStepNumber.textContent = studentStepProgressLabel(step);
    if (elements.trainingAction) elements.trainingAction.textContent = step.student_instruction || step.instruction || task.description || '—';
    if (elements.trainingWhy) elements.trainingWhy.textContent = step.why_it_matters || step.rationale || task.description || '—';
    const taskId = task.id || task.task_id || training.current_task_id || `TASK_${String(order).padStart(2, '0')}`;
    // AI PID 與濾波實驗室入口：只在 TASK_07 / TASK_08 顯示，純連結，不影響步驟與完成條件。
    const pidLabLink = elements.trainingObjective?.ownerDocument?.getElementById?.('pidLabLink');
    if (pidLabLink) pidLabLink.hidden = !(taskId === 'TASK_07' || taskId === 'TASK_08');
    const task08Check = taskId === 'TASK_08' && step.step_id !== 'T08_TEACHER_FINAL_REVIEW';
    // MP-12 只屬於 TASK_07：沒有 mission_planner payload 就一律 hidden（TASK_01～06 / TASK_08～12 不顯示）
    const isMissionPlanner = taskId === 'TASK_07' && Boolean(training.mission_planner);
    renderMissionPlannerState(elements, isMissionPlanner ? training.mission_planner : null, { devMode: Boolean(elements.devMode) });
    const groups = studentStepGroups(taskId, steps, training.current_training_step_id, training.task_state);
    const activeGroup = groups.findIndex((group) => group.state === 'CURRENT');
    const stepView = studentCurrentStepView(step);
    const stepReminders = step.safety_reminders === undefined ? reminders : (step.safety_reminders || []);
    const visibility = studentStepToolVisibility({ ...step, safety_reminders: stepReminders });
    if (elements.currentStepTitle) elements.currentStepTitle.textContent = step.title || '等待當前步驟';
    if (elements.currentStepHow) elements.currentStepHow.innerHTML = stepView.how.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (elements.currentStepDoneWhen) elements.currentStepDoneWhen.innerHTML = stepView.doneWhen.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (elements.studentGroupProgress) elements.studentGroupProgress.innerHTML = groups.map((group, index) => `<li data-state="${group.state}"><span>${group.state === 'COMPLETED' ? '✓' : index + 1}</span><strong>${escapeHtml(group.title)}</strong></li>`).join('');
    if (elements.studentGroupCount) elements.studentGroupCount.textContent = `第 ${Math.max(0, activeGroup) + 1} 階段 · ${groups[Math.max(0, activeGroup)]?.title || '準備'}`;
    if (elements.trainingSafety) elements.trainingSafety.innerHTML = stepReminders.map((item) => `<p>⚠ ${escapeHtml(item.message || studentFacingLabel(item.id))}</p>`).join('');
    if (elements.safetyCard) elements.safetyCard.hidden = !visibility.safety;
    if (elements.cameraTool) elements.cameraTool.hidden = false;
    if (elements.capture) elements.capture.hidden = true;
    if (elements.evidenceCard) elements.evidenceCard.hidden = !visibility.evidence;
    if (elements.reflectionCard) elements.reflectionCard.hidden = !visibility.reflection;
    if (elements.teacherCard) elements.teacherCard.hidden = !visibility.teacher;
    if (elements.trainingSteps) elements.trainingSteps.innerHTML = step.title ? `<li><strong>${escapeHtml(step.title)}</strong><br>${escapeHtml(step.instruction || '')}</li>` : '<li>等待任務步驟。</li>';
    if (elements.trainingStepList) elements.trainingStepList.innerHTML = steps.map((item) => `<li data-state="${escapeHtml(item.progress?.status || 'NOT_STARTED')}">${escapeHtml(item.title)}</li>`).join('');
    const conditions = [];
    if (step.safety_reminders?.length) conditions.push(step.progress?.safety_acknowledged ? '☑ 已閱讀安全提醒' : '□ 已閱讀安全提醒');
    if (step.evidence_required?.length) conditions.push(`□ Evidence：${step.evidence_required.join(', ')}`);
    if (step.teacher_gate) conditions.push(step.progress?.teacher_decision === 'APPROVE' ? '☑ 教師已通過' : '□ 等待教師確認');
    if (!conditions.length) conditions.push('□ 學生確認完成實際操作');
    if (task08Check && step.step_id === 'T08_PROP_VISION') conditions.push(`PROP Vision：${training.prop_vision_status || 'PENDING'}`);
    if (elements.trainingCompletionConditions) elements.trainingCompletionConditions.innerHTML = conditions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (elements.task08CheckStatusField) elements.task08CheckStatusField.hidden = !task08Check;
    if (elements.task08CheckStatus && task08Check) {
      const indoor = elements.task08CheckStatus.querySelector?.('option[value="NOT_AVAILABLE_INDOOR"]');
      const visionPending = elements.task08CheckStatus.querySelector?.('option[value="VISION_MODEL_NOT_READY"]');
      if (indoor) indoor.disabled = step.step_id !== 'T08_GPS_COMPASS_STATUS';
      if (visionPending) visionPending.disabled = step.step_id !== 'T08_PROP_VISION';
      if (step.step_id === 'T08_PROP_VISION' && training.prop_vision_status !== 'READY') elements.task08CheckStatus.value = 'VISION_MODEL_NOT_READY';
      // 注意：VISION_MODEL_NOT_READY 絕不被自動改寫為 PASS（需求 #7：不可用不得偽裝成檢測通過）。
      // 僅當 NOT_AVAILABLE_INDOOR 出現在非 GPS 步驟時，才回退為 PASS 默認值。
      else if (elements.task08CheckStatus.value === 'NOT_AVAILABLE_INDOOR' && step.step_id !== 'T08_GPS_COMPASS_STATUS') elements.task08CheckStatus.value = 'PASS';
    }
    if (elements.safetyAcknowledgment) elements.safetyAcknowledgment.hidden = !step.safety_reminders?.length;
    if (elements.acknowledgeTrainingSafety) elements.acknowledgeTrainingSafety.checked = Boolean(step.progress?.safety_acknowledged);
    const primary = studentPrimaryAction({ ...training, current_step: step });
    if (elements.primaryTrainingAction) {
      elements.primaryTrainingAction.textContent = primary.label;
      elements.primaryTrainingAction.dataset.action = primary.kind;
      elements.primaryTrainingAction.disabled = primary.kind === 'WAIT' || training.unsafe_action_allowed === false || (step.safety_reminders?.length && !step.progress?.safety_acknowledged);
    }
    if (elements.trainingStatus) elements.trainingStatus.textContent = studentTaskStatus(training.task_state || 'NOT_STARTED');
    if (elements.trainingEvidence) elements.trainingEvidence.textContent = String(training.evidence_count || 0);
    if (elements.trainingReflection) elements.trainingReflection.textContent = training.reflection_state === 'available' ? '學習總結已保存' : '尚未填寫';
    if (elements.trainingTeacher) elements.trainingTeacher.textContent = studentTeacherStatus(training.teacher_review_state || 'NOT_REQUIRED');
    if (elements.trainingGrowth) elements.trainingGrowth.textContent = `${training.progress || '0 / 12'} · 待同步`;
    if (elements.trainingPrerequisite) elements.trainingPrerequisite.textContent = training.unsafe_action_allowed === false ? '你可以先學習這一部分；當前危險操作需要先完成安全檢查並由教師確認。' : '可以開始學習';
    if (elements.cameraWaiting && training.camera_active === true) elements.cameraWaiting.textContent = 'ACTIVE / WAITING';
    if (elements.trainingTaskList && Array.isArray(training.tasks)) elements.trainingTaskList.innerHTML = training.tasks.map((item) => {
      const status = item.status || 'NOT_STARTED';
      const blocked = status === 'BLOCKED' ? '可學習 / 當前不可正式執行' : studentTaskStatus(status);
      const stepProgress = item.step_progress || item.progress || '';
      return `<li data-state="${escapeHtml(status)}"><button type="button" data-view-task="${escapeHtml(item.task_id)}"><span class="task-number">${String(item.order).padStart(2, '0')}</span><strong>${escapeHtml(item.short_name || '')}</strong><span class="task-card-title">${escapeHtml(item.title)}</span>${stepProgress ? `<span class="task-step-count">${escapeHtml(stepProgress)}</span>` : ''}<small>${escapeHtml(blocked)}</small></button></li>`;
    }).join('');
    if (elements.taskCompleteFeedback) elements.taskCompleteFeedback.hidden = training.task_state !== 'COMPLETED';
  }

  function renderTaskState(elements, payload = {}) {
    const session = payload.session || payload;
    const task = payload.task || payload;
    if (task.course_title) elements.course.textContent = task.course_title;
    if (task.task_title) elements.task.textContent = task.task_title;
    if (task.progress) elements.progress.textContent = `${task.progress.current} / ${task.progress.total}`;
    if (task.step) { elements.step.textContent = task.step.title; elements.instruction.textContent = task.step.instruction; }
    else if (session.state === 'TASK_COMPLETED') { elements.step.textContent = 'TASK COMPLETED'; elements.instruction.textContent = '基礎零件準備完成。'; }
    if (payload.detection) elements.visionResult.textContent = `${payload.detection.class} ${(payload.detection.confidence * 100).toFixed(1)}%`;
    if (payload.sop) elements.sopResult.textContent = payload.sop.status;
    else if (session.state) elements.sopResult.textContent = session.state;
    if (payload.guidance) elements.guidance.textContent = payload.guidance.text;
    else if (elements.guidance && session.state) elements.guidance.textContent = studentCoachMessage(session.state, session.state === 'TEACHER_CHECK');
    const rag = payload.rag_explanation || session.rag_explanation;
    if (rag && elements.ragExplanation) {
      const explanation = rag.explanation || (rag.status === 'pending' ? '正在查詢教學知識…' : '目前知識庫說明暫時不可用。');
      elements.ragExplanation.textContent = rag.safety_notice ? `${rag.safety_notice} ${explanation}` : explanation;
      elements.ragSource.textContent = rag.source_type || rag.reference_summary ? 'FDE-AI RAG' : '—';
      elements.ragStatus.textContent = String(rag.status || 'idle').toUpperCase();
      elements.ragLatency.textContent = Number.isFinite(Number(rag.latency_ms)) ? `${Number(rag.latency_ms).toFixed(1)} ms` : '—';
    }
    if (elements.confirm) elements.confirm.disabled = session.state !== 'PASS_CANDIDATE';
    const training = payload.training || task.training;
    if (training) renderTrainingState(elements, training);
  }

  function autoStartError(cameraActive, sessionId) { if (!cameraActive) return 'camera_required'; if (!sessionId) return 'session_required'; return null; }

  function createController({ documentRef = document, navigatorRef = navigator, fetchImpl = fetch, storage = null } = {}) {
    const elements = {
      health: documentRef.querySelector('#backendStatus'),
      vision: documentRef.querySelector('#visionStatus'),
      cameraStatus: documentRef.querySelector('#cameraStatus'),
      cameraDevice: documentRef.querySelector('#cameraDevice'),
      cameraResolution: documentRef.querySelector('#cameraResolution'),
      cameraHint: documentRef.querySelector('#cameraHint'),
      cameraDiagnostics: documentRef.querySelector('#cameraDiagnostics'),
      video: documentRef.querySelector('#cameraPreview'),
      captureCanvas: documentRef.querySelector('#captureCanvas'),
      overlay: documentRef.querySelector('#detectionOverlay'),
      start: documentRef.querySelector('#startCamera'),
      switchCamera: documentRef.querySelector('#switchCamera'),
      currentCameraFacing: documentRef.querySelector('#currentCameraFacing'),
      capture: documentRef.querySelector('#captureFrame'),
      stop: documentRef.querySelector('#stopCamera'),
      file: documentRef.querySelector('#imageFile'),
      upload: documentRef.querySelector('#uploadImage'),
      uploadPreview: documentRef.querySelector('#uploadPreview'),
      results: documentRef.querySelector('#detectionResults'),
      metrics: documentRef.querySelector('#timingMetrics'),
      message: documentRef.querySelector('#liveMessage'),
      course: documentRef.querySelector('#courseTitle'), task: documentRef.querySelector('#taskTitle'), progress: documentRef.querySelector('#taskProgress'),
      step: documentRef.querySelector('#currentStep'), instruction: documentRef.querySelector('#taskInstruction'), visionResult: documentRef.querySelector('#visionResult'),
      sopResult: documentRef.querySelector('#sopResult'), guidance: documentRef.querySelector('#coachGuidance'), confirm: documentRef.querySelector('#confirmStep'), devPanel: documentRef.querySelector('#devSimulator'),
      ragExplanation: documentRef.querySelector('#ragExplanation'), ragSource: documentRef.querySelector('#ragSource'), ragStatus: documentRef.querySelector('#ragStatus'), ragLatency: documentRef.querySelector('#ragLatency'),
      enableVoiceCoach: documentRef.querySelector('#enableVoiceCoach'), pauseVoiceCoach: documentRef.querySelector('#pauseVoiceCoach'), liveCoachStatus: documentRef.querySelector('#liveCoachStatus'), userTranscriptLabel: documentRef.querySelector('#userTranscriptLabel'), lastUserTranscript: documentRef.querySelector('#lastUserTranscript'), latestAiAnswer: documentRef.querySelector('#latestAiAnswer'), fallbackMethods: documentRef.querySelector('#fallbackMethods'),
      pushToTalk: documentRef.querySelector('#pushToTalk'), textAskAi: documentRef.querySelector('#textAskAi'), assistantVisualAction: documentRef.querySelector('#assistantVisualAction'), askAiPanel: documentRef.querySelector('#askAiPanel'), askAiInput: documentRef.querySelector('#askAiInput'), submitAskAi: documentRef.querySelector('#submitAskAi'), cancelAiInteraction: documentRef.querySelector('#cancelAiInteraction'), askAiResponse: documentRef.querySelector('#askAiResponse'), answerSourceLabel: documentRef.querySelector('#answerSourceLabel'), voiceStatus: documentRef.querySelector('#voiceStatus'), voiceReplyControls: documentRef.querySelector('#voiceReplyControls'), playAiAnswer: documentRef.querySelector('#playAiAnswer'), stopAiAnswer: documentRef.querySelector('#stopAiAnswer'),
      trainingTaskList: documentRef.querySelector('#trainingTaskList'), trainingProgress: documentRef.querySelector('#trainingProgress'), mapProgress: documentRef.querySelector('#mapProgress'), trainingTaskNumber: documentRef.querySelector('#trainingTaskNumber'), trainingStepNumber: documentRef.querySelector('#trainingStepNumber'), trainingTitle: documentRef.querySelector('#trainingTitle'), trainingObjective: documentRef.querySelector('#trainingObjective'), trainingAction: documentRef.querySelector('#trainingAction'), trainingWhy: documentRef.querySelector('#trainingWhy'), trainingSafety: documentRef.querySelector('#trainingSafety'), trainingSteps: documentRef.querySelector('#trainingSteps'), trainingStepList: documentRef.querySelector('#trainingStepList'), trainingCompletionConditions: documentRef.querySelector('#trainingCompletionConditions'), acknowledgeTrainingSafety: documentRef.querySelector('#acknowledgeTrainingSafety'), confirmTrainingStep: documentRef.querySelector('#confirmTrainingStep'), trainingStatus: documentRef.querySelector('#trainingStatus'), trainingEvidence: documentRef.querySelector('#trainingEvidence'), trainingReflection: documentRef.querySelector('#trainingReflectionState'), trainingTeacher: documentRef.querySelector('#trainingTeacher'), trainingGrowth: documentRef.querySelector('#trainingGrowth'), trainingPrerequisite: documentRef.querySelector('#trainingPrerequisite'), cameraWaiting: documentRef.querySelector('#cameraWaiting'),
      taskMapScreen: documentRef.querySelector('#taskMapScreen'), taskDetailScreen: documentRef.querySelector('#taskDetailScreen'), backToTaskMap: documentRef.querySelector('#backToTaskMap'), studentGroupProgress: documentRef.querySelector('#studentGroupProgress'), studentGroupCount: documentRef.querySelector('#studentGroupCount'), currentStepTitle: documentRef.querySelector('#currentStepTitle'), currentStepHow: documentRef.querySelector('#currentStepHow'), currentStepDoneWhen: documentRef.querySelector('#currentStepDoneWhen'), safetyCard: documentRef.querySelector('#safetyCard'), cameraTool: documentRef.querySelector('#cameraTool'), evidenceCard: documentRef.querySelector('#evidenceCard'), reflectionCard: documentRef.querySelector('#reflectionCard'), teacherCard: documentRef.querySelector('#teacherCard'), completionCard: documentRef.querySelector('#completionCard'), stepCompleteFeedback: documentRef.querySelector('#stepCompleteFeedback'), taskCompleteFeedback: documentRef.querySelector('#taskCompleteFeedback'), continueTrainingStep: documentRef.querySelector('#continueTrainingStep'),
      browserCapabilityWarning: documentRef.querySelector('#browserCapabilityWarning'), browserCapabilityTitle: documentRef.querySelector('#browserCapabilityTitle'), browserCapabilityMessage: documentRef.querySelector('#browserCapabilityMessage'), copyCurrentLink: documentRef.querySelector('#copyCurrentLink'), capabilityCamera: documentRef.querySelector('#capabilityCamera'), capabilitySpeechInput: documentRef.querySelector('#capabilitySpeechInput'), capabilitySpeechOutput: documentRef.querySelector('#capabilitySpeechOutput'), capabilityBrowser: documentRef.querySelector('#capabilityBrowser'),
      diagnosticCameraFrameTimestamp: documentRef.querySelector('#diagnosticCameraFrameTimestamp'), diagnosticVoiceState: documentRef.querySelector('#diagnosticVoiceState'), diagnosticVoiceTimeline: documentRef.querySelector('#diagnosticVoiceTimeline'), diagnosticTranscript: documentRef.querySelector('#diagnosticTranscript'), diagnosticSubmittedQuestion: documentRef.querySelector('#diagnosticSubmittedQuestion'), diagnosticAskRequest: documentRef.querySelector('#diagnosticAskRequest'), diagnosticAskHttpStatus: documentRef.querySelector('#diagnosticAskHttpStatus'), diagnosticAskLatency: documentRef.querySelector('#diagnosticAskLatency'), diagnosticLastAiAnswer: documentRef.querySelector('#diagnosticLastAiAnswer'), diagnosticFrame: documentRef.querySelector('#diagnosticFrame'), diagnosticVision: documentRef.querySelector('#diagnosticVision'), diagnosticRag: documentRef.querySelector('#diagnosticRag'), diagnosticTts: documentRef.querySelector('#diagnosticTts'), diagnosticLastError: documentRef.querySelector('#diagnosticLastError'),
      safetyAcknowledgment: documentRef.querySelector('#safetyAcknowledgment'), primaryTrainingAction: documentRef.querySelector('#primaryTrainingAction'), task08CheckStatusField: documentRef.querySelector('#task08CheckStatusField'), task08CheckStatus: documentRef.querySelector('#task08CheckStatus'),
      evidenceFile: documentRef.querySelector('#trainingEvidenceFile'), saveEvidence: documentRef.querySelector('#saveTrainingEvidence'), reflectionOriginal: documentRef.querySelector('#reflectionOriginal'), reflectionAssisted: documentRef.querySelector('#reflectionAssisted'), saveReflection: documentRef.querySelector('#saveTrainingReflection'), startTrainingTask: documentRef.querySelector('#startTrainingTask'), completeTrainingTask: documentRef.querySelector('#completeTrainingTask'), devTeacherControls: documentRef.querySelector('#devTeacherControls'), teacherApprove: documentRef.querySelector('#mockTeacherApprove'), teacherReject: documentRef.querySelector('#mockTeacherReject'),
      teacherReviewNote: documentRef.querySelector('#teacherReviewNote'), classroomValidationToggle: documentRef.querySelector('#classroomValidationToggle'), refreshClassroomValidation: documentRef.querySelector('#refreshClassroomValidation'), classroomValidationReport: documentRef.querySelector('#classroomValidationReport'),
      startCoach: documentRef.querySelector('#startCoach'), stopCoach: documentRef.querySelector('#stopCoach'), manualMode: documentRef.querySelector('#manualMode'), autoMode: documentRef.querySelector('#autoMode'), autoMetrics: documentRef.querySelector('#autoMetrics'),
      visionAssessCenter: documentRef.querySelector('#visionAssessCenter'), teacherVisionCenter: documentRef.querySelector('#teacherVisionCenter'), devModePanel: documentRef.querySelector('#devModePanel'),
      // MP-12 Frontend Integration：TASK_07 深度子模組 MP01～MP12
      missionPlannerPanel: documentRef.querySelector('#missionPlannerPanel'), mp12MapView: documentRef.querySelector('#mp12MapView'), mp12DetailView: documentRef.querySelector('#mp12DetailView'), backToMp12Map: documentRef.querySelector('#backToMp12Map'), mp12Progress: documentRef.querySelector('#mp12Progress'), mp12TaskList: documentRef.querySelector('#mp12TaskList'), mp12Title: documentRef.querySelector('#mp12Title'), mp12Objective: documentRef.querySelector('#mp12Objective'), mp12Procedure: documentRef.querySelector('#mp12Procedure'), mp12Checks: documentRef.querySelector('#mp12Checks'), mp12Safety: documentRef.querySelector('#mp12Safety'), mp12Evidence: documentRef.querySelector('#mp12Evidence'), mp12EvidenceFile: documentRef.querySelector('#mp12EvidenceFile'), mp12SaveEvidence: documentRef.querySelector('#mp12SaveEvidence'), mp12CompleteSubtask: documentRef.querySelector('#mp12CompleteSubtask'), mp12TeacherReview: documentRef.querySelector('#mp12TeacherReview'), mp12TeacherDecision: documentRef.querySelector('#mp12TeacherDecision'), mp12TeacherReason: documentRef.querySelector('#mp12TeacherReason'), mp12TeacherNote: documentRef.querySelector('#mp12TeacherNote'), mp12SubmitTeacherReview: documentRef.querySelector('#mp12SubmitTeacherReview'), mp12CompletedBanner: documentRef.querySelector('#mp12CompletedBanner'), mp12BackToTask07: documentRef.querySelector('#mp12BackToTask07')
    };
    elements.devMode = false;
    let stream = null;
    let sessionId = null;
    let cameras = [];
    let autoScheduler = null;
    let ragPollGeneration = 0;
    let currentTrainingTaskId = 'TASK_01';
    let currentTrainingStepId = null;
    let currentTrainingState = null;
    let pendingTrainingState = null;
    const mobileDevice = /Android|iPhone|iPad|iPod/i.test(navigatorRef.userAgent || '');
    const SpeechRecognitionCtor = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    const speechReply = createSpeechReply();
    const capabilities = detectBrowserCapabilities({ userAgent: navigatorRef.userAgent || '', mediaDevices: navigatorRef.mediaDevices, speechRecognition: SpeechRecognitionCtor, speechSynthesis: globalThis.speechSynthesis });
    let lastAiAnswer = '';
    let currentAskController = null;
    let ttsStartWatchdog = null;
    let currentFacingMode = 'environment';
    let currentDeviceId = '';
    let handsFreeVoice = null;
    let previewMonitor = null;
    let currentStepEnteredAt = performance.now();
    const cameraPermissionKey = 'fde-live-camera-permission-granted';
    if (!storage) { try { storage = globalThis.localStorage || null; } catch { storage = null; } }

    function renderInteraction(event) {
      const state = event.state;
      if (elements.diagnosticVoiceState) elements.diagnosticVoiceState.textContent = state;
      const busy = ['ASKING', 'CAPTURING_FRAME', 'VISION_PROCESSING'].includes(state);
      if (elements.cancelAiInteraction) elements.cancelAiInteraction.hidden = !busy;
      if (elements.submitAskAi) elements.submitAskAi.disabled = busy;
      if (elements.assistantVisualAction) elements.assistantVisualAction.disabled = busy;
      if (elements.pushToTalk) elements.pushToTalk.disabled = busy || state === 'SPEAKING';
      const labels = { LISTENING: '🎙 正在聽……', TRANSCRIBING: '正在識別語音…', ASKING: 'AI 正在思考…', CAPTURING_FRAME: '正在讀取當前畫面…', VISION_PROCESSING: 'AI 正在看畫面…', ANSWER_READY: 'AI 已回答', SPEAKING: 'AI 正在回答…' };
      if (labels[state] && elements.voiceStatus) elements.voiceStatus.textContent = labels[state];
      const studentLabels = { LISTENING: '正在聽', TRANSCRIBING: '正在聽', ASKING: 'AI 正在回答', CAPTURING_FRAME: 'AI 正在看', VISION_PROCESSING: 'AI 正在看', ANSWER_READY: 'AI 已回答', SPEAKING: 'AI 正在回答', ERROR: '請再試一次' };
      if (elements.liveCoachStatus && studentLabels[state]) elements.liveCoachStatus.textContent = studentLabels[state];
      if (state === 'IDLE') {
        const entry = voiceEntryState(capabilities.speechInput);
        if (elements.pushToTalk) { elements.pushToTalk.textContent = entry.label; elements.pushToTalk.disabled = false; }
        if (elements.liveCoachStatus) elements.liveCoachStatus.textContent = handsFreeVoice?.isEnabled() ? 'AI 已待命' : 'AI 已待命';
        if (handsFreeVoice?.isEnabled() && elements.voiceStatus && !event.recoveredFromTimeout) elements.voiceStatus.textContent = '🎙 語音待命中：有問題直接說，不說話時 AI 會安靜等待。';
        if (event.recoveredFromTimeout && elements.voiceStatus) elements.voiceStatus.textContent = event.recoveredFromTimeout === 'TRANSCRIBING' || event.recoveredFromTimeout === 'LISTENING' ? '這次語音沒有成功處理，請再說一次，或使用文字問 AI。' : event.recoveredFromTimeout === 'VISION_PROCESSING' || event.recoveredFromTimeout === 'CAPTURING_FRAME' ? '這次畫面分析沒有完成，請重新試一次。' : 'AI 服務暫時沒有回應，請稍後再試。';
      }
    }
    const interaction = createInteractionStateMachine({
      onChange: renderInteraction,
      onTimeout: ({ state }) => {
        currentAskController?.abort();
        speechReply.stop();
        if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = `${state}_TIMEOUT`;
      }
    });

    if (elements.capabilityCamera) elements.capabilityCamera.textContent = capabilities.camera ? 'Supported' : 'Unsupported';
    if (elements.capabilitySpeechInput) elements.capabilitySpeechInput.textContent = capabilities.speechInput ? 'Supported' : 'Unsupported';
    if (elements.capabilitySpeechOutput) elements.capabilitySpeechOutput.textContent = capabilities.speechOutput ? 'Supported' : 'Unsupported';
    if (elements.capabilityBrowser) elements.capabilityBrowser.textContent = capabilities.browser;
    const voiceEntry = voiceEntryState(capabilities.speechInput);
    if (elements.pushToTalk) {
      elements.pushToTalk.textContent = voiceEntry.label;
      elements.pushToTalk.dataset.available = String(voiceEntry.available);
    }
    if (elements.browserCapabilityWarning) elements.browserCapabilityWarning.hidden = !(capabilities.embedded || !capabilities.camera || !capabilities.speechInput || !capabilities.speechOutput);
    if (!capabilities.embedded && (!capabilities.camera || !capabilities.speechInput || !capabilities.speechOutput)) {
      if (elements.browserCapabilityTitle) elements.browserCapabilityTitle.textContent = '部分功能暫不可用';
      if (elements.browserCapabilityMessage) elements.browserCapabilityMessage.textContent = '當前瀏覽器的攝像頭或語音能力有限；你仍可使用文字問 AI。';
    }
    elements.copyCurrentLink?.addEventListener('click', async () => {
      const href = globalThis.location?.href || '';
      try {
        await navigatorRef.clipboard?.writeText(href);
        elements.copyCurrentLink.textContent = '已複製鏈接';
      } catch (_) {
        elements.copyCurrentLink.textContent = '請從瀏覽器地址欄複製鏈接';
      }
    });

    function setCameraState(state, dataState = "") {
      elements.cameraStatus.textContent = state;
      elements.cameraStatus.dataset.state = dataState || (state === "CAMERA ACTIVE" || state === "CAMERA READY" ? "online" : state === "CAMERA ERROR" || state === "NO CAMERA" ? "offline" : "checking");
    }

    async function refreshCameraDevices() {
      if (!navigatorRef.mediaDevices?.enumerateDevices) { setCameraState("NO CAMERA", "offline"); return []; }
      cameras = (await navigatorRef.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      const previous = elements.cameraDevice.value;
      elements.cameraDevice.innerHTML = cameras.length ? cameras.map((device, index) => `<option value="${escapeHtml(device.deviceId)}">${escapeHtml(device.label || `Camera ${index + 1}`)}</option>`).join("") : `<option value="">No camera found</option>`;
      if (cameras.some((device) => device.deviceId === previous)) elements.cameraDevice.value = previous;
      elements.cameraDevice.disabled = cameras.length < 2;
      if (elements.switchCamera && !stream) elements.switchCamera.disabled = true;
      if (!stream) setCameraState(cameras.length ? (cameras[0].label ? "CAMERA READY" : "CAMERA FOUND") : "NO CAMERA");
      return cameras;
    }

    function updateAssistantVisualAction() {
      const visualAction = assistantVisualActionState(Boolean(stream));
      if (elements.assistantVisualAction) {
        elements.assistantVisualAction.textContent = visualAction.label;
        elements.assistantVisualAction.dataset.action = visualAction.action;
      }
    }

    function updateCameraSourceLabel(requestedFacing = '') {
      const track = stream?.getVideoTracks?.()[0];
      const settings = track?.getSettings?.() || {};
      currentDeviceId = settings.deviceId || currentDeviceId;
      if (mobileDevice) {
        currentFacingMode = settings.facingMode || requestedFacing || currentFacingMode;
        elements.currentCameraFacing.textContent = currentFacingMode === 'user' ? '前置鏡頭' : '後置鏡頭';
      } else {
        elements.currentCameraFacing.textContent = track?.label || elements.cameraDevice.selectedOptions?.[0]?.textContent || '攝像頭';
      }
      if (elements.switchCamera) elements.switchCamera.disabled = !stream || (!mobileDevice && cameras.length < 2);
    }

    function setMessage(message) {
      elements.message.textContent = message;
    }

    function acceptTrainingMutation(training) {
      currentTrainingState = training;
      const previousStepId = currentTrainingStepId;
      const nextStepId = training.current_training_step_id;
      const feedback = trainingCompletionFeedback(previousStepId, nextStepId, training.task_state);
      currentTrainingStepId = nextStepId;
      if (feedback?.type === 'STEP') {
        pendingTrainingState = training;
        if (elements.completionCard) elements.completionCard.hidden = true;
        if (elements.stepCompleteFeedback) elements.stepCompleteFeedback.hidden = false;
        return;
      }
      pendingTrainingState = null;
      if (elements.completionCard) elements.completionCard.hidden = false;
      if (elements.stepCompleteFeedback) elements.stepCompleteFeedback.hidden = true;
      renderTrainingState(elements, training);
    }

    function renderCurrentTraining(training) {
      currentTrainingState = training;
      currentTrainingStepId = training.current_training_step_id || null;
      renderTrainingState(elements, training);
    }

    async function refreshHealth() {
      const health = await checkHealth(fetchImpl);
      elements.health.textContent = health.status === 'online' ? 'ONLINE' : health.status.toUpperCase();
      elements.health.dataset.state = health.status;
      elements.vision.textContent = String(health.components.vision || 'unknown').toUpperCase();
      elements.capture.disabled = health.status !== 'online' || !stream;
      return health;
    }

    let sessionVisionSource = null;

    const SESSION_STORAGE_KEY = 'fde-live-coach-session';
    function loadPersistedSession() {
      try {
        const raw = storage?.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.id === 'string' && typeof parsed.source === 'string') return parsed;
      } catch {}
      return null;
    }
    function persistSession(id, source) {
      try { storage?.setItem(SESSION_STORAGE_KEY, JSON.stringify({ id, source })); } catch {}
    }
    function clearPersistedSession() {
      try { storage?.removeItem(SESSION_STORAGE_KEY); } catch {}
    }

    async function ensureSession(visionSource = 'REAL_VISION') {
      if (sessionId && sessionVisionSource === visionSource) return sessionId;
      // 重載時複用同一 coach 會話，保留 TrainingProgress（含 VISION_MODEL_NOT_READY）——P1：重載保留。
      if (!sessionId) {
        const persisted = loadPersistedSession();
        if (persisted && persisted.source === visionSource) {
          try {
            const check = await fetchImpl(`/api/live/sessions/${encodeURIComponent(persisted.id)}`);
            if (check.ok) {
              sessionId = persisted.id;
              sessionVisionSource = visionSource;
              const state = await parseJsonResponse(check);
              renderTaskState(elements, state);
              currentTrainingState = state.training || null;
              currentTrainingTaskId = state.training?.current_task_id || currentTrainingTaskId;
              currentTrainingStepId = state.training?.current_training_step_id || null;
              initializeStudentTaskMap(elements, state.training);
              elements.devMode = Boolean(state.dev_mode);
              if (elements.devPanel) elements.devPanel.hidden = !state.dev_mode;
              if (elements.devTeacherControls) elements.devTeacherControls.hidden = !state.dev_mode;
              if (elements.visionAssessCenter) elements.visionAssessCenter.hidden = !state.dev_mode;
              if (elements.teacherVisionCenter) elements.teacherVisionCenter.hidden = !state.dev_mode;
              if (elements.devModePanel) elements.devModePanel.hidden = !state.dev_mode;
              return sessionId;
            }
          } catch {}
          // 服務端已無此會話（如未啟用持久化而重啟過）——回退到新建。
        }
      }
      if (sessionId) {
        try { await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }); } catch {}
        clearPersistedSession();
        sessionId = null;
      }
      const response = await fetchImpl('/api/live/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'demo', vision_source: visionSource, training_track: 'F450_TWELVE_TASK' })
      });
      if (!response.ok) throw new Error('session_create_failed');
      const created = await response.json();
      sessionId = created.session_id;
      sessionVisionSource = visionSource;
      persistSession(sessionId, visionSource);
      elements.devPanel.hidden = !created.dev_mode;
      elements.devMode = Boolean(created.dev_mode);
      const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`));
      renderTaskState(elements, state);
      currentTrainingState = state.training || null;
      currentTrainingTaskId = state.training?.current_task_id || currentTrainingTaskId;
      currentTrainingStepId = state.training?.current_training_step_id || null;
      initializeStudentTaskMap(elements, state.training);
      if (elements.devTeacherControls) elements.devTeacherControls.hidden = !created.dev_mode;
      // DEV-only sections hidden from student default flow (Section 7 clutter removal, Vision YOLO frozen).
      if (elements.visionAssessCenter) elements.visionAssessCenter.hidden = !created.dev_mode;
      if (elements.teacherVisionCenter) elements.teacherVisionCenter.hidden = !created.dev_mode;
      if (elements.devModePanel) elements.devModePanel.hidden = !created.dev_mode;
      return sessionId;
    }

    async function refreshRagExplanation(id) {
      const token = ++ragPollGeneration;
      for (let attempt = 0; attempt < 12 && token === ragPollGeneration && id === sessionId; attempt += 1) {
        const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`));
        renderTaskState(elements, state);
        if (state.rag_explanation?.status !== 'pending') return state.rag_explanation;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    }

    function startLivePreviewMonitor() {
      previewMonitor?.stop();
      previewMonitor = createLivePreviewMonitor(elements.video, {
        onFrame: (timestamp) => {
          if (elements.diagnosticCameraFrameTimestamp) elements.diagnosticCameraFrameTimestamp.textContent = new Date(timestamp).toISOString();
          if (stream && elements.cameraHint && elements.cameraHint.classList?.contains('camera-frozen')) {
            elements.cameraHint.classList.remove('camera-frozen');
            elements.cameraHint.hidden = true;
          }
        },
        onFrozen: () => {
          if (!stream) return;
          if (elements.cameraHint) { elements.cameraHint.textContent = '攝像頭畫面已暫停，請重新開啟。'; elements.cameraHint.hidden = false; elements.cameraHint.classList?.add('camera-frozen'); }
          setMessage('攝像頭畫面已暫停，請重新開啟。');
        }
      });
      previewMonitor.start();
    }

    function cameraPermissionGranted() {
      try { return storage?.getItem(cameraPermissionKey) === 'true'; } catch { return false; }
    }

    async function maybeAutoStartCamera() {
      if (!shouldAutoStartCamera({ taskSelected: !elements.taskDetailScreen?.hidden, permissionGranted: cameraPermissionGranted(), cameraActive: Boolean(stream) })) return false;
      await startCamera();
      return Boolean(stream);
    }

    async function startCamera() {
      if (!navigatorRef.mediaDevices?.getUserMedia) { setMessage('此瀏覽器不支援攝影機；仍可選擇一張圖片測試。'); return; }
      stopStream(stream);
      stream = null;
      elements.video.srcObject = null;
      try {
        await refreshCameraDevices();
        setCameraState(cameras.some((device) => device.label) ? 'OPENING CAMERA' : 'PERMISSION REQUIRED');
        const opened = await openCameraWithFallback(navigatorRef.mediaDevices, cameraConstraintCandidates(cameras, mobileDevice ? '' : elements.cameraDevice.value, mobileDevice), () => setCameraState('CAMERA FALLBACK'));
        stream = opened.stream;
        elements.video.srcObject = stream;
        elements.video.autoplay = true;
        elements.video.muted = true;
        elements.video.setAttribute?.('playsinline', '');
        await elements.video.play();
        startLivePreviewMonitor();
        await refreshCameraDevices();
        const activeSession = await ensureSession();
        await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(activeSession)}/camera/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
        elements.start.disabled = true;
        elements.start.textContent = '相機已啟動';
        elements.start.hidden = true;
        elements.video.hidden = false;
        elements.uploadPreview.hidden = true;
        elements.stop.disabled = false;
        elements.capture.disabled = false;
        const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
        updateCameraSourceLabel(opened.constraintIndex === 2 ? 'user' : 'environment');
        const supported = navigatorRef.mediaDevices.getSupportedConstraints?.() || {};
        elements.cameraResolution.textContent = String(settings.width || elements.video.videoWidth) + ' × ' + String(settings.height || elements.video.videoHeight);
        elements.cameraHint.hidden = true;
        elements.cameraDiagnostics.hidden = false;
        elements.cameraDiagnostics.textContent = 'Device: ' + (stream.getVideoTracks()[0]?.label || elements.cameraDevice.selectedOptions[0]?.textContent || 'unknown') + ' | Supported: ' + Object.keys(supported).filter((key) => supported[key]).join(', ');
        setCameraState('ACTIVE', 'online');
        if (elements.cameraWaiting) elements.cameraWaiting.textContent = '已開啟';
        try { storage?.setItem(cameraPermissionKey, 'true'); } catch {}
        updateAssistantVisualAction();
        setMessage(opened.fallbackUsed ? '攝像頭已啟動（兼容模式）。AI 不會持續分析畫面，需要時點擊「AI 看當前畫面」或直接問 AI。' : '攝像頭已開啟。AI 不會持續分析畫面，需要時點擊「AI 看當前畫面」或直接問 AI。');
      } catch (error) {
        stopStream(stream);
        stream = null;
        elements.video.srcObject = null;
        previewMonitor?.stop();
        if (elements.start) { elements.start.hidden = false; elements.start.disabled = false; elements.start.textContent = '開啟實訓攝像頭'; }
        updateAssistantVisualAction();
        const mapped = cameraErrorState(error);
        setCameraState(mapped.state);
        elements.cameraDiagnostics.hidden = false;
        elements.cameraDiagnostics.textContent = 'Camera Error: ' + mapped.name + ' | Message: ' + mapped.message + ' | Failed Constraint: ' + (mapped.constraint || 'unknown');
        setMessage(mapped.state === 'PERMISSION REQUIRED' ? '請允許瀏覽器使用攝像頭。' : '攝像頭開啟失敗，請查看診斷信息。');
      }
    }

    async function switchCameraSource() {
      if (!stream) { setMessage('請先打開攝像頭。'); return false; }
      const previousFacing = currentFacingMode;
      const previousDeviceId = currentDeviceId || elements.cameraDevice.value;
      let targetFacing = previousFacing === 'user' ? 'environment' : 'user';
      let targetCandidates;
      let restoreCandidates;
      if (mobileDevice) {
        targetCandidates = mobileFacingCandidates(targetFacing);
        restoreCandidates = mobileFacingCandidates(previousFacing);
      } else {
        const currentIndex = Math.max(0, cameras.findIndex((device) => device.deviceId === previousDeviceId));
        const nextDevice = cameras[(currentIndex + 1) % cameras.length];
        if (!nextDevice || nextDevice.deviceId === previousDeviceId) return false;
        targetCandidates = cameraConstraintCandidates(cameras, nextDevice.deviceId, false);
        restoreCandidates = cameraConstraintCandidates(cameras, previousDeviceId, false);
      }
      elements.switchCamera.disabled = true;
      setCameraState('OPENING CAMERA');
      elements.video.srcObject = null;
      try {
        const opened = await replaceCameraStream(navigatorRef.mediaDevices, stream, targetCandidates, restoreCandidates);
        stream = opened.stream;
        elements.video.srcObject = stream;
        await elements.video.play();
        await refreshCameraDevices();
        if (opened.restored) {
          currentFacingMode = previousFacing;
          setMessage('無法切換到該鏡頭，請確認瀏覽器已允許攝像頭權限。已恢復原鏡頭。');
        } else {
          currentFacingMode = targetFacing;
          setMessage(`已切換到${targetFacing === 'user' ? '前置鏡頭' : '後置鏡頭'}。`);
        }
        updateCameraSourceLabel(currentFacingMode);
        setCameraState('ACTIVE', 'online');
        if (elements.cameraWaiting) elements.cameraWaiting.textContent = '已開啟';
        elements.capture.disabled = false;
        elements.stop.disabled = false;
        return !opened.restored;
      } catch (error) {
        stream = null;
        elements.video.srcObject = null;
        elements.currentCameraFacing.textContent = '切換失敗';
        elements.switchCamera.disabled = true;
        setCameraState('CAMERA ERROR', 'offline');
        setMessage('無法切換到該鏡頭，請確認瀏覽器已允許攝像頭權限。');
        return false;
      }
    }

    async function sendImage(imageData, captureMs, sourceWidth, sourceHeight, encodeMs = 0) {
      const id = await ensureSession();
      const frameId = `frame-${Date.now()}`;
      const totalStarted = performance.now();
      devLog('SNAPSHOT_REQUEST_SENT', { frame_id: frameId });
      const result = await submitSnapshot(fetchImpl, id, {
        frame_id: frameId,
        file_name: `${frameId}.jpg`,
        image_data: imageData
      });
      devLog('SNAPSHOT_RESPONSE_RECEIVED', { frame_id: frameId });
      const totalMs = Number((performance.now() - totalStarted + captureMs).toFixed(1));
      drawDetectionOverlay(elements.overlay, result.payload.detections, sourceWidth, sourceHeight);
      elements.results.innerHTML = detectionResultHtml(result.payload.detections);
      devLog('OVERLAY_RENDERED', { detections: result.payload.detections.length });
      elements.metrics.textContent = [
        `Resolution ${sourceWidth}×${sourceHeight}`,
        `JPEG ${Math.round((imageData.length - imageData.indexOf(',') - 1) * 0.75)} bytes`,
        `Encode ${encodeMs.toFixed(1)} ms`,
        `Inference ${Number(result.payload.metrics.model_inference_ms || 0).toFixed(1)} ms`,
        `Round Trip ${totalMs.toFixed(1)} ms`
      ].join(' · ');
      const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`));
      renderTaskState(elements, { ...result.payload, task: state });
      if (result.payload.rag_explanation?.status === 'pending') void refreshRagExplanation(id);
      setMessage('檢測完成');
    }

    async function capture() {
      await performCaptureInteraction({
        captureFrame: () => captureFrame(elements.video, elements.captureCanvas),
        sendImage: (captured) => sendImage(captured.imageData, captured.captureMs, captured.width, captured.height, captured.encodeMs),
        setBusy: (busy) => {
          elements.capture.disabled = busy;
          elements.capture.textContent = busy ? 'AI 正在檢查…' : '🤖 AI 看當前畫面';
          if (busy) setMessage('AI 正在檢查當前畫面…');
        },
        onError: (error) => {
          const status = error.status ? `HTTP ${error.status} ` : '';
          const code = error.code ? `${error.code}: ` : '';
          setMessage(`檢測失敗：${status}${code}${error.message}`);
        },
        log: devLog
      });
    }

    async function useFile(file) {
      if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return;
      const image = await createImageBitmap(file);
      elements.captureCanvas.width = image.width;
      elements.captureCanvas.height = image.height;
      elements.captureCanvas.getContext('2d').drawImage(image, 0, 0);
      const encodeStarted = performance.now();
      const imageData = elements.captureCanvas.toDataURL('image/jpeg', 0.75);
      const encodeMs = Number((performance.now() - encodeStarted).toFixed(1));
      elements.uploadPreview.src = imageData;
      elements.uploadPreview.hidden = false;
      elements.video.hidden = true;
      await sendImage(imageData, 0, image.width, image.height, encodeMs);
      image.close();
    }

    // 純停相機 hardware/UI：不動 session、不清持久化——pagehide／回任務地圖等場景使用。
    // P1-4 修復：pagehide（刷新／導航離開）不得銷燬 coach session 與持久化，
    // 否則每次重載都丟失訓練進度（含 VISION_MODEL_NOT_READY）。
    function stopCameraStream() {
      stopAutoObservation();
      previewMonitor?.stop();
      stopStream(stream);
      stream = null;
      elements.video.srcObject = null;
      elements.start.disabled = false;
      elements.start.hidden = false;
      elements.start.textContent = '開啟實訓攝像頭';
      elements.currentCameraFacing.textContent = '尚未開啟';
      elements.switchCamera.disabled = true;
      elements.capture.disabled = true;
      elements.stop.disabled = true;
      elements.cameraResolution.textContent = "—";
      elements.cameraHint.hidden = false;
      setCameraState(cameras.length ? 'STOPPED' : 'ERROR', cameras.length ? 'checking' : 'offline');
      if (elements.cameraWaiting) elements.cameraWaiting.textContent = 'STOPPED';
      updateAssistantVisualAction();
    }

    // 用戶顯式停止攝像頭 = 結束訓練會話：釋放 session（DELETE + 清除持久化）。
    async function stopCamera() {
      stopCameraStream();
      if (sessionId) {
        const oldSession = sessionId;
        sessionId = null;
        sessionVisionSource = null;
        clearPersistedSession();
        ragPollGeneration += 1;
        try {
          await fetchImpl(`/api/live/sessions/${encodeURIComponent(oldSession)}`, { method: 'DELETE' });
        } catch {
          // In-memory demo sessions also disappear when the backend stops.
        }
      }
      setMessage('攝影機已停止。');
    }


    async function startAutoObservation() {
      if (!stream) await startCamera();
      const id = await ensureSession();
      const error = autoStartError(Boolean(stream), id);
      if (error) { setMessage(error === 'camera_required' ? '請先啟動攝像頭。' : 'Session 尚未建立。'); return false; }
      if (!globalThis.FdeAutoObservation) throw new Error('auto_scheduler_unavailable');
      if (!autoScheduler) autoScheduler = globalThis.FdeAutoObservation.createAutoObservationScheduler({
        intervalMs: 1000,
        captureAndSend: capture,
        onMetrics: (metrics) => { elements.autoMetrics.textContent = `1 FPS · Requests ${metrics.requestCount} · Skipped ${metrics.skippedFrameCount} · Max in-flight ${metrics.maxInFlight} · Queue ${metrics.queueLength}`; },
        onError: (failure) => setMessage(`自動觀察失敗：${failure.message}`)
      });
      await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/auto/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      autoScheduler.start();
      elements.autoMode.checked = true;
      elements.startCoach.disabled = true;
      elements.stopCoach.disabled = false;
      setMessage('AI 自動觀察已啟動（1 FPS）。');
      return true;
    }

    function stopAutoObservation() {
      autoScheduler?.stop();
      if (sessionId) fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/auto/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      elements.startCoach.disabled = false;
      elements.stopCoach.disabled = true;
      setMessage('AI 自動觀察已停止；攝像頭保持當前狀態。');
    }

    elements.start.addEventListener('click', startCamera);
    elements.switchCamera?.addEventListener('click', () => switchCameraSource());
    elements.capture.addEventListener('click', capture);
    elements.stop.addEventListener('click', stopCamera);
    elements.upload.addEventListener('click', () => triggerFilePicker(elements.file, devLog));
    elements.file.addEventListener('change', (event) => performUploadInteraction(event.target.files?.[0], useFile, devLog).catch((error) => setMessage(`圖片檢測失敗：${error.message}`)));

    let voiceControl = null;
    voiceControl = bindPushToTalk(elements.pushToTalk, {
      recognitionFactory: SpeechRecognitionCtor ? () => { const recognition = new SpeechRecognitionCtor(); recognition.lang = 'zh-TW'; recognition.interimResults = false; recognition.continuous = false; return recognition; } : null,
      stateMachine: interaction,
      readyLabel: voiceEntryState(capabilities.speechInput).label,
      onResult: (transcript) => {
        elements.askAiPanel.hidden = false;
        if (elements.diagnosticTranscript) elements.diagnosticTranscript.textContent = transcript;
        void handleVoiceTranscript(transcript, (value) => { elements.askAiInput.value = value; }, (question) => submitStudentQuestion(question, { source: 'VOICE', autoSpeak: true }));
      },
      onNoResult: () => { elements.voiceStatus.textContent = '沒有聽清楚，請再說一次。'; if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = 'NO_SPEECH_RESULT'; },
      onError: (code) => { elements.voiceStatus.textContent = code === 'not-allowed' || code === 'service-not-allowed' ? '當前瀏覽器無法使用麥克風，請允許權限或使用文字問 AI。' : '沒有聽清楚，請再說一次。'; if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = `SPEECH_${String(code).toUpperCase()}`; },
      onUnavailable: (message) => { elements.voiceStatus.textContent = message; elements.voiceStatus.dataset.code = 'VOICE_PROVIDER_NOT_CONFIGURED'; elements.askAiPanel.hidden = false; }
    });
    handsFreeVoice = createHandsFreeVoiceCoach({
      recognitionFactory: SpeechRecognitionCtor ? () => new SpeechRecognitionCtor() : null,
      isBusy: () => !['IDLE', 'ANSWER_READY'].includes(interaction.state()),
      isPageActive: () => !documentRef.hidden && !elements.taskDetailScreen?.hidden,
      onState: (state) => {
        if (elements.diagnosticVoiceTimeline) elements.diagnosticVoiceTimeline.textContent = `${new Date().toISOString()} ${state}`;
        if (state === 'LISTENING') interaction.transition('LISTENING');
        else if (state === 'TRANSCRIBING') interaction.transition('TRANSCRIBING');
        else if (state === 'ASKING') interaction.transition('ASKING');
        else if (state === 'IDLE') interaction.reset();
        else if (state === 'VOICE_STANDBY') {
          if (elements.liveCoachStatus) elements.liveCoachStatus.textContent = 'AI 已待命';
          if (elements.voiceStatus) elements.voiceStatus.textContent = '🎙 語音待命中：有問題直接說，不說話時 AI 會安靜等待。';
        }
      },
      onInterim: (transcript, finalSeen) => {
        if (elements.userTranscriptLabel) elements.userTranscriptLabel.textContent = finalSeen ? '你剛剛說' : '你正在說';
        if (elements.lastUserTranscript) elements.lastUserTranscript.textContent = `「${transcript}」`;
        if (elements.diagnosticTranscript) elements.diagnosticTranscript.textContent = transcript;
      },
      onTranscript: (transcript) => {
        if (elements.userTranscriptLabel) elements.userTranscriptLabel.textContent = '你剛剛說';
        if (elements.lastUserTranscript) elements.lastUserTranscript.textContent = `「${transcript}」`;
        if (elements.diagnosticTranscript) elements.diagnosticTranscript.textContent = transcript;
        void submitStudentQuestion(transcript, { source: 'VOICE', autoSpeak: true });
      },
      onError: (code) => {
        if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = `SPEECH_${String(code).toUpperCase()}`;
        if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture' || code === 'speech-unstable') {
          handsFreeVoice?.pause();
          if (elements.voiceStatus) elements.voiceStatus.textContent = code === 'speech-unstable' ? '當前瀏覽器語音識別不穩定，已切換為按住說話。' : '當前瀏覽器暫不支持免按鍵語音，可使用按住說話。';
          if (elements.fallbackMethods) elements.fallbackMethods.open = true;
        } else if (elements.voiceStatus) elements.voiceStatus.textContent = '沒有聽清楚，請繼續說一次。';
      }
    });
    // 2026-11-04：一鍵「開始 AI 陪做」＝語音助教＋實訓鏡頭同時開啟。
    // 語音辨識必須在點擊當下啟動（iOS 限制），所以先開語音、再非同步開鏡頭；
    // 學員不講話時語音靜置待命、鏡頭持續開著，講話時 AI 依問題讀取當前畫面回答。
    elements.enableVoiceCoach?.addEventListener('click', () => {
      const voiceOn = capabilities.speechInput && handsFreeVoice.enable();
      if (!stream) startCamera().catch((error) => setMessage(`攝影機無法開啟：${error.message}`));
      if (!voiceOn) {
        elements.voiceStatus.textContent = '目前瀏覽器不支援免按鍵語音，可使用「按住說話」或文字提問；鏡頭仍會開啟。';
        elements.fallbackMethods.open = true;
        return;
      }
      elements.enableVoiceCoach.hidden = true;
      if (elements.pauseVoiceCoach) elements.pauseVoiceCoach.hidden = false;
      elements.voiceStatus.textContent = '🎙 AI 陪做中：鏡頭已開、語音待命，有問題直接說；不說話時 AI 會安靜待命。';
    });
    elements.pauseVoiceCoach?.addEventListener('click', () => {
      handsFreeVoice.pause();
      if (elements.pauseVoiceCoach) elements.pauseVoiceCoach.hidden = true;
      elements.enableVoiceCoach.hidden = false;
      elements.voiceStatus.textContent = '語音助教已暫停（鏡頭仍開著，可隨時再按「開始 AI 陪做」）。';
    });
    documentRef.addEventListener?.('visibilitychange', () => handsFreeVoice.handleVisibilityChange());
    elements.textAskAi?.addEventListener('click', () => { elements.askAiPanel.hidden = false; elements.askAiInput.focus(); });
    function speechCallbacks() {
      return {
        onStart: () => { if (ttsStartWatchdog) clearTimeout(ttsStartWatchdog); interaction.transition('SPEAKING'); if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'speaking'; if (elements.stopAiAnswer) elements.stopAiAnswer.hidden = false; },
        onEnd: () => { if (ttsStartWatchdog) clearTimeout(ttsStartWatchdog); elements.voiceStatus.textContent = 'AI 回答完成'; if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'completed'; if (elements.stopAiAnswer) elements.stopAiAnswer.hidden = true; interaction.reset(); voiceControl?.releaseButton(); handsFreeVoice?.resumeAfterAnswer(); },
        onError: () => { if (ttsStartWatchdog) clearTimeout(ttsStartWatchdog); elements.voiceStatus.textContent = '語音播放失敗，請閱讀文字回答。'; if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'error'; if (elements.stopAiAnswer) elements.stopAiAnswer.hidden = true; interaction.reset(); voiceControl?.releaseButton(); handsFreeVoice?.resumeAfterAnswer(); }
      };
    }
    async function submitStudentQuestion(question, { autoSpeak = true, source = 'TEXT' } = {}) {
      if (!question.trim()) { elements.askAiResponse.textContent = source === 'VOICE' ? '沒有聽清楚，請再說一次。' : '請先輸入問題。'; interaction.reset(); return; }
      currentAskController?.abort();
      const askController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      currentAskController = askController;
      const interactionId = `${source.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const visual = questionRequiresVision(question);
      if (visual && !isCameraFrameReady(stream, elements.video)) {
        elements.askAiResponse.textContent = stream ? '攝像頭畫面還沒準備好，請稍等一秒再試。' : '請先打開攝像頭，把目標放到畫面中央後再問一次。';
        if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = 'CAMERA_NOT_READY';
        interaction.transition('ERROR'); interaction.reset(); voiceControl?.releaseButton(); return;
      }
      interaction.transition(visual ? 'CAPTURING_FRAME' : 'ASKING', { requestId, interactionId });
      if (source === 'VOICE') {
        if (elements.userTranscriptLabel) elements.userTranscriptLabel.textContent = '你剛剛說';
        if (elements.lastUserTranscript) elements.lastUserTranscript.textContent = `「${question.trim()}」`;
      }
      if (elements.diagnosticSubmittedQuestion) elements.diagnosticSubmittedQuestion.textContent = question.trim();
      if (elements.diagnosticAskRequest) elements.diagnosticAskRequest.textContent = requestId;
      elements.askAiResponse.textContent = 'AI 正在根據當前步驟查詢教學知識…';
      const started = performance.now();
      try {
        const id = await ensureSession();
        const captureCurrent = visual ? () => {
          const frame = captureFrame(elements.video, elements.captureCanvas, performance.now.bind(performance), { maxWidth: 1280, maxHeight: 960, quality: 0.8 });
          if (elements.diagnosticFrame) elements.diagnosticFrame.textContent = `${frame.width}×${frame.height} ${frame.mimeType}`;
          interaction.transition('VISION_PROCESSING', { requestId, interactionId });
          if (elements.diagnosticVision) elements.diagnosticVision.textContent = 'processing';
          return frame;
        } : null;
        const result = await askLiveCoach(fetchImpl, id, question, captureCurrent, { timeoutMs: visual ? 20000 : 15000, requestId, interactionId, controller: askController });
        if (elements.diagnosticAskHttpStatus) elements.diagnosticAskHttpStatus.textContent = '200';
        interaction.transition('ANSWER_READY', { requestId, interactionId });
        const delivered = deliverAiAnswer(result.answer, { autoSpeak, speechReply, callbacks: speechCallbacks() });
        lastAiAnswer = delivered.text;
        elements.askAiResponse.textContent = delivered.text;
        if (elements.latestAiAnswer) elements.latestAiAnswer.textContent = delivered.text;
        if (elements.diagnosticLastAiAnswer) elements.diagnosticLastAiAnswer.textContent = delivered.text;
        if (elements.answerSourceLabel) {
          const answerSourceLabels = { AI_REFERENCE: 'AI 參考回答', AI_VISUAL_REFERENCE: 'AI 參考回答', VERIFIED_KNOWLEDGE: '已核對教學資料', VISION_MODEL: 'V7 槳葉模型判讀' };  // 2026-11-04：V7 判讀來源
          elements.answerSourceLabel.textContent = answerSourceLabels[result.answer_source] || '';
          elements.answerSourceLabel.hidden = !elements.answerSourceLabel.textContent;
        }

        if (elements.diagnosticAskLatency) elements.diagnosticAskLatency.textContent = `${(performance.now() - started).toFixed(1)} ms`;
        if (elements.diagnosticVision) elements.diagnosticVision.textContent = result.vision_used ? 'one-frame completed' : 'not used';
        void recordClassroomEvent(fetchImpl, id, {
          event_type: 'AI_ASK', task_id: currentTrainingTaskId, step_id: currentTrainingStepId,
          channel: visual ? 'VISION' : source, question: question.trim(), duration_ms: Math.round(performance.now() - started)
        }).catch(() => {});
        if (elements.diagnosticRag) elements.diagnosticRag.textContent = result.rag_status || '—';
        if (autoSpeak && delivered.spoken) {
          ttsStartWatchdog = setTimeout(() => {
            if (interaction.state() !== 'SPEAKING') {
              elements.voiceStatus.textContent = 'AI 已回答。';
              if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'autoplay blocked';
              interaction.reset(); voiceControl?.releaseButton(); handsFreeVoice?.resumeAfterAnswer();
            }
          }, 1500);
        } else if (autoSpeak) { elements.voiceStatus.textContent = '此瀏覽器不支持語音播放，請閱讀文字回答。'; interaction.reset(); voiceControl?.releaseButton(); handsFreeVoice?.resumeAfterAnswer(); }
        else { elements.voiceStatus.textContent = 'AI 已回答。'; interaction.reset(); voiceControl?.releaseButton(); }
        elements.voiceStatus.dataset.code = result.vision_used ? 'VISION_SINGLE_FRAME' : 'CONTEXT_ANSWER';
      } catch (error) {
        if (elements.diagnosticAskHttpStatus) elements.diagnosticAskHttpStatus.textContent = String(error.status || 'ERROR');
        if (error.name === 'AbortError') elements.askAiResponse.textContent = '已取消這次詢問。';
        else if (error.message === 'ask_timeout') elements.askAiResponse.textContent = visual ? '這次畫面分析沒有完成，請重新試一次。' : 'AI 服務暫時沒有回應，請稍後再試。';
        else if (error.message === 'camera_not_ready' || error.message === 'camera_frame_required') elements.askAiResponse.textContent = '攝像頭畫面還沒準備好，請稍等一秒再試。';
        else elements.askAiResponse.textContent = visual ? '這次沒有成功讀取畫面，請重新檢查鏡頭後再試。' : 'AI 服務暫時沒有回應，請稍後再試。';
        if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = error.message || error.name;
        interaction.transition('ERROR', { requestId, interactionId }); interaction.reset(); voiceControl?.releaseButton(); handsFreeVoice?.resumeAfterAnswer();
      } finally {
        if (currentAskController === askController) currentAskController = null;
      }
    }
    elements.submitAskAi?.addEventListener('click', () => void submitStudentQuestion(elements.askAiInput.value.trim(), { source: 'TEXT' }));
    elements.assistantVisualAction?.addEventListener('click', () => {
      if (!stream) { void startCamera(); return; }
      elements.askAiPanel.hidden = false;
      void submitStudentQuestion(genericVisualObservationQuestion(), { source: 'VISUAL_BUTTON' });
    });
    elements.cancelAiInteraction?.addEventListener('click', () => { currentAskController?.abort(); speechReply.stop(); interaction.reset(); voiceControl?.releaseButton(); elements.voiceStatus.textContent = '已取消這次詢問。'; });
    elements.playAiAnswer?.addEventListener('click', () => {
      if (!lastAiAnswer) return;
      if (!speechReply.speak(lastAiAnswer, speechCallbacks())) elements.voiceStatus.textContent = '此瀏覽器不支持語音播放，請閱讀文字回答。';
    });
    elements.stopAiAnswer?.addEventListener('click', () => { speechReply.stop(); if (elements.stopAiAnswer) elements.stopAiAnswer.hidden = true; elements.voiceStatus.textContent = '已停止播放'; });

    elements.startCoach.addEventListener('click', () => startAutoObservation().catch((error) => setMessage(`自動觀察啟動失敗：${error.message}`)));
    elements.stopCoach.addEventListener('click', stopAutoObservation);
    elements.confirm?.addEventListener('click', async () => { const id = sessionId || await ensureSession(); const result = await confirmStep(fetchImpl, id); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`)); renderTaskState(elements, { session: result.session, guidance: result.guidance, task: state }); });
    elements.devPanel.querySelectorAll?.('[data-scenario]').forEach((button) => button.addEventListener('click', async () => { const id = await ensureSession('MOCK_VISION'); const result = await simulateVision(fetchImpl, id, button.dataset.scenario); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`)); renderTaskState(elements, { ...result, task: state }); if (result.rag_explanation?.status === 'pending') void refreshRagExplanation(id); }));
    elements.acknowledgeTrainingSafety?.addEventListener('change', async () => { if (!elements.acknowledgeTrainingSafety.checked || !currentTrainingStepId) return; const id = await ensureSession(); const result = await acknowledgeTrainingStepSafety(fetchImpl, id, currentTrainingStepId); renderCurrentTraining(result.training); });
    elements.primaryTrainingAction?.addEventListener('click', async () => {
      const action = elements.primaryTrainingAction.dataset.action;
      const id = await ensureSession();
      try {
        if (action === 'MAP') { showTaskMap(elements); return; }
        if (action === 'START' || action === 'REWORK') {
          const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/training/tasks/${encodeURIComponent(currentTrainingTaskId)}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
          renderCurrentTraining(state.training); return;
        }
        if (action === 'STEP' || action === 'TEACHER') {
          let fact = 'LEARNER_CONFIRMED';
          if (currentTrainingTaskId === 'TASK_08') {
            fact = currentTrainingStepId === 'T08_TEACHER_FINAL_REVIEW' ? 'NEEDS_CONFIRMATION' : (elements.task08CheckStatus?.value || 'PASS');
          }
          const result = await submitTrainingStepFact(fetchImpl, id, currentTrainingStepId, fact);
          acceptTrainingMutation(result.training); return;
        }
        if (action === 'EVIDENCE') {
          const file = elements.evidenceFile?.files?.[0];
          if (!file) { setMessage('請先拍照或選擇學習證據。'); return; }
          const expectedEvidence = currentTrainingState?.current_step?.evidence_required?.[0];
          const result = await saveTrainingEvidence(fetchImpl, id, { task_id: currentTrainingTaskId, step_id: currentTrainingStepId, evidence_type: currentTrainingTaskId === 'TASK_08' && expectedEvidence ? expectedEvidence : (file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO'), source: 'STUDENT_UPLOAD', file_reference: `dev-upload://${file.name}`, check_result: currentTrainingTaskId === 'TASK_08' ? (elements.task08CheckStatus?.value || 'PASS') : null, metadata: { name: file.name, size: file.size, type: file.type } });
          acceptTrainingMutation(result.training); setMessage('學習證據已保存。'); return;
        }
        if (action === 'REFLECTION') {
          const result = await saveTrainingReflection(fetchImpl, id, { task_id: currentTrainingTaskId, step_id: currentTrainingStepId, original_text: elements.reflectionOriginal.value, ai_assisted_text: elements.reflectionAssisted.value || null, source_type: 'TEXT' });
          acceptTrainingMutation(result.training); setMessage('學習總結已保存。'); return;
        }
        if (action === 'TASK_REVIEW' || action === 'TASK_COMPLETE') {
          const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/training/tasks/${encodeURIComponent(currentTrainingTaskId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
          renderCurrentTraining(state.training);
        }
      } catch (error) {
        const messages = { unsafe_step_prerequisites: '你可以先學習這一部分；當前危險操作需要先完成安全檢查並由教師確認。', student_original_summary_required: '請先填寫自己的真實學習總結。' };
        const key = Object.keys(messages).find((item) => String(error.message).includes(item));
        setMessage(key ? messages[key] : `目前無法繼續：${error.message}`);
      }
    });
    elements.teacherApprove?.addEventListener('click', async () => { const id = await ensureSession(); const result = await submitTeacherReview(fetchImpl, id, 'APPROVE', elements.teacherReviewNote?.value || '', currentTrainingTaskId, currentTrainingStepId); acceptTrainingMutation(result.training); void recordClassroomEvent(fetchImpl, id, { event_type: 'TEACHER_REVIEW', task_id: currentTrainingTaskId, step_id: currentTrainingStepId }).catch(() => {}); });
    elements.teacherReject?.addEventListener('click', async () => { const id = await ensureSession(); const result = await submitTeacherReview(fetchImpl, id, 'REJECT_REWORK', elements.teacherReviewNote?.value || '', currentTrainingTaskId, currentTrainingStepId); currentTrainingStepId = result.training.current_training_step_id; renderTrainingState(elements, result.training); void recordClassroomEvent(fetchImpl, id, { event_type: 'TEACHER_REVIEW', task_id: currentTrainingTaskId, step_id: currentTrainingStepId }).catch(() => {}); });
    // ---- MP-12 Frontend Integration：事件綁定（只呼叫既有 Backend endpoint） ----
    elements.mp12TaskList?.addEventListener('click', async (event) => {
      const subtaskId = event.target.closest?.('[data-mp-subtask]')?.dataset?.mpSubtask;
      if (!subtaskId) return;
      setMp12View(elements, 'DETAIL', { scroll: true });
      try {
        const id = await ensureSession();
        const result = await selectMpSubtask(fetchImpl, id, subtaskId);
        renderCurrentTraining(result.training);
        setMessage(`已打開 ${subtaskId}，可以按當前說明學習。`);
      } catch (error) {
        setMessage(`無法打開子任務：${error.message}`);
      }
    });
    elements.backToMp12Map?.addEventListener('click', () => {
      setMp12View(elements, 'MAP');
      elements.mp12MapView?.scrollIntoView?.({ block: 'start' });
    });
    elements.mp12CompleteSubtask?.addEventListener('click', async () => {
      if (elements.mp12CompleteSubtask.dataset.action !== 'COMPLETE') return;
      const subtaskId = currentTrainingState?.mission_planner?.current_subtask_id;
      if (!subtaskId) return;
      try {
        const id = await ensureSession();
        const result = await completeMpSubtask(fetchImpl, id, subtaskId);
        renderCurrentTraining(result.training);
        const status = result.training.mission_planner?.subtasks?.[subtaskId]?.status;
        setMessage(status === 'PENDING_TEACHER_REVIEW' ? '已提交，等待教師現場確認。' : '子任務已完成。');
      } catch (error) {
        setMessage(`目前無法完成此子任務：${error.message}`);
      }
    });
    elements.mp12SaveEvidence?.addEventListener('click', async () => {
      const file = elements.mp12EvidenceFile?.files?.[0];
      const current = currentTrainingState?.mission_planner?.current_subtask;
      if (!file || !current?.subtask_id) {
        setMessage('請先選擇當前子任務的證據文件。');
        return;
      }
      const evidenceType = current.evidence_types?.[0];
      if (!evidenceType) {
        setMessage('當前子任務不要求保存證據。');
        return;
      }
      try {
        const id = await ensureSession();
        // 繼續複用 Main v2.0 Shared Evidence 流程；MP 證據最終仍進入 Main-12 Growth Record
        const result = await saveTrainingEvidence(fetchImpl, id, {
          task_id: 'TASK_07',
          step_id: current.subtask_id,
          evidence_type: evidenceType,
          source: 'STUDENT_UPLOAD',
          file_reference: `dev-upload://${file.name}`,
          metadata: { name: file.name, size: file.size, type: file.type }
        });
        renderCurrentTraining(result.training);
        setMessage('當前子任務證據已保存。');
      } catch (error) {
        setMessage(`證據保存失敗：${error.message}`);
      }
    });
    elements.mp12SubmitTeacherReview?.addEventListener('click', async () => {
      const subtaskId = currentTrainingState?.mission_planner?.current_subtask_id;
      if (!subtaskId) return;
      try {
        const id = await ensureSession();
        const result = await submitMpTeacherReview(fetchImpl, id, subtaskId, {
          decision: elements.mp12TeacherDecision?.value || 'APPROVE',
          reason: elements.mp12TeacherReason?.value || '',
          note: elements.mp12TeacherNote?.value?.trim() || ''
        });
        renderCurrentTraining(result.training);
        setMessage('教師現場複核已提交。');
      } catch (error) {
        setMessage(`教師複核失敗：${error.message}`);
      }
    });
    elements.mp12BackToTask07?.addEventListener('click', () => {
      // 只回到 TASK_07 主流程畫面；不自動完成 TASK_07、不自動跳 TASK_08
      setMp12View(elements, 'MAP');
      elements.trainingTitle?.scrollIntoView?.({ block: 'start' });
      setMessage('已返回 TASK_07；MP-12 完成記錄會保留，TASK_07 仍需完成既有流程。');
    });
    elements.trainingTaskList?.addEventListener('click', async (event) => {
      const taskId = event.target.closest?.('[data-view-task]')?.dataset?.viewTask;
      if (!taskId) return;
      const id = await ensureSession();
      const result = await fetchTrainingTaskView(fetchImpl, id, taskId);
      if (currentTrainingStepId) void recordClassroomEvent(fetchImpl, id, { event_type: 'STEP_EXIT', task_id: currentTrainingTaskId, step_id: currentTrainingStepId, duration_ms: Math.round(performance.now() - currentStepEnteredAt) }).catch(() => {});
      currentTrainingTaskId = taskId;
      renderCurrentTraining({ ...result.training_task_view, current_task_id: taskId, progress: elements.trainingProgress.textContent, evidence_count: elements.trainingEvidence.textContent, reflection_state: elements.trainingReflection.textContent, teacher_review_state: result.training_task_view.task.teacher_review_required ? 'REQUIRED' : 'NOT_REQUIRED' });
      showTaskDetail(elements);
      currentStepEnteredAt = performance.now();
      void recordClassroomEvent(fetchImpl, id, { event_type: 'TASK_ENTER', task_id: currentTrainingTaskId, step_id: currentTrainingStepId }).catch(() => {});
      setMessage(result.training_task_view.unsafe_action_allowed === false ? '可以先學習；到危險操作時需要完成安全檢查並由教師確認。' : '此任務可以開始學習。');
      await maybeAutoStartCamera();
    });
    async function refreshMap() {
      handsFreeVoice?.pause();
      await stopCameraStream();
      const id = await ensureSession();
      const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`));
      renderCurrentTraining(state.training);
      showTaskMap(elements);
    }
    bindTaskMapRetry(elements.trainingTaskList, () => refreshMap().catch(() => renderTaskMapLoadError(elements)));
    elements.backToTaskMap?.addEventListener('click', () => refreshMap().catch((error) => setMessage(`任務地圖刷新失敗：${error.message}`)));
    elements.continueTrainingStep?.addEventListener('click', () => { if (!pendingTrainingState) return; const training = pendingTrainingState; pendingTrainingState = null; elements.stepCompleteFeedback.hidden = true; if (elements.completionCard) elements.completionCard.hidden = false; renderCurrentTraining(training); });
    elements.classroomValidationToggle?.addEventListener('change', async () => {
      const id = await ensureSession();
      const state = await setClassroomValidation(fetchImpl, id, elements.classroomValidationToggle.checked);
      if (elements.classroomValidationReport) elements.classroomValidationReport.textContent = state.enabled ? '課堂驗證記錄已開啟' : '課堂驗證記錄已關閉';
    });
    elements.refreshClassroomValidation?.addEventListener('click', async () => {
      const id = await ensureSession();
      const report = await fetchClassroomValidationReport(fetchImpl, id);
      if (elements.classroomValidationReport) elements.classroomValidationReport.textContent = JSON.stringify(report, null, 2);
    });

    return { refreshHealth, refreshCameraDevices, initializeStudentMode: ensureSession, startCamera, maybeAutoStartCamera, switchCameraSource, capture, stopCamera, stopCameraStream, startAutoObservation, stopAutoObservation, pauseVoiceCoach: () => handsFreeVoice?.pause() };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // ---- 視覺模型品質顯示（2026-10-21 質量證據閘口配套）----
  // 原則：
  // 1) 前端只做「可讀化」，不提供任何降低門檻的輸入（不得調低 confidence_threshold 讓驗證變綠）。
  // 2) 綠色（通過）只有一種情況：VALIDATED 且已評估（evaluation_status=EVALUATED，mAP50 ≥ 門檻）
  //    或 benchmark_status=PASS，且未被封存；未評估／REVIEW_REQUIRED／低於門檻一律不得顯示綠色通過。
  // 3) 降級原因（review_reason）必須原樣呈現，不做無聲失敗。
  const VISION_MAP50_THRESHOLD = 0.5;

  function visionMap50Threshold(model) {
    const threshold = Number(model?.map50_threshold);
    return Number.isFinite(threshold) && threshold > 0 ? threshold : VISION_MAP50_THRESHOLD;
  }

  function visionModelEvidence(model) {
    const evaluated = model?.evaluation_status === 'EVALUATED';
    const benchmarkPass = String(model?.benchmark_status || '').toUpperCase() === 'PASS';
    return { evaluated, benchmarkPass, hasEvidence: evaluated || benchmarkPass };
  }

  function visionModelStateMeta(model) {
    const validation = String(model?.validation_status || '').toUpperCase();
    const status = String(model?.status || '').toUpperCase();
    const { evaluated, benchmarkPass } = visionModelEvidence(model);
    const threshold = visionMap50Threshold(model);
    const map50 = model?.metrics?.map50;
    if (validation === 'REVIEW_REQUIRED' || status === 'REVIEW_REQUIRED') {
      return { state: 'REVIEW_REQUIRED', label: '待審查', tone: 'warn', note: model?.review_reason || '缺少評估證據，僅類別名稱吻合' };
    }
    if (validation === 'REJECTED' || status === 'REJECTED') {
      return { state: 'REJECTED', label: '已拒絕', tone: 'bad', note: model?.review_reason || '未通過匯入驗證' };
    }
    if (status === 'ARCHIVED') {
      return { state: 'ARCHIVED', label: '已封存', tone: 'neutral', note: '' };
    }
    if (validation === 'VALIDATED' && evaluated && typeof map50 === 'number' && map50 < threshold) {
      return { state: 'BELOW_THRESHOLD', label: 'mAP50 低於門檻', tone: 'warn', note: `mAP50 ${map50} 低於門檻 ${threshold}，未達啟用標準` };
    }
    if (validation === 'VALIDATED' && (evaluated || benchmarkPass)) {
      return { state: 'PASS', label: evaluated ? '已驗證並評估' : '基準測試通過', tone: 'pass', note: evaluated ? `mAP50 ${map50} ≥ 門檻 ${threshold}` : 'BenchmarkPolicy 判定 PASS' };
    }
    if (validation === 'VALIDATED') {
      return { state: 'VALIDATED_NOT_EVALUATED', label: '已驗證未評估', tone: 'warn', note: '僅類別名稱吻合，尚無 golden set 評估或 benchmark 證據，不得視為通過' };
    }
    if (validation === 'DEMO_IMPORTED' || status === 'DEMO_IMPORTED') {
      return { state: 'DEMO_IMPORTED', label: '演示導入', tone: 'warn', note: '演示流程導入，未經評估' };
    }
    return { state: validation || status || 'UNKNOWN', label: validation || status || '未知', tone: 'neutral', note: '' };
  }

  function visionModelClassCount(model) {
    for (const value of [model?.nc, model?.names_count, Array.isArray(model?.class_names) ? model.class_names.length : null]) {
      if (typeof value === 'number' && value > 0) return value;
    }
    return null;
  }

  function visionTrainingTrace(model) {
    if (model?.has_training_trace) {
      const parts = [];
      if (model.has_train_args) parts.push('train_args');
      if (model.has_epoch) parts.push('epoch');
      if (model.has_metrics) parts.push('metrics');
      return { label: '有訓練痕跡', detail: parts.join(' · ') };
    }
    return { label: model?.training_trace_label || '無訓練痕跡', detail: '' };
  }

  function visionMap50Text(model) {
    const { evaluated } = visionModelEvidence(model);
    const value = model?.metrics?.map50;
    if (evaluated && typeof value === 'number') return { text: String(value), evaluated: true };
    if (typeof value === 'number') return { text: `${value}（未評估）`, evaluated: false };
    return { text: '未評估', evaluated: false };
  }

  function visionErrorHtml(message) {
    return `<p class="vm-reason vm-reason-bad">${escapeHtml(message || '未知錯誤')}</p>`;
  }

  function visionEmptyHtml(message) {
    return `<p class="vm-empty">${escapeHtml(message)}</p>`;
  }

  function visionModelCardHtml(model) {
    const meta = visionModelStateMeta(model);
    const count = visionModelClassCount(model);
    const map50 = visionMap50Text(model);
    const trace = visionTrainingTrace(model);
    const map50Cell = map50.evaluated ? `${escapeHtml(map50.text)}（門檻 ${visionMap50Threshold(model)}）` : escapeHtml(map50.text);
    const rows = [
      ['類型', escapeHtml(model?.model_type || '—')],
      ['啟用狀態', escapeHtml(model?.status || '—')],
      ['驗證狀態', `<span class="vm-badge vm-badge-${meta.tone}">${escapeHtml(meta.label)}</span>`],
      ['類別數 nc', count === null ? '—' : String(count)],
      ['mAP50', map50Cell],
      ['評估狀態', model?.evaluation_status === 'EVALUATED' ? '<span class="vm-badge vm-badge-pass">已評估</span>' : '<span class="vm-badge vm-badge-warn">未評估</span>'],
      ['訓練痕跡', escapeHtml(trace.label) + (trace.detail ? `（${escapeHtml(trace.detail)}）` : '')],
    ];
    if (model?.health) rows.push(['健康度', escapeHtml(model?.health_label || model.health)]);
    if (model?.benchmark_status) rows.push(['Benchmark', escapeHtml(String(model.benchmark_status))]);
    const reason = meta.note ? `<p class="vm-reason vm-reason-${meta.tone}">${escapeHtml(meta.note)}</p>` : '';
    return `<article class="vm-card vm-card-${meta.tone}" data-model-id="${escapeHtml(model?.model_id || '')}" data-state="${escapeHtml(meta.state)}">
      <header><strong>${escapeHtml(model?.model_name || model?.model_id || '未命名模型')}</strong><code>${escapeHtml(model?.model_id || '')}</code></header>
      ${reason}
      <table class="vm-table"><tbody>${rows.map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`).join('')}</tbody></table>
    </article>`;
  }

  function visionModelItems(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.models)) return value.models;
      if (value.model_id || value.model_name || value.status || value.validation_status) return [value];
    }
    return null;
  }

  function visionModelListHtml(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.error) return visionErrorHtml(value.error);
    const items = visionModelItems(value);
    if (!items) return visionErrorHtml('無法解析模型列表');
    if (!items.length) return visionEmptyHtml('尚無模型記錄');
    return `<div class="vm-summary">共 ${items.length} 筆模型；僅「已驗證並評估」顯示綠色通過，未評估或待審查不得啟用。</div>${items.map(visionModelCardHtml).join('')}`;
  }

  function visionModelCompareHtml(value) {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.error) return visionErrorHtml(value.error);
    const items = Array.isArray(value) ? value : (value && Array.isArray(value.models) ? value.models : null);
    if (items) {
      if (!items.length) return visionEmptyHtml('尚無模型可比較');
      const rows = items.map(item => {
        const meta = visionModelStateMeta(item);
        const map50 = visionMap50Text(item);
        return `<tr><td>${escapeHtml(item?.model_name || item?.model_id || '—')}</td><td>${escapeHtml(item?.dataset_version || '—')}</td><td>${escapeHtml(map50.text)}</td><td><span class="vm-badge vm-badge-${meta.tone}">${escapeHtml(meta.label)}</span></td></tr>`;
      }).join('');
      return `<table class="vm-table vm-table-compare"><thead><tr><th>模型</th><th>Dataset</th><th>mAP50</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    if (!value || typeof value !== 'object') return visionErrorHtml('無法解析評估結果');
    // 單筆評估結果（保存統一評估後回傳的模型記錄）
    const meta = visionModelStateMeta(value);
    const metrics = value?.metrics || {};
    const threshold = visionMap50Threshold(value);
    const map50 = metrics.map50;
    const map50Row = typeof map50 === 'number'
      ? `<tr><th>mAP50</th><td>${escapeHtml(String(map50))}<span class="vm-badge vm-badge-${map50 >= threshold ? 'pass' : 'warn'}">${map50 >= threshold ? `≥ 門檻 ${threshold}` : `< 門檻 ${threshold}`}</span></td></tr>`
      : '<tr><th>mAP50</th><td>未評估</td></tr>';
    const detailRows = ['precision', 'recall', 'map50_95', 'error_count', 'low_confidence_count']
      .filter(key => metrics[key] !== undefined)
      .map(key => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(String(metrics[key]))}</td></tr>`).join('');
    return `<article class="vm-card vm-card-${meta.tone}" data-model-id="${escapeHtml(value?.model_id || '')}" data-state="${escapeHtml(meta.state)}">
      <header><strong>${escapeHtml(value?.model_name || '統一評估結果')}</strong><code>${escapeHtml(value?.model_id || '')}</code></header>
      <p class="vm-reason vm-reason-${meta.tone}">${escapeHtml(meta.note || meta.label)}</p>
      <table class="vm-table"><tbody>
        <tr><th>評估狀態</th><td>${value?.evaluation_status === 'EVALUATED' ? '<span class="vm-badge vm-badge-pass">已評估</span>' : '<span class="vm-badge vm-badge-warn">未評估</span>'}</td></tr>
        <tr><th>驗證狀態</th><td><span class="vm-badge vm-badge-${meta.tone}">${escapeHtml(meta.label)}</span></td></tr>
        ${map50Row}${detailRows}
      </tbody></table>
      <p class="vm-note">門檻由伺服器設定檔控制（預設 mAP50 ≥ ${threshold}）；前端不提供調整入口，也不會因降低信心度門檻而改變判定。</p>
    </article>`;
  }

  function propAssessmentHtml(value) {
    if (value && typeof value === 'object' && value.error) return visionErrorHtml(value.error);
    if (!value || typeof value !== 'object') return visionErrorHtml('無法解析檢測結果');
    if (value.status === 'MODEL_NOT_READY') return `<p class="vm-reason vm-reason-warn">目前沒有可用的 ACTIVE 模型，請由教師先匯入並通過質量閘口後再啟用。</p>`;
    const final = String(value.final_result || 'UNKNOWN').toUpperCase();
    const tone = final === 'PASS' ? 'pass' : final === 'NG' ? 'bad' : 'warn';
    const label = final === 'PASS' ? '通過' : final === 'NG' ? '未通過' : final === 'INSUFFICIENT_DATA' ? '資料不足' : final;
    const positions = value.positions || {};
    const rows = Object.entries(positions).map(([slot, item]) => {
      const result = String(item?.result || 'UNKNOWN').toUpperCase();
      const resultTone = result === 'PASS' ? 'pass' : result === 'NG' ? 'bad' : 'warn';
      const confidence = typeof item?.confidence === 'number' ? item.confidence.toFixed(2) : '—';
      return `<tr><td>${escapeHtml(slot)}</td><td>${escapeHtml(item?.expected || '—')}</td><td>${escapeHtml(item?.detected || '未檢測到')}</td><td>${escapeHtml(confidence)}</td><td><span class="vm-badge vm-badge-${resultTone}">${escapeHtml(result)}</span></td><td>${escapeHtml(item?.reason || '—')}</td></tr>`;
    }).join('');
    const model = value.model ? `使用模型 ${escapeHtml(value.model.model_id || '—')}（${escapeHtml(value.model.model_version || '—')}）` : '系統自動選擇 ACTIVE 模型';
    return `<article class="vm-card vm-card-${tone}" data-final="${escapeHtml(final)}">
      <header><strong>槳葉檢測結果</strong><span class="vm-badge vm-badge-${tone}">${escapeHtml(label)}</span></header>
      <p class="vm-note">${model}；判定規則 ${escapeHtml(value.rule_version || '—')}；信心度門檻固定 0.5，低信心或資料不足一律不顯示為通過。</p>
      <table class="vm-table vm-table-prop"><thead><tr><th>位置</th><th>期望</th><th>檢測到</th><th>信心度</th><th>結果</th><th>說明</th></tr></thead><tbody>${rows || '<tr><td colspan="6">尚無檢測資料</td></tr>'}</tbody></table>
    </article>`;
  }

  // 啟用失敗時把閘口錯誤碼翻成教師看得懂的提示（不靜默、不引導繞過）。
  function visionActivateErrorMessage(message) {
    if (String(message || '').includes('model_quality_gate')) return '該模型未通過質量閘口：缺少 golden set 評估證據或 mAP50 低於門檻，暫時不能啟用。';
    if (String(message || '').includes('model_health_blocked')) return '該模型健康度未達標（未訓練或類別數不符），暫時不能啟用。';
    return String(message || '啟用失敗');
  }

  async function visionJson(fetchImpl, url, payload, headers = {}) {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status || 'error'}`);
    return body;
  }

  function submitPropCheck(fetchImpl, payload) {
    const safePayload = { ...payload };
    delete safePayload.model_id;
    delete safePayload.model_path;
    return visionJson(fetchImpl, '/api/v1/vision/prop-check', safePayload);
  }

  function submitHoverAnalyze(fetchImpl, payload) {
    const safePayload = { ...payload };
    delete safePayload.model_id;
    delete safePayload.model_path;
    return visionJson(fetchImpl, '/api/v1/vision/hover-analyze', safePayload);
  }

  function activateVisionModel(fetchImpl, modelId, teacherId) {
    return visionJson(fetchImpl, `/api/v1/vision/models/${encodeURIComponent(modelId)}/activate`, {}, { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': teacherId });
  }

  function teacherVisionPost(fetchImpl, url, payload, teacherId = 'MOCK_TEACHER') {
    return visionJson(fetchImpl, url, payload, { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': teacherId });
  }

  function fileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
      reader.readAsDataURL(file);
    });
  }

  // Student model submission: stored as an inert attachment, never executed client-side.
  function submitStudentModel(fetchImpl, payload) {
    return visionJson(fetchImpl, '/api/v1/vision/submissions', payload);
  }

  function importSubmission(fetchImpl, submissionId, payload, teacherId = 'MOCK_TEACHER') {
    return visionJson(fetchImpl, `/api/v1/vision/submissions/${encodeURIComponent(submissionId)}/import`, payload, { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': teacherId });
  }

  function createGoldenSet(fetchImpl, payload, teacherId = 'MOCK_TEACHER') {
    return visionJson(fetchImpl, '/api/v1/vision/golden-sets', payload, { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': teacherId });
  }

  function listGoldenSets(fetchImpl, modelType = null) {
    const query = modelType ? `?model_type=${encodeURIComponent(modelType)}` : '';
    return visionJson(fetchImpl, `/api/v1/vision/golden-sets${query}`);
  }

  function imageFilePayload(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取照片')); };
      image.onload = async () => {
        try { resolve({ image_base64: await fileAsBase64(file), image_width: image.naturalWidth, image_height: image.naturalHeight }); }
        finally { URL.revokeObjectURL(url); }
      };
      image.src = url;
    });
  }

  function sampleVideoFile(file, intervalSeconds = 1) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const cleanup = () => URL.revokeObjectURL(url);
      video.muted = true; video.preload = 'metadata'; video.src = url;
      video.onerror = () => { cleanup(); reject(new Error('無法讀取影片')); };
      video.onloadedmetadata = async () => {
        try {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          if (video.readyState < 2) await new Promise((done, fail) => { video.onloadeddata = done; video.onerror = fail; });
          const frames = [];
          const duration = Math.min(video.duration, 60);
          for (let timestamp = 0; timestamp <= duration; timestamp += intervalSeconds) {
            if (timestamp > 0) await new Promise((done, fail) => { video.onseeked = done; video.onerror = fail; video.currentTime = Math.min(timestamp, duration); });
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push({ timestamp, image_base64: canvas.toDataURL('image/jpeg', .82).split(',', 2)[1] });
          }
          resolve(frames);
        } catch (error) { reject(error); }
        finally { cleanup(); }
      };
    });
  }

  async function fetchVisionCollection(fetchImpl, url, teacherOnly = false) {
    const headers = teacherOnly ? { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' } : {};
    const response = await fetchImpl(url, { headers });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message || `HTTP ${response.status}`);
    return body;
  }

  function initializeVisionCenter(documentRef = document, fetchImpl = fetch) {
    const render = (selector, value) => { const element = documentRef.querySelector(selector); if (element) element.textContent = JSON.stringify(value, null, 2); };
    const renderHtml = (selector, html) => { const element = documentRef.querySelector(selector); if (element) element.innerHTML = html; };
    documentRef.querySelector('#refreshVisionModels')?.addEventListener('click', () => fetchVisionCollection(fetchImpl, '/api/v1/vision/models').then(value => { renderHtml('#visionModelList', visionModelListHtml(value)); renderHtml('#visionModelCompare', visionModelCompareHtml(value)); }).catch(error => renderHtml('#visionModelList', visionErrorHtml(error.message))));
    documentRef.querySelector('#refreshHardExamples')?.addEventListener('click', () => fetchVisionCollection(fetchImpl, '/api/v1/vision/hard-examples?status=PENDING', true).then(value => render('#hardExampleList', value)).catch(error => render('#hardExampleList', { error: error.message })));
    documentRef.querySelector('#refreshVisionDatasets')?.addEventListener('click', () => fetchVisionCollection(fetchImpl, '/api/v1/vision/datasets').then(value => render('#visionDatasetList', value)).catch(error => render('#visionDatasetList', { error: error.message })));
    documentRef.querySelector('#runPropAssessment')?.addEventListener('click', async () => {
      try {
        const file = documentRef.querySelector('#propAssessmentFile')?.files?.[0];
        if (!file) throw new Error('請先選擇槳葉照片');
        renderHtml('#propAssessmentResult', propAssessmentHtml(await submitPropCheck(fetchImpl, { ...await imageFilePayload(file), input_reference: file.name })));
      } catch (error) { renderHtml('#propAssessmentResult', visionErrorHtml(error.message)); }
    });
    documentRef.querySelector('#runHoverAssessment')?.addEventListener('click', async () => {
      try {
        const file = documentRef.querySelector('#hoverAssessmentFile')?.files?.[0];
        if (!file) throw new Error('請先選擇四面懸停影片');
        render('#hoverAssessmentResult', await submitHoverAnalyze(fetchImpl, { frames: await sampleVideoFile(file), camera_profile_id: documentRef.querySelector('#hoverCameraProfileId')?.value || null, input_reference: file.name }));
      } catch (error) { render('#hoverAssessmentResult', { error: error.message }); }
    });
    documentRef.querySelector('#uploadVisionModel')?.addEventListener('click', async () => {
      try {
        const file = documentRef.querySelector('#visionModelFile')?.files?.[0];
        if (!file) throw new Error('請選擇 best.pt');
        const payload = { model_type: documentRef.querySelector('#visionModelType').value, model_name: file.name.replace(/\.pt$/i, ''), version: documentRef.querySelector('#visionModelVersion').value, rule_version: documentRef.querySelector('#visionRuleVersion').value, dataset_id: documentRef.querySelector('#visionModelDatasetId').value, dataset_version: documentRef.querySelector('#visionModelDatasetVersion').value, file_name: file.name, file_base64: await fileAsBase64(file) };
        renderHtml('#visionModelList', visionModelListHtml(await teacherVisionPost(fetchImpl, '/api/v1/vision/models', payload)));
      } catch (error) { renderHtml('#visionModelList', visionErrorHtml(error.message)); }
    });
    documentRef.querySelector('#activateVisionModel')?.addEventListener('click', () => activateVisionModel(fetchImpl, documentRef.querySelector('#visionActionModelId').value, 'MOCK_TEACHER').then(value => renderHtml('#visionModelList', visionModelListHtml(value))).catch(error => renderHtml('#visionModelList', visionErrorHtml(visionActivateErrorMessage(error.message)))));
    documentRef.querySelector('#archiveVisionModel')?.addEventListener('click', () => teacherVisionPost(fetchImpl, `/api/v1/vision/models/${encodeURIComponent(documentRef.querySelector('#visionActionModelId').value)}/archive`, {}).then(value => renderHtml('#visionModelList', visionModelListHtml(value))).catch(error => renderHtml('#visionModelList', visionErrorHtml(error.message))));
    documentRef.querySelector('#saveGoldenEvaluation')?.addEventListener('click', () => teacherVisionPost(fetchImpl, `/api/v1/vision/models/${encodeURIComponent(documentRef.querySelector('#visionEvaluationModelId').value)}/evaluate`, JSON.parse(documentRef.querySelector('#visionEvaluationMetrics').value)).then(value => renderHtml('#visionModelCompare', visionModelCompareHtml(value))).catch(error => renderHtml('#visionModelCompare', visionErrorHtml(error.message))));
    const review = decision => teacherVisionPost(fetchImpl, `/api/v1/vision/hard-examples/${encodeURIComponent(documentRef.querySelector('#hardExampleId').value)}/review`, { decision, teacher_label: documentRef.querySelector('#hardExampleLabel').value || null }).then(value => render('#hardExampleList', value)).catch(error => render('#hardExampleList', { error: error.message }));
    documentRef.querySelector('#confirmHardExample')?.addEventListener('click', () => review('CONFIRMED'));
    documentRef.querySelector('#correctHardExample')?.addEventListener('click', () => review('CORRECTED'));
    documentRef.querySelector('#rejectHardExample')?.addEventListener('click', () => review('REJECTED'));
    documentRef.querySelector('#buildNextDataset')?.addEventListener('click', () => teacherVisionPost(fetchImpl, `/api/v1/vision/datasets/${encodeURIComponent(documentRef.querySelector('#parentDatasetId').value)}/build-next`, { hard_example_ids: documentRef.querySelector('#nextDatasetSamples').value.split(',').map(value => value.trim()).filter(Boolean), new_samples: [] }).then(value => render('#visionDatasetList', value)).catch(error => render('#visionDatasetList', { error: error.message })));
    documentRef.querySelector('#exportTrainingPackage')?.addEventListener('click', async () => {
      try {
        const datasetId = documentRef.querySelector('#exportDatasetId').value;
        const response = await fetchImpl(`/api/v1/vision/datasets/${encodeURIComponent(datasetId)}/export`, { headers: { 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        const anchor = documentRef.createElement('a'); anchor.href = url; anchor.download = `${datasetId}.zip`; anchor.click(); URL.revokeObjectURL(url);
      } catch (error) { render('#visionDatasetList', { error: error.message }); }
    });
    documentRef.querySelector('#saveCameraCalibration')?.addEventListener('click', () => teacherVisionPost(fetchImpl, '/api/v1/vision/camera-profiles', { four_corner_points: JSON.parse(documentRef.querySelector('#cameraCalibrationPoints').value) }).then(value => render('#cameraCalibrationResult', value)).catch(error => render('#cameraCalibrationResult', { error: error.message })));
    documentRef.querySelector('#refreshStudentSubmissions')?.addEventListener('click', () => fetchVisionCollection(fetchImpl, '/api/v1/vision/submissions?status=SUBMITTED', true).then(value => render('#studentSubmissionList', value)).catch(error => render('#studentSubmissionList', { error: error.message })));
    documentRef.querySelector('#importSubmission')?.addEventListener('click', async () => {
      try {
        const submissionId = documentRef.querySelector('#importSubmissionId').value;
        const payload = {
          model_name: documentRef.querySelector('#importModelName').value || submissionId,
          version: documentRef.querySelector('#importModelVersion').value || 'v1',
          dataset_id: documentRef.querySelector('#importDatasetId').value,
          dataset_version: documentRef.querySelector('#importDatasetVersion').value || 'v1',
          rule_version: documentRef.querySelector('#importRuleVersion').value || 'r1',
        };
        render('#studentSubmissionList', await importSubmission(fetchImpl, submissionId, payload));
      } catch (error) { render('#studentSubmissionList', { error: error.message }); }
    });
    documentRef.querySelector('#createGoldenSet')?.addEventListener('click', async () => {
      try {
        const payload = { model_type: documentRef.querySelector('#goldenSetType').value, name: documentRef.querySelector('#goldenSetName').value, total_cases: Number(documentRef.querySelector('#goldenSetCases').value || 0) };
        render('#goldenSetList', await createGoldenSet(fetchImpl, payload));
      } catch (error) { render('#goldenSetList', { error: error.message }); }
    });
    documentRef.querySelector('#refreshGoldenSets')?.addEventListener('click', () => fetchVisionCollection(fetchImpl, '/api/v1/vision/golden-sets', true).then(value => render('#goldenSetList', value)).catch(error => render('#goldenSetList', { error: error.message })));
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      applyTraditionalStudentLanguage(document.body);
      const controller = createController();
      initializeVisionCenter(document, fetch);
      controller.refreshHealth();
      controller.refreshCameraDevices();
      controller.initializeStudentMode().catch(() => renderTaskMapLoadError({ trainingTaskList: document.querySelector('#trainingTaskList'), taskMapScreen: document.querySelector('#taskMapScreen'), taskDetailScreen: document.querySelector('#taskDetailScreen') }));
      // P1-4：pagehide 只停相機/語音，不銷燬 session——刷新/導航後 ensureSession 仍能複用同一會話。
      window.addEventListener('pagehide', () => { controller.pauseVoiceCoach(); controller.stopCameraStream(); });
    });
  }

  return {
    autoStartError,
    renderTaskState,
    renderTrainingState,
    renderMissionPlannerState,
    setMp12View,
    mpSubtaskAction,
    selectMpSubtask,
    completeMpSubtask,
    submitMpTeacherReview,
    studentFacingLabel,
    studentTaskStatus,
    taskCompletionPolicy,
    showTaskMap,
    showTaskDetail,
    initializeStudentTaskMap,
    renderTaskMapLoadError,
    bindTaskMapRetry,
    handleVoiceTranscript,
    questionRequiresVision,
    cameraPreviewPolicy,
    toTraditionalStudentText,
    applyTraditionalStudentLanguage,
    assistantVisualActionState,
    voiceEntryState,
    genericVisualObservationQuestion,
    studentStepProgressLabel,
    studentCurrentStepView,
    detectBrowserCapabilities,
    selectChineseVoice,
    createSpeechReply,
    voiceAnswerSummary,
    deliverAiAnswer,
    createInteractionStateMachine,
    askLiveCoach,
    studentCoachMessage,
    shouldTriggerVision,
    studentStepGroupDefinitions,
    studentStepGroups,
    studentStepToolVisibility,
    studentPrimaryAction,
    trainingCompletionFeedback,
    confirmStep,
    simulateVision,
    saveTrainingEvidence,
    saveTrainingReflection,
    submitTeacherReview,
    fetchTrainingTaskView,
    submitTrainingStepFact,
    acknowledgeTrainingStepSafety,
    setClassroomValidation,
    recordClassroomEvent,
    fetchClassroomValidationReport,
    performCaptureInteraction,
    triggerFilePicker,
    performUploadInteraction,
    detectionResultHtml,
    cameraConstraints,
    cameraConstraintCandidates,
    mobileFacingCandidates,
    cameraConstraintsForDevices,
    openCameraWithFallback,
    replaceCameraStream,
    bindPushToTalk,
    shouldAutoStartCamera,
    createHandsFreeVoiceCoach,
    createLivePreviewMonitor,
    cameraErrorState,
    captureFrame,
    isCameraFrameReady,
    checkHealth,
    createController,
    drawDetectionOverlay,
    scaleBoxForContain,
    stopStream,
    submitSnapshot
    ,submitPropCheck
    ,submitHoverAnalyze
    ,activateVisionModel
    ,submitStudentModel
    ,importSubmission
    ,createGoldenSet
    ,listGoldenSets
    ,initializeVisionCenter
    ,visionModelStateMeta
    ,visionModelCardHtml
    ,visionModelListHtml
    ,visionModelCompareHtml
    ,propAssessmentHtml
    ,visionErrorHtml
    ,visionActivateErrorMessage
  };
});
