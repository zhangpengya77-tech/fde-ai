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
    const { recognitionFactory = null, onState = () => {}, onResult = () => {}, onError = () => {}, onNoResult = () => {}, onUnavailable = () => {}, stateMachine = null, readyLabel = '🎙 按住说话' } = options;
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
      if (!recognitionFactory) { const message = '当前浏览器不支持语音输入。请使用 Safari 打开，或使用「文字问 AI」。'; reset(); onUnavailable(message); return; }
      try {
        recognition = recognitionFactory();
        resultDelivered = false;
        latestTranscript = '';
        recognition.onstart = () => setState('LISTENING', '🎙 正在听……');
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
            setState('TRANSCRIBING', '正在识别语音…');
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
        setState('LISTENING', '🎙 正在听……');
      } catch (error) { reset(); onError(error.message || 'voice_input_failed'); }
    });
    function finish(event, cancelled) {
      event.preventDefault();
      if (!listening || !recognition) return;
      listening = false;
      if (cancelled && typeof recognition.abort === 'function') recognition.abort();
      else if (typeof recognition.stop === 'function') recognition.stop();
      if (!resultDelivered) setState('TRANSCRIBING', '正在识别语音…');
    }
    button.addEventListener('pointerup', (event) => finish(event, false));
    button.addEventListener('pointercancel', (event) => finish(event, true));
    return { reset, releaseButton };
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
    if (!detections.length) return '<li class="empty-result">未识别到目标零件</li>';
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

  async function saveTrainingReflection(fetchImpl, sessionId, reflection) {
    if (!String(reflection?.original_text || '').trim()) throw new Error('student_original_summary_required');
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/reflection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reflection) }));
  }

  async function submitTeacherReview(fetchImpl, sessionId, decision, note = '', taskId = null, stepId = null) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/teacher-review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' }, body: JSON.stringify({ task_id: taskId, step_id: stepId, decision, note }) }));
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

  const STUDENT_LABELS = Object.freeze({
    FC_MAIN_OUT_1: '飞控 MAIN OUT 1（1号电机输出接口）',
    FC_MAIN_OUT_2: '飞控 MAIN OUT 2（2号电机输出接口）',
    FC_MAIN_OUT_3: '飞控 MAIN OUT 3（3号电机输出接口）',
    FC_MAIN_OUT_4: '飞控 MAIN OUT 4（4号电机输出接口）',
    ERR_POWER_POLARITY: '电源正负极需要重新确认。'
  });

  function studentFacingLabel(identifier) {
    if (!identifier) return '—';
    return STUDENT_LABELS[identifier] || String(identifier).replaceAll('_', ' ').toLowerCase();
  }

  const STUDENT_TASK_STATUS = Object.freeze({
    NOT_STARTED: '未开始',
    IN_PROGRESS: '进行中',
    PENDING_TEACHER_REVIEW: '待教师确认',
    NEED_REWORK: '需重新检查',
    COMPLETED: '已完成',
    BLOCKED: '尚未解锁'
  });

  function studentTaskStatus(status) {
    return STUDENT_TASK_STATUS[status] || '准备中';
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
    if (elements.trainingTaskList) elements.trainingTaskList.innerHTML = '<li class="task-map-error">任务地图载入失败。<button type="button" data-retry-task-map>重新载入</button></li>';
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
    if (/上电|通电|解锁|起飞|马达测试|电机测试|failsafe|prearm|飞前|放行|真实飞行|安全/i.test(value)) return false;
    return /帮我看|幫我看|看一下|画面|畫面|镜头|鏡頭|这个是什么|這個是什麼|对不对|對不對|方向|接对|接對|桨叶|槳葉|螺旋桨|螺旋槳/i.test(value);
  }

  function cameraPreviewPolicy() {
    return { localPreview: true, continuousVision: false, captureMode: 'explicit_single_frame' };
  }

  function assistantVisualActionState(cameraActive) {
    return cameraActive
      ? { action: 'OBSERVE_FRAME', label: '🤖 AI 看当前画面' }
      : { action: 'OPEN_CAMERA', label: '📷 打开摄像头' };
  }

  function voiceEntryState(supported) {
    return supported
      ? { label: '🎙 按住说话', available: true }
      : { label: '🎙 语音暂不可用', available: false };
  }

  function genericVisualObservationQuestion() {
    return '请看一下当前画面，并结合我正在学习的步骤，用简单的话告诉我看到了什么、现在是否需要调整。';
  }

  function studentStepProgressLabel(step) {
    return step && Number(step.order) > 0 ? `当前第 ${Number(step.order)} 步` : '正在准备当前步骤…';
  }

  function studentCurrentStepView(step = {}) {
    if (step.step_id === 'T01_WORKSPACE') return {
      title: '准备工作区域',
      how: ['清空桌面', '把 F450 零件全部集中摆放', '电池先不要接电', '桨叶暂时不要安装'],
      doneWhen: ['所有零件都在桌面', '飞机没有接电', '桨叶没有安装', '工作区域没有杂物']
    };
    const instruction = step.student_instruction || step.instruction || '依照当前提示完成这一项操作。';
    const doneWhen = [];
    if (step.evidence_required?.length) doneWhen.push('需要的学习证据已经保存');
    if (step.teacher_gate) doneWhen.push('教师已经现场确认');
    if (!doneWhen.length) doneWhen.push('当前操作已经完成，并与页面说明一致');
    return { title: step.title || '正在准备当前步骤…', how: [instruction], doneWhen };
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
      NO_DETECTION: '目前没有清楚看到目标零件，请把零件完整放到镜头中央。',
      UNCERTAIN: 'AI 目前看不清楚，请调整角度或请老师确认。',
      NG: '目前看到的内容与这一步不符，请依照提示调整后再试一次。',
      PASS_CANDIDATE: 'AI 初步检查没有发现明显问题。',
      TEACHER_CHECK: '此步骤涉及安全操作，必须由教师确认后才能继续。',
      TASK_COMPLETED: '这个任务已经完成，可以准备下一项任务。'
    };
    const base = messages[state] || 'AI 助教已准备好，可以在需要时帮你检查。';
    return teacherRequired && state !== 'TEACHER_CHECK' ? `${base} 下一步请等待教师复核。` : base;
  }

  function studentTeacherStatus(status) {
    const labels = {
      NOT_REQUIRED: '当前步骤无需教师确认',
      REQUIRED: '此步骤需要教师确认',
      PENDING: '等待教师确认',
      PENDING_TEACHER_REVIEW: '等待教师确认',
      APPROVE: '教师已确认',
      APPROVED: '教师已确认',
      REJECT_REWORK: '教师要求重新检查',
      NEED_REWORK: '需依照教师意见重新检查'
    };
    return labels[status] || '当前步骤无需教师确认';
  }

  function shouldTriggerVision(training, reason) {
    if (reason === 'student_request') return true;
    if (!['sop_vision_check', 'auto_observation'].includes(reason)) return false;
    return Boolean(training?.task?.vision_tasks?.length);
  }

  const STUDENT_STEP_GROUP_DEFINITIONS = Object.freeze({
    TASK_01: [['准备区域',['T01_WORKSPACE']],['认识零件',['T01_FRAME','T01_MOTORS','T01_ESC','T01_PIXHAWK','T01_GPS','T01_ACCESSORIES']],['完成清点',['T01_CHECKLIST']],['AI 辅助检查',[]],['证据与总结',['T01_EVIDENCE','T01_REFLECTION']]],
    TASK_02: [['了解测试',['T02_PURPOSE','T02_NO_PROP']],['准备连接',['T02_TESTER','T02_CONNECT_SET1']],['教师确认',['T02_PREPOWER_TEACHER']],['测试四组',['T02_M1','T02_M2','T02_M3','T02_M4','T02_CROSS_TEST']],['复核与记录',['T02_FINAL_TEACHER','T02_RECORD']]],
    TASK_03: [['准备机架',['T03_LAYOUT','T03_FORWARD','T03_ARMS','T03_FRAME_CHECK']],['确认位置',['T03_TESTED_MOTORS','T03_POSITIONS']],['安装马达',['T03_SCREW','T03_INSTALL']],['完成检查',['T03_MECHANICAL']],['证据与总结',['T03_EVIDENCE','T03_REFLECTION']]],
    TASK_04: [['认识与规划',['T04_ESC_SIGNAL','T04_ROUTING']],['极性与绝缘',['T04_HEATSHRINK','T04_PDB_POLARITY','T04_XT60']],['焊接前确认',['T04_PRESOLDER_TEACHER']],['焊接与电气检查',['T04_SOLDER','T04_VISUAL','T04_CONTINUITY','T04_ELECTRICAL_APPROVAL']],['证据与总结',['T04_EVIDENCE','T04_REFLECTION']]],
    TASK_05: [['安装飞控',['T05_PIXHAWK','T05_ARROW']],['连接马达输出',['T05_MAIN_OUT']],['安装 GPS',['T05_GPS_INSTALL','T05_GPS_DIRECTION','T05_GPS_CONNECT']],['连接外设',['T05_RECEIVER','T05_TELEMETRY','T05_POWER_MODULE']],['证据与复核',['T05_EVIDENCE','T05_REVIEW']]],
    TASK_06: [['机械检查',['T06_MECHANICAL','T06_MOTOR_SCREW']],['电气检查',['T06_ESC_WIRING','T06_POLARITY']],['飞控与外设',['T06_FC','T06_GPS','T06_RADIO']],['证据与自检',['T06_EVIDENCE','T06_SELF_CHECK']],['教师放行与总结',['T06_TEACHER_RELEASE','T06_REFLECTION']]],
    TASK_07: [['首次上电前确认',['T07_PREPOWER_REVIEW','T07_FIRST_POWER_TEACHER']],['连接 Mission Planner',['T07_MP_CONNECT']],['飞控与机架确认',['T07_FC_FIRMWARE_AIRFRAME']],['加速度计校准',['T07_ACCEL_PREP','T07_ACCEL_CALIBRATION']],['罗盘校准',['T07_COMPASS_PREP','T07_COMPASS_CALIBRATION']],['遥控器校准',['T07_RADIO_PREP','T07_RADIO_CALIBRATION']],['Receiver 状态',['T07_RECEIVER_STATUS']],['Motor 输出映射',['T07_MOTOR_OUTPUT_MAPPING']],['飞行模式',['T07_FLIGHT_MODES']],['失控保护',['T07_FAILSAFE']],['GPS 状态',['T07_GPS_STATUS']],['RTL 返航',['T07_RTL']],['基础参数',['T07_BASE_PARAMETERS']],['配置总复核',['T07_FINAL_CONFIG_REVIEW']],['证据与总结',['T07_EVIDENCE','T07_REFLECTION']]]
  });

  function studentStepGroupDefinitions(taskId) {
    return (STUDENT_STEP_GROUP_DEFINITIONS[taskId] || []).map(([title, stepIds], index) => ({ id: `${taskId}_GROUP_${index + 1}`, title, step_ids: [...stepIds] }));
  }

  function studentStepGroups(taskId, steps = [], currentStepId = '', taskState = 'IN_PROGRESS') {
    let definitions = studentStepGroupDefinitions(taskId);
    if (!definitions.length) definitions = steps.map((step, index) => ({ id: `${taskId || 'TASK'}_GROUP_${index + 1}`, title: step.title || `步骤 ${index + 1}`, step_ids: [step.step_id || step.id] }));
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
      reflection: /REFLECTION$/.test(stepId) || /学习总结/.test(step.title || ''),
      teacher: Boolean(step.teacher_gate),
      safety: Boolean(step.safety_reminders?.length)
    };
  }

  function studentPrimaryAction(training = {}) {
    if (training.task_state === 'COMPLETED') return { kind: 'MAP', label: '返回任务地图' };
    if (training.task_state === 'PENDING_TEACHER_REVIEW') return { kind: 'WAIT', label: '等待教师确认' };
    if (training.task_state === 'NEED_REWORK') return { kind: 'REWORK', label: '重新完成这一步' };
    if (training.task_state === 'NOT_STARTED' || training.task_state === 'BLOCKED') return { kind: 'START', label: '开始任务' };
    const step = training.current_step || {};
    if (step.teacher_gate) return { kind: 'TEACHER', label: '请教师确认' };
    if (step.evidence_required?.length) return { kind: 'EVIDENCE', label: '保存学习证据' };
    if (/REFLECTION$/.test(step.step_id || step.id || '') || /学习总结/.test(step.title || '')) return { kind: 'REFLECTION', label: '保存学习总结' };
    if (!training.current_training_step_id && !Object.keys(step).length) return training.task?.teacher_review_required
      ? { kind: 'TASK_REVIEW', label: '提交教师复核' }
      : { kind: 'TASK_COMPLETE', label: '完成任务' };
    return { kind: 'STEP', label: '我完成了' };
  }

  function trainingCompletionFeedback(previousStepId, currentStepId, taskState) {
    if (taskState === 'COMPLETED') return { type: 'TASK', title: 'Task 已完成', canContinue: true };
    if (previousStepId && currentStepId && previousStepId !== currentStepId) return { type: 'STEP', title: '✅ 这一步完成', canContinue: true };
    return null;
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
    if (elements.trainingTitle) elements.trainingTitle.textContent = task.title || '等待任务资料';
    if (elements.trainingObjective) elements.trainingObjective.textContent = task.objective || '—';
    if (elements.trainingStepNumber) elements.trainingStepNumber.textContent = studentStepProgressLabel(step);
    if (elements.trainingAction) elements.trainingAction.textContent = step.student_instruction || step.instruction || task.description || '—';
    if (elements.trainingWhy) elements.trainingWhy.textContent = step.why_it_matters || step.rationale || task.description || '—';
    const taskId = task.id || task.task_id || training.current_task_id || `TASK_${String(order).padStart(2, '0')}`;
    const groups = studentStepGroups(taskId, steps, training.current_training_step_id, training.task_state);
    const activeGroup = groups.findIndex((group) => group.state === 'CURRENT');
    const stepView = studentCurrentStepView(step);
    const stepReminders = step.safety_reminders === undefined ? reminders : (step.safety_reminders || []);
    const visibility = studentStepToolVisibility({ ...step, safety_reminders: stepReminders });
    if (elements.currentStepTitle) elements.currentStepTitle.textContent = step.title || '等待当前步骤';
    if (elements.currentStepHow) elements.currentStepHow.innerHTML = stepView.how.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (elements.currentStepDoneWhen) elements.currentStepDoneWhen.innerHTML = stepView.doneWhen.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    if (elements.studentGroupProgress) elements.studentGroupProgress.innerHTML = groups.map((group, index) => `<li data-state="${group.state}"><span>${group.state === 'COMPLETED' ? '✓' : index + 1}</span><strong>${escapeHtml(group.title)}</strong></li>`).join('');
    if (elements.studentGroupCount) elements.studentGroupCount.textContent = `第 ${Math.max(0, activeGroup) + 1} 阶段 · ${groups[Math.max(0, activeGroup)]?.title || '准备'}`;
    if (elements.trainingSafety) elements.trainingSafety.innerHTML = stepReminders.map((item) => `<p>⚠ ${escapeHtml(item.message || studentFacingLabel(item.id))}</p>`).join('');
    if (elements.safetyCard) elements.safetyCard.hidden = !visibility.safety;
    if (elements.cameraTool) elements.cameraTool.hidden = false;
    if (elements.capture) elements.capture.hidden = true;
    if (elements.evidenceCard) elements.evidenceCard.hidden = !visibility.evidence;
    if (elements.reflectionCard) elements.reflectionCard.hidden = !visibility.reflection;
    if (elements.teacherCard) elements.teacherCard.hidden = !visibility.teacher;
    if (elements.trainingSteps) elements.trainingSteps.innerHTML = step.title ? `<li><strong>${escapeHtml(step.title)}</strong><br>${escapeHtml(step.instruction || '')}</li>` : '<li>等待任务步骤。</li>';
    if (elements.trainingStepList) elements.trainingStepList.innerHTML = steps.map((item) => `<li data-state="${escapeHtml(item.progress?.status || 'NOT_STARTED')}">${escapeHtml(item.title)}</li>`).join('');
    const conditions = [];
    if (step.safety_reminders?.length) conditions.push(step.progress?.safety_acknowledged ? '☑ 已阅读安全提醒' : '□ 已阅读安全提醒');
    if (step.evidence_required?.length) conditions.push(`□ Evidence：${step.evidence_required.join(', ')}`);
    if (step.teacher_gate) conditions.push(step.progress?.teacher_decision === 'APPROVE' ? '☑ 教师已通过' : '□ 等待教师确认');
    if (!conditions.length) conditions.push('□ 学生确认完成实际操作');
    if (elements.trainingCompletionConditions) elements.trainingCompletionConditions.innerHTML = conditions.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
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
    if (elements.trainingReflection) elements.trainingReflection.textContent = training.reflection_state === 'available' ? '学习总结已保存' : '尚未填写';
    if (elements.trainingTeacher) elements.trainingTeacher.textContent = studentTeacherStatus(training.teacher_review_state || 'NOT_REQUIRED');
    if (elements.trainingGrowth) elements.trainingGrowth.textContent = `${training.progress || '0 / 12'} · 待同步`;
    if (elements.trainingPrerequisite) elements.trainingPrerequisite.textContent = training.unsafe_action_allowed === false ? '你可以先学习这一部分；当前危险操作需要先完成安全检查并由教师确认。' : '可以开始学习';
    if (elements.cameraWaiting && training.camera_active === true) elements.cameraWaiting.textContent = 'ACTIVE / WAITING';
    if (elements.trainingTaskList && Array.isArray(training.tasks)) elements.trainingTaskList.innerHTML = training.tasks.map((item) => {
      const status = item.status || 'NOT_STARTED';
      const blocked = status === 'BLOCKED' ? '可学习 / 当前不可正式执行' : studentTaskStatus(status);
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
    else if (session.state === 'TASK_COMPLETED') { elements.step.textContent = 'TASK COMPLETED'; elements.instruction.textContent = '基础零件准备完成。'; }
    if (payload.detection) elements.visionResult.textContent = `${payload.detection.class} ${(payload.detection.confidence * 100).toFixed(1)}%`;
    if (payload.sop) elements.sopResult.textContent = payload.sop.status;
    else if (session.state) elements.sopResult.textContent = session.state;
    if (payload.guidance) elements.guidance.textContent = payload.guidance.text;
    else if (elements.guidance && session.state) elements.guidance.textContent = studentCoachMessage(session.state, session.state === 'TEACHER_CHECK');
    const rag = payload.rag_explanation || session.rag_explanation;
    if (rag && elements.ragExplanation) {
      const explanation = rag.explanation || (rag.status === 'pending' ? '正在查询教学知识…' : '目前知识库说明暂时不可用。');
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

  function createController({ documentRef = document, navigatorRef = navigator, fetchImpl = fetch } = {}) {
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
      pushToTalk: documentRef.querySelector('#pushToTalk'), textAskAi: documentRef.querySelector('#textAskAi'), assistantVisualAction: documentRef.querySelector('#assistantVisualAction'), askAiPanel: documentRef.querySelector('#askAiPanel'), askAiInput: documentRef.querySelector('#askAiInput'), submitAskAi: documentRef.querySelector('#submitAskAi'), cancelAiInteraction: documentRef.querySelector('#cancelAiInteraction'), askAiResponse: documentRef.querySelector('#askAiResponse'), voiceStatus: documentRef.querySelector('#voiceStatus'), voiceReplyControls: documentRef.querySelector('#voiceReplyControls'), playAiAnswer: documentRef.querySelector('#playAiAnswer'), stopAiAnswer: documentRef.querySelector('#stopAiAnswer'),
      trainingTaskList: documentRef.querySelector('#trainingTaskList'), trainingProgress: documentRef.querySelector('#trainingProgress'), mapProgress: documentRef.querySelector('#mapProgress'), trainingTaskNumber: documentRef.querySelector('#trainingTaskNumber'), trainingStepNumber: documentRef.querySelector('#trainingStepNumber'), trainingTitle: documentRef.querySelector('#trainingTitle'), trainingObjective: documentRef.querySelector('#trainingObjective'), trainingAction: documentRef.querySelector('#trainingAction'), trainingWhy: documentRef.querySelector('#trainingWhy'), trainingSafety: documentRef.querySelector('#trainingSafety'), trainingSteps: documentRef.querySelector('#trainingSteps'), trainingStepList: documentRef.querySelector('#trainingStepList'), trainingCompletionConditions: documentRef.querySelector('#trainingCompletionConditions'), acknowledgeTrainingSafety: documentRef.querySelector('#acknowledgeTrainingSafety'), confirmTrainingStep: documentRef.querySelector('#confirmTrainingStep'), trainingStatus: documentRef.querySelector('#trainingStatus'), trainingEvidence: documentRef.querySelector('#trainingEvidence'), trainingReflection: documentRef.querySelector('#trainingReflectionState'), trainingTeacher: documentRef.querySelector('#trainingTeacher'), trainingGrowth: documentRef.querySelector('#trainingGrowth'), trainingPrerequisite: documentRef.querySelector('#trainingPrerequisite'), cameraWaiting: documentRef.querySelector('#cameraWaiting'),
      taskMapScreen: documentRef.querySelector('#taskMapScreen'), taskDetailScreen: documentRef.querySelector('#taskDetailScreen'), backToTaskMap: documentRef.querySelector('#backToTaskMap'), studentGroupProgress: documentRef.querySelector('#studentGroupProgress'), studentGroupCount: documentRef.querySelector('#studentGroupCount'), currentStepTitle: documentRef.querySelector('#currentStepTitle'), currentStepHow: documentRef.querySelector('#currentStepHow'), currentStepDoneWhen: documentRef.querySelector('#currentStepDoneWhen'), safetyCard: documentRef.querySelector('#safetyCard'), cameraTool: documentRef.querySelector('#cameraTool'), evidenceCard: documentRef.querySelector('#evidenceCard'), reflectionCard: documentRef.querySelector('#reflectionCard'), teacherCard: documentRef.querySelector('#teacherCard'), completionCard: documentRef.querySelector('#completionCard'), stepCompleteFeedback: documentRef.querySelector('#stepCompleteFeedback'), taskCompleteFeedback: documentRef.querySelector('#taskCompleteFeedback'), continueTrainingStep: documentRef.querySelector('#continueTrainingStep'),
      browserCapabilityWarning: documentRef.querySelector('#browserCapabilityWarning'), browserCapabilityTitle: documentRef.querySelector('#browserCapabilityTitle'), browserCapabilityMessage: documentRef.querySelector('#browserCapabilityMessage'), copyCurrentLink: documentRef.querySelector('#copyCurrentLink'), capabilityCamera: documentRef.querySelector('#capabilityCamera'), capabilitySpeechInput: documentRef.querySelector('#capabilitySpeechInput'), capabilitySpeechOutput: documentRef.querySelector('#capabilitySpeechOutput'), capabilityBrowser: documentRef.querySelector('#capabilityBrowser'),
      diagnosticVoiceState: documentRef.querySelector('#diagnosticVoiceState'), diagnosticTranscript: documentRef.querySelector('#diagnosticTranscript'), diagnosticAskRequest: documentRef.querySelector('#diagnosticAskRequest'), diagnosticAskLatency: documentRef.querySelector('#diagnosticAskLatency'), diagnosticFrame: documentRef.querySelector('#diagnosticFrame'), diagnosticVision: documentRef.querySelector('#diagnosticVision'), diagnosticRag: documentRef.querySelector('#diagnosticRag'), diagnosticTts: documentRef.querySelector('#diagnosticTts'), diagnosticLastError: documentRef.querySelector('#diagnosticLastError'),
      safetyAcknowledgment: documentRef.querySelector('#safetyAcknowledgment'), primaryTrainingAction: documentRef.querySelector('#primaryTrainingAction'),
      evidenceFile: documentRef.querySelector('#trainingEvidenceFile'), saveEvidence: documentRef.querySelector('#saveTrainingEvidence'), reflectionOriginal: documentRef.querySelector('#reflectionOriginal'), reflectionAssisted: documentRef.querySelector('#reflectionAssisted'), saveReflection: documentRef.querySelector('#saveTrainingReflection'), startTrainingTask: documentRef.querySelector('#startTrainingTask'), completeTrainingTask: documentRef.querySelector('#completeTrainingTask'), devTeacherControls: documentRef.querySelector('#devTeacherControls'), teacherApprove: documentRef.querySelector('#mockTeacherApprove'), teacherReject: documentRef.querySelector('#mockTeacherReject'),
      startCoach: documentRef.querySelector('#startCoach'), stopCoach: documentRef.querySelector('#stopCoach'), manualMode: documentRef.querySelector('#manualMode'), autoMode: documentRef.querySelector('#autoMode'), autoMetrics: documentRef.querySelector('#autoMetrics')
    };
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

    function renderInteraction(event) {
      const state = event.state;
      if (elements.diagnosticVoiceState) elements.diagnosticVoiceState.textContent = state;
      const busy = ['ASKING', 'CAPTURING_FRAME', 'VISION_PROCESSING'].includes(state);
      if (elements.cancelAiInteraction) elements.cancelAiInteraction.hidden = !busy;
      if (elements.submitAskAi) elements.submitAskAi.disabled = busy;
      if (elements.assistantVisualAction) elements.assistantVisualAction.disabled = busy;
      if (elements.pushToTalk) elements.pushToTalk.disabled = busy || state === 'SPEAKING';
      const labels = { LISTENING: '🎙 正在听……', TRANSCRIBING: '正在识别语音…', ASKING: 'AI 正在思考…', CAPTURING_FRAME: '正在读取当前画面…', VISION_PROCESSING: 'AI 正在看画面…', ANSWER_READY: 'AI 已回答', SPEAKING: 'AI 正在回答…' };
      if (labels[state] && elements.voiceStatus) elements.voiceStatus.textContent = labels[state];
      if (state === 'IDLE') {
        const entry = voiceEntryState(capabilities.speechInput);
        if (elements.pushToTalk) { elements.pushToTalk.textContent = entry.label; elements.pushToTalk.disabled = false; }
        if (event.recoveredFromTimeout && elements.voiceStatus) elements.voiceStatus.textContent = event.recoveredFromTimeout === 'TRANSCRIBING' || event.recoveredFromTimeout === 'LISTENING' ? '这次语音没有成功处理，请再说一次，或使用文字问 AI。' : event.recoveredFromTimeout === 'VISION_PROCESSING' || event.recoveredFromTimeout === 'CAPTURING_FRAME' ? '这次画面分析没有完成，请重新试一次。' : 'AI 服务暂时没有回应，请稍后再试。';
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
      if (elements.browserCapabilityTitle) elements.browserCapabilityTitle.textContent = '部分功能暂不可用';
      if (elements.browserCapabilityMessage) elements.browserCapabilityMessage.textContent = '当前浏览器的摄像头或语音能力有限；你仍可使用文字问 AI。';
    }
    elements.copyCurrentLink?.addEventListener('click', async () => {
      const href = globalThis.location?.href || '';
      try {
        await navigatorRef.clipboard?.writeText(href);
        elements.copyCurrentLink.textContent = '已复制链接';
      } catch (_) {
        elements.copyCurrentLink.textContent = '请从浏览器地址栏复制链接';
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
        elements.currentCameraFacing.textContent = currentFacingMode === 'user' ? '前置镜头' : '后置镜头';
      } else {
        elements.currentCameraFacing.textContent = track?.label || elements.cameraDevice.selectedOptions?.[0]?.textContent || '摄像头';
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

    async function ensureSession(visionSource = 'REAL_VISION') {
      if (sessionId && sessionVisionSource === visionSource) return sessionId;
      if (sessionId) {
        try { await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }); } catch {}
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
      elements.devPanel.hidden = !created.dev_mode;
      const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`));
      renderTaskState(elements, state);
      currentTrainingState = state.training || null;
      currentTrainingTaskId = state.training?.current_task_id || currentTrainingTaskId;
      currentTrainingStepId = state.training?.current_training_step_id || null;
      initializeStudentTaskMap(elements, state.training);
      if (elements.devTeacherControls) elements.devTeacherControls.hidden = !created.dev_mode;
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
        await elements.video.play();
        await refreshCameraDevices();
        const activeSession = await ensureSession();
        await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(activeSession)}/camera/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
        elements.start.disabled = true;
        elements.start.textContent = '相机已启动';
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
        if (elements.cameraWaiting) elements.cameraWaiting.textContent = 'ACTIVE / WAITING';
        updateAssistantVisualAction();
        setMessage(opened.fallbackUsed ? '摄像头已启动（兼容模式）。AI 不会持续分析画面，需要时点击「AI 看当前画面」或直接问 AI。' : '摄像头已开启。AI 不会持续分析画面，需要时点击「AI 看当前画面」或直接问 AI。');
      } catch (error) {
        stopStream(stream);
        stream = null;
        elements.video.srcObject = null;
        updateAssistantVisualAction();
        const mapped = cameraErrorState(error);
        setCameraState(mapped.state);
        elements.cameraDiagnostics.hidden = false;
        elements.cameraDiagnostics.textContent = 'Camera Error: ' + mapped.name + ' | Message: ' + mapped.message + ' | Failed Constraint: ' + (mapped.constraint || 'unknown');
        setMessage(mapped.state === 'PERMISSION REQUIRED' ? '请允许浏览器使用摄像头。' : '摄像头开启失败，请查看诊断信息。');
      }
    }

    async function switchCameraSource() {
      if (!stream) { setMessage('请先打开摄像头。'); return false; }
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
          setMessage('无法切换到该镜头，请确认浏览器已允许摄像头权限。已恢复原镜头。');
        } else {
          currentFacingMode = targetFacing;
          setMessage(`已切换到${targetFacing === 'user' ? '前置镜头' : '后置镜头'}。`);
        }
        updateCameraSourceLabel(currentFacingMode);
        setCameraState('ACTIVE', 'online');
        if (elements.cameraWaiting) elements.cameraWaiting.textContent = 'ACTIVE / WAITING';
        elements.capture.disabled = false;
        elements.stop.disabled = false;
        return !opened.restored;
      } catch (error) {
        stream = null;
        elements.video.srcObject = null;
        elements.currentCameraFacing.textContent = '切换失败';
        elements.switchCamera.disabled = true;
        setCameraState('CAMERA ERROR', 'offline');
        setMessage('无法切换到该镜头，请确认浏览器已允许摄像头权限。');
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
      setMessage('检测完成');
    }

    async function capture() {
      await performCaptureInteraction({
        captureFrame: () => captureFrame(elements.video, elements.captureCanvas),
        sendImage: (captured) => sendImage(captured.imageData, captured.captureMs, captured.width, captured.height, captured.encodeMs),
        setBusy: (busy) => {
          elements.capture.disabled = busy;
          elements.capture.textContent = busy ? 'AI 正在检查…' : '🤖 AI 看当前画面';
          if (busy) setMessage('AI 正在检查当前画面…');
        },
        onError: (error) => {
          const status = error.status ? `HTTP ${error.status} ` : '';
          const code = error.code ? `${error.code}: ` : '';
          setMessage(`检测失败：${status}${code}${error.message}`);
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

    async function stopCamera() {
      stopAutoObservation();
      stopStream(stream);
      stream = null;
      elements.video.srcObject = null;
      elements.start.disabled = false;
      elements.start.textContent = '启动摄像头';
      elements.currentCameraFacing.textContent = '尚未开启';
      elements.switchCamera.disabled = true;
      elements.capture.disabled = true;
      elements.stop.disabled = true;
      elements.cameraResolution.textContent = "—";
      elements.cameraHint.hidden = false;
      setCameraState(cameras.length ? 'STOPPED' : 'ERROR', cameras.length ? 'checking' : 'offline');
      if (elements.cameraWaiting) elements.cameraWaiting.textContent = 'STOPPED';
      updateAssistantVisualAction();
      if (sessionId) {
        const oldSession = sessionId;
        sessionId = null;
        sessionVisionSource = null;
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
      if (error) { setMessage(error === 'camera_required' ? '请先启动摄像头。' : 'Session 尚未建立。'); return false; }
      if (!globalThis.FdeAutoObservation) throw new Error('auto_scheduler_unavailable');
      if (!autoScheduler) autoScheduler = globalThis.FdeAutoObservation.createAutoObservationScheduler({
        intervalMs: 1000,
        captureAndSend: capture,
        onMetrics: (metrics) => { elements.autoMetrics.textContent = `1 FPS · Requests ${metrics.requestCount} · Skipped ${metrics.skippedFrameCount} · Max in-flight ${metrics.maxInFlight} · Queue ${metrics.queueLength}`; },
        onError: (failure) => setMessage(`自动观察失败：${failure.message}`)
      });
      await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/auto/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
      autoScheduler.start();
      elements.autoMode.checked = true;
      elements.startCoach.disabled = true;
      elements.stopCoach.disabled = false;
      setMessage('AI 自动观察已启动（1 FPS）。');
      return true;
    }

    function stopAutoObservation() {
      autoScheduler?.stop();
      if (sessionId) fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/auto/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      elements.startCoach.disabled = false;
      elements.stopCoach.disabled = true;
      setMessage('AI 自动观察已停止；摄像头保持当前状态。');
    }

    elements.start.addEventListener('click', startCamera);
    elements.switchCamera?.addEventListener('click', () => switchCameraSource());
    elements.capture.addEventListener('click', capture);
    elements.stop.addEventListener('click', stopCamera);
    elements.upload.addEventListener('click', () => triggerFilePicker(elements.file, devLog));
    elements.file.addEventListener('change', (event) => performUploadInteraction(event.target.files?.[0], useFile, devLog).catch((error) => setMessage(`图片检测失败：${error.message}`)));

    let voiceControl = null;
    voiceControl = bindPushToTalk(elements.pushToTalk, {
      recognitionFactory: SpeechRecognitionCtor ? () => { const recognition = new SpeechRecognitionCtor(); recognition.lang = 'zh-CN'; recognition.interimResults = false; recognition.continuous = false; return recognition; } : null,
      stateMachine: interaction,
      readyLabel: voiceEntryState(capabilities.speechInput).label,
      onResult: (transcript) => {
        elements.askAiPanel.hidden = false;
        if (elements.diagnosticTranscript) elements.diagnosticTranscript.textContent = transcript;
        void handleVoiceTranscript(transcript, (value) => { elements.askAiInput.value = value; }, (question) => submitStudentQuestion(question, { source: 'VOICE', autoSpeak: true }));
      },
      onNoResult: () => { elements.voiceStatus.textContent = '没有听清楚，请再说一次。'; if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = 'NO_SPEECH_RESULT'; },
      onError: (code) => { elements.voiceStatus.textContent = code === 'not-allowed' || code === 'service-not-allowed' ? '当前浏览器无法使用麦克风，请允许权限或使用文字问 AI。' : '没有听清楚，请再说一次。'; if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = `SPEECH_${String(code).toUpperCase()}`; },
      onUnavailable: (message) => { elements.voiceStatus.textContent = message; elements.voiceStatus.dataset.code = 'VOICE_PROVIDER_NOT_CONFIGURED'; elements.askAiPanel.hidden = false; }
    });
    elements.textAskAi?.addEventListener('click', () => { elements.askAiPanel.hidden = false; elements.askAiInput.focus(); });
    function speechCallbacks() {
      return {
        onStart: () => { if (ttsStartWatchdog) clearTimeout(ttsStartWatchdog); interaction.transition('SPEAKING'); if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'speaking'; elements.stopAiAnswer.hidden = false; },
        onEnd: () => { if (ttsStartWatchdog) clearTimeout(ttsStartWatchdog); elements.voiceStatus.textContent = 'AI 回答完成'; if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'completed'; elements.stopAiAnswer.hidden = true; interaction.reset(); voiceControl?.releaseButton(); },
        onError: () => { if (ttsStartWatchdog) clearTimeout(ttsStartWatchdog); elements.voiceStatus.textContent = '语音播放失败，请阅读文字回答或点击播放。'; if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'error'; elements.stopAiAnswer.hidden = true; interaction.reset(); voiceControl?.releaseButton(); }
      };
    }
    async function submitStudentQuestion(question, { autoSpeak = false, source = 'TEXT' } = {}) {
      if (!question.trim()) { elements.askAiResponse.textContent = source === 'VOICE' ? '没有听清楚，请再说一次。' : '请先输入问题。'; interaction.reset(); return; }
      currentAskController?.abort();
      const askController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      currentAskController = askController;
      const interactionId = `${source.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const requestId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const visual = questionRequiresVision(question);
      if (visual && !isCameraFrameReady(stream, elements.video)) {
        elements.askAiResponse.textContent = stream ? '摄像头画面还没准备好，请稍等一秒再试。' : '请先打开摄像头，把目标放到画面中央后再问一次。';
        if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = 'CAMERA_NOT_READY';
        interaction.transition('ERROR'); interaction.reset(); voiceControl?.releaseButton(); return;
      }
      interaction.transition(visual ? 'CAPTURING_FRAME' : 'ASKING', { requestId, interactionId });
      if (elements.diagnosticAskRequest) elements.diagnosticAskRequest.textContent = requestId;
      elements.askAiResponse.textContent = 'AI 正在根据当前步骤查询教学知识…';
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
        interaction.transition('ANSWER_READY', { requestId, interactionId });
        const delivered = deliverAiAnswer(result.answer, { autoSpeak, speechReply, callbacks: speechCallbacks() });
        lastAiAnswer = delivered.text;
        elements.askAiResponse.textContent = delivered.text;
        elements.voiceReplyControls.hidden = false;
        if (elements.diagnosticAskLatency) elements.diagnosticAskLatency.textContent = `${(performance.now() - started).toFixed(1)} ms`;
        if (elements.diagnosticVision) elements.diagnosticVision.textContent = result.vision_used ? 'one-frame completed' : 'not used';
        if (elements.diagnosticRag) elements.diagnosticRag.textContent = result.rag_status || '—';
        if (autoSpeak && delivered.spoken) {
          ttsStartWatchdog = setTimeout(() => {
            if (interaction.state() !== 'SPEAKING') {
              elements.voiceStatus.textContent = 'AI 已回答，请点击「播放回答」收听。';
              if (elements.diagnosticTts) elements.diagnosticTts.textContent = 'autoplay blocked';
              interaction.reset(); voiceControl?.releaseButton();
            }
          }, 1500);
        } else if (autoSpeak) { elements.voiceStatus.textContent = '此浏览器不支持语音播放，请阅读文字回答。'; interaction.reset(); voiceControl?.releaseButton(); }
        else { elements.voiceStatus.textContent = 'AI 已回答，可点击播放回答。'; interaction.reset(); voiceControl?.releaseButton(); }
        elements.voiceStatus.dataset.code = result.vision_used ? 'VISION_SINGLE_FRAME' : 'CONTEXT_ANSWER';
      } catch (error) {
        if (error.name === 'AbortError') elements.askAiResponse.textContent = '已取消这次询问。';
        else if (error.message === 'ask_timeout') elements.askAiResponse.textContent = visual ? '这次画面分析没有完成，请重新试一次。' : 'AI 服务暂时没有回应，请稍后再试。';
        else if (error.message === 'camera_not_ready' || error.message === 'camera_frame_required') elements.askAiResponse.textContent = '摄像头画面还没准备好，请稍等一秒再试。';
        else elements.askAiResponse.textContent = visual ? '这次没有成功读取画面，请重新检查镜头后再试。' : 'AI 服务暂时没有回应，请稍后再试。';
        if (elements.diagnosticLastError) elements.diagnosticLastError.textContent = error.message || error.name;
        interaction.transition('ERROR', { requestId, interactionId }); interaction.reset(); voiceControl?.releaseButton();
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
    elements.cancelAiInteraction?.addEventListener('click', () => { currentAskController?.abort(); speechReply.stop(); interaction.reset(); voiceControl?.releaseButton(); elements.voiceStatus.textContent = '已取消这次询问。'; });
    elements.playAiAnswer?.addEventListener('click', () => {
      if (!lastAiAnswer) return;
      if (!speechReply.speak(lastAiAnswer, speechCallbacks())) elements.voiceStatus.textContent = '此浏览器不支持语音播放，请阅读文字回答。';
    });
    elements.stopAiAnswer?.addEventListener('click', () => { speechReply.stop(); elements.stopAiAnswer.hidden = true; elements.voiceStatus.textContent = '已停止播放'; });

    elements.startCoach.addEventListener('click', () => startAutoObservation().catch((error) => setMessage(`自动观察启动失败：${error.message}`)));
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
          const result = await submitTrainingStepFact(fetchImpl, id, currentTrainingStepId);
          acceptTrainingMutation(result.training); return;
        }
        if (action === 'EVIDENCE') {
          const file = elements.evidenceFile?.files?.[0];
          if (!file) { setMessage('请先拍照或选择学习证据。'); return; }
          const result = await saveTrainingEvidence(fetchImpl, id, { task_id: currentTrainingTaskId, step_id: currentTrainingStepId, evidence_type: file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO', source: 'STUDENT_UPLOAD', file_reference: `dev-upload://${file.name}`, metadata: { name: file.name, size: file.size, type: file.type } });
          acceptTrainingMutation(result.training); setMessage('学习证据已保存。'); return;
        }
        if (action === 'REFLECTION') {
          const result = await saveTrainingReflection(fetchImpl, id, { task_id: currentTrainingTaskId, step_id: currentTrainingStepId, original_text: elements.reflectionOriginal.value, ai_assisted_text: elements.reflectionAssisted.value || null, source_type: 'TEXT' });
          acceptTrainingMutation(result.training); setMessage('学习总结已保存。'); return;
        }
        if (action === 'TASK_REVIEW' || action === 'TASK_COMPLETE') {
          const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/training/tasks/${encodeURIComponent(currentTrainingTaskId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
          renderCurrentTraining(state.training);
        }
      } catch (error) {
        const messages = { unsafe_step_prerequisites: '你可以先学习这一部分；当前危险操作需要先完成安全检查并由教师确认。', student_original_summary_required: '请先填写自己的真实学习总结。' };
        const key = Object.keys(messages).find((item) => String(error.message).includes(item));
        setMessage(key ? messages[key] : `目前无法继续：${error.message}`);
      }
    });
    elements.teacherApprove?.addEventListener('click', async () => { const id = await ensureSession(); const result = await submitTeacherReview(fetchImpl, id, 'APPROVE', 'Development teacher review', currentTrainingTaskId, currentTrainingStepId); acceptTrainingMutation(result.training); });
    elements.teacherReject?.addEventListener('click', async () => { const id = await ensureSession(); const result = await submitTeacherReview(fetchImpl, id, 'REJECT_REWORK', 'Development teacher requested rework', currentTrainingTaskId, currentTrainingStepId); currentTrainingStepId = result.training.current_training_step_id; renderTrainingState(elements, result.training); });
    elements.trainingTaskList?.addEventListener('click', async (event) => { const taskId = event.target.closest?.('[data-view-task]')?.dataset?.viewTask; if (!taskId) return; const id = await ensureSession(); const result = await fetchTrainingTaskView(fetchImpl, id, taskId); currentTrainingTaskId = taskId; renderCurrentTraining({ ...result.training_task_view, current_task_id: taskId, progress: elements.trainingProgress.textContent, evidence_count: elements.trainingEvidence.textContent, reflection_state: elements.trainingReflection.textContent, teacher_review_state: result.training_task_view.task.teacher_review_required ? 'REQUIRED' : 'NOT_REQUIRED' }); showTaskDetail(elements); setMessage(result.training_task_view.unsafe_action_allowed === false ? '可以先学习；到危险操作时需要完成安全检查并由教师确认。' : '此任务可以开始学习。'); });
    async function refreshMap() { const id = await ensureSession(); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`)); renderCurrentTraining(state.training); showTaskMap(elements); }
    bindTaskMapRetry(elements.trainingTaskList, () => refreshMap().catch(() => renderTaskMapLoadError(elements)));
    elements.backToTaskMap?.addEventListener('click', () => refreshMap().catch((error) => setMessage(`任务地图刷新失败：${error.message}`)));
    elements.continueTrainingStep?.addEventListener('click', () => { if (!pendingTrainingState) return; const training = pendingTrainingState; pendingTrainingState = null; elements.stepCompleteFeedback.hidden = true; if (elements.completionCard) elements.completionCard.hidden = false; renderCurrentTraining(training); });

    return { refreshHealth, refreshCameraDevices, initializeStudentMode: ensureSession, startCamera, switchCameraSource, capture, stopCamera, startAutoObservation, stopAutoObservation };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      const controller = createController();
      controller.refreshHealth();
      controller.refreshCameraDevices();
      controller.initializeStudentMode().catch(() => renderTaskMapLoadError({ trainingTaskList: document.querySelector('#trainingTaskList'), taskMapScreen: document.querySelector('#taskMapScreen'), taskDetailScreen: document.querySelector('#taskDetailScreen') }));
      window.addEventListener('pagehide', () => controller.stopCamera());
    });
  }

  return {
    autoStartError,
    renderTaskState,
    renderTrainingState,
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
    cameraErrorState,
    captureFrame,
    isCameraFrameReady,
    checkHealth,
    createController,
    drawDetectionOverlay,
    scaleBoxForContain,
    stopStream,
    submitSnapshot
  };
});
