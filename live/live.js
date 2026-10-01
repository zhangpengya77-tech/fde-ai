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
    if (deviceId) return [{ video: { deviceId: { exact: deviceId }, ...ideals }, audio: false }, { video: { deviceId: { exact: deviceId } }, audio: false }, { video: true, audio: false }];
    if (preferEnvironment) return [{ video: { facingMode: { ideal: 'environment' }, ...ideals }, audio: false }, { video: { facingMode: { ideal: 'environment' } }, audio: false }, { video: true, audio: false }];
    return [{ video: { ...ideals }, audio: false }, { video: true, audio: false }];
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

  async function submitTeacherReview(fetchImpl, sessionId, decision, note = '', taskId = null) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/teacher-review`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FDE-Role': 'teacher', 'X-FDE-Teacher-ID': 'MOCK_TEACHER' }, body: JSON.stringify({ task_id: taskId, decision, note }) }));
  }

  async function fetchTrainingTaskView(fetchImpl, sessionId, taskId) {
    return parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}/training/tasks/${encodeURIComponent(taskId)}`));
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

  function shouldTriggerVision(training, reason) {
    if (reason === 'student_request') return true;
    if (!['sop_vision_check', 'auto_observation'].includes(reason)) return false;
    return Boolean(training?.task?.vision_tasks?.length);
  }

  function renderTrainingState(elements, training = {}) {
    const task = training.task || {};
    const order = Number(task.order || 1);
    const reminders = task.safety_reminders || [];
    const steps = task.steps || [];
    if (elements.trainingProgress) elements.trainingProgress.textContent = training.progress || '0 / 12';
    if (elements.trainingTaskNumber) elements.trainingTaskNumber.textContent = `Task ${String(order).padStart(2, '0')} / 12`;
    if (elements.trainingTitle) elements.trainingTitle.textContent = task.title || '等待任务资料';
    if (elements.trainingObjective) elements.trainingObjective.textContent = task.objective || '—';
    if (elements.trainingAction) elements.trainingAction.textContent = steps[0]?.instruction || task.description || '—';
    if (elements.trainingWhy) elements.trainingWhy.textContent = steps[0]?.rationale || task.description || '—';
    if (elements.trainingSafety) elements.trainingSafety.innerHTML = reminders.length ? reminders.map((item) => `<p>⚠ ${escapeHtml(item.message || studentFacingLabel(item.id))}</p>`).join('') : '<p>本步骤暂无额外安全提醒。</p>';
    if (elements.trainingSteps) elements.trainingSteps.innerHTML = steps.length ? steps.map((step) => `<li><strong>${escapeHtml(step.title || studentFacingLabel(step.id))}</strong><br>${escapeHtml(step.instruction || '')}</li>`).join('') : '<li>等待任务步骤。</li>';
    if (elements.trainingStatus) elements.trainingStatus.textContent = training.task_state || 'NOT_STARTED';
    if (elements.trainingEvidence) elements.trainingEvidence.textContent = String(training.evidence_count || 0);
    if (elements.trainingReflection) elements.trainingReflection.textContent = training.reflection_state || 'missing';
    if (elements.trainingTeacher) elements.trainingTeacher.textContent = training.teacher_review_state || 'NOT_REQUIRED';
    if (elements.trainingGrowth) elements.trainingGrowth.textContent = `${training.progress || '0 / 12'} · PENDING_SYNC`;
    if (elements.trainingPrerequisite) elements.trainingPrerequisite.textContent = training.prerequisite_state || 'READY';
    if (elements.cameraWaiting && training.camera_active === true) elements.cameraWaiting.textContent = 'ACTIVE / WAITING';
    if (elements.trainingTaskList && Array.isArray(training.tasks)) elements.trainingTaskList.innerHTML = training.tasks.map((item) => `<li data-state="${escapeHtml(item.state || 'NOT_STARTED')}"><button type="button" data-view-task="${escapeHtml(item.task_id)}"><span>${String(item.order).padStart(2, '0')}</span> ${escapeHtml(item.title)} · ${escapeHtml(item.state)}</button></li>`).join('');
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
    const rag = payload.rag_explanation || session.rag_explanation;
    if (rag && elements.ragExplanation) {
      const explanation = rag.explanation || (rag.status === 'pending' ? '正在查询教学知识…' : '目前知识库说明暂时不可用。');
      elements.ragExplanation.textContent = rag.safety_notice ? `${rag.safety_notice} ${explanation}` : explanation;
      elements.ragSource.textContent = rag.source_type || rag.reference_summary ? 'FDE-AI RAG' : '—';
      elements.ragStatus.textContent = String(rag.status || 'idle').toUpperCase();
      elements.ragLatency.textContent = Number.isFinite(Number(rag.latency_ms)) ? `${Number(rag.latency_ms).toFixed(1)} ms` : '—';
    }
    elements.confirm.disabled = session.state !== 'PASS_CANDIDATE';
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
      trainingTaskList: documentRef.querySelector('#trainingTaskList'), trainingProgress: documentRef.querySelector('#trainingProgress'), trainingTaskNumber: documentRef.querySelector('#trainingTaskNumber'), trainingTitle: documentRef.querySelector('#trainingTitle'), trainingObjective: documentRef.querySelector('#trainingObjective'), trainingAction: documentRef.querySelector('#trainingAction'), trainingWhy: documentRef.querySelector('#trainingWhy'), trainingSafety: documentRef.querySelector('#trainingSafety'), trainingSteps: documentRef.querySelector('#trainingSteps'), trainingStatus: documentRef.querySelector('#trainingStatus'), trainingEvidence: documentRef.querySelector('#trainingEvidence'), trainingReflection: documentRef.querySelector('#trainingReflectionState'), trainingTeacher: documentRef.querySelector('#trainingTeacher'), trainingGrowth: documentRef.querySelector('#trainingGrowth'), trainingPrerequisite: documentRef.querySelector('#trainingPrerequisite'), cameraWaiting: documentRef.querySelector('#cameraWaiting'),
      evidenceFile: documentRef.querySelector('#trainingEvidenceFile'), saveEvidence: documentRef.querySelector('#saveTrainingEvidence'), reflectionOriginal: documentRef.querySelector('#reflectionOriginal'), reflectionAssisted: documentRef.querySelector('#reflectionAssisted'), saveReflection: documentRef.querySelector('#saveTrainingReflection'), startTrainingTask: documentRef.querySelector('#startTrainingTask'), completeTrainingTask: documentRef.querySelector('#completeTrainingTask'), devTeacherControls: documentRef.querySelector('#devTeacherControls'), teacherApprove: documentRef.querySelector('#mockTeacherApprove'), teacherReject: documentRef.querySelector('#mockTeacherReject'),
      startCoach: documentRef.querySelector('#startCoach'), stopCoach: documentRef.querySelector('#stopCoach'), manualMode: documentRef.querySelector('#manualMode'), autoMode: documentRef.querySelector('#autoMode'), autoMetrics: documentRef.querySelector('#autoMetrics')
    };
    let stream = null;
    let sessionId = null;
    let cameras = [];
    let autoScheduler = null;
    let ragPollGeneration = 0;
    let currentTrainingTaskId = 'F450_01';

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
      if (!stream) setCameraState(cameras.length ? (cameras[0].label ? "CAMERA READY" : "CAMERA FOUND") : "NO CAMERA");
      return cameras;
    }

    function setMessage(message) {
      elements.message.textContent = message;
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
      currentTrainingTaskId = state.training?.current_task_id || currentTrainingTaskId;
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
        const mobile = /Android|iPhone|iPad|iPod/i.test(navigatorRef.userAgent || '');
        setCameraState(cameras.some((device) => device.label) ? 'OPENING CAMERA' : 'PERMISSION REQUIRED');
        const opened = await openCameraWithFallback(navigatorRef.mediaDevices, cameraConstraintCandidates(cameras, elements.cameraDevice.value, mobile), () => setCameraState('CAMERA FALLBACK'));
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
        const supported = navigatorRef.mediaDevices.getSupportedConstraints?.() || {};
        elements.cameraResolution.textContent = String(settings.width || elements.video.videoWidth) + ' × ' + String(settings.height || elements.video.videoHeight);
        elements.cameraHint.hidden = true;
        elements.cameraDiagnostics.hidden = false;
        elements.cameraDiagnostics.textContent = 'Device: ' + (stream.getVideoTracks()[0]?.label || elements.cameraDevice.selectedOptions[0]?.textContent || 'unknown') + ' | Supported: ' + Object.keys(supported).filter((key) => supported[key]).join(', ');
        setCameraState('ACTIVE', 'online');
        if (elements.cameraWaiting) elements.cameraWaiting.textContent = 'ACTIVE / WAITING';
        setMessage(opened.fallbackUsed ? '摄像头已启动（Compatibility Fallback），请点击「立即 AI 检测」。' : '摄像头已启动，请点击「立即 AI 检测」。');
      } catch (error) {
        stopStream(stream);
        stream = null;
        elements.video.srcObject = null;
        const mapped = cameraErrorState(error);
        setCameraState(mapped.state);
        elements.cameraDiagnostics.hidden = false;
        elements.cameraDiagnostics.textContent = 'Camera Error: ' + mapped.name + ' | Message: ' + mapped.message + ' | Failed Constraint: ' + (mapped.constraint || 'unknown');
        setMessage(mapped.state === 'PERMISSION REQUIRED' ? '请允许浏览器使用摄像头。' : '摄像头开启失败，请查看诊断信息。');
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
          elements.capture.textContent = busy ? 'AI 检测中…' : '立即 AI 检测';
          if (busy) setMessage('AI 检测中...');
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
      elements.capture.disabled = true;
      elements.stop.disabled = true;
      elements.cameraResolution.textContent = "—";
      elements.cameraHint.hidden = false;
      setCameraState(cameras.length ? 'STOPPED' : 'ERROR', cameras.length ? 'checking' : 'offline');
      if (elements.cameraWaiting) elements.cameraWaiting.textContent = 'STOPPED';
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
    elements.capture.addEventListener('click', capture);
    elements.stop.addEventListener('click', stopCamera);
    elements.upload.addEventListener('click', () => triggerFilePicker(elements.file, devLog));
    elements.file.addEventListener('change', (event) => performUploadInteraction(event.target.files?.[0], useFile, devLog).catch((error) => setMessage(`图片检测失败：${error.message}`)));

    elements.startCoach.addEventListener('click', () => startAutoObservation().catch((error) => setMessage(`自动观察启动失败：${error.message}`)));
    elements.stopCoach.addEventListener('click', stopAutoObservation);
    elements.confirm.addEventListener('click', async () => { const id = sessionId || await ensureSession(); const result = await confirmStep(fetchImpl, id); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`)); renderTaskState(elements, { session: result.session, guidance: result.guidance, task: state }); });
    elements.devPanel.querySelectorAll?.('[data-scenario]').forEach((button) => button.addEventListener('click', async () => { const id = await ensureSession('MOCK_VISION'); const result = await simulateVision(fetchImpl, id, button.dataset.scenario); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}`)); renderTaskState(elements, { ...result, task: state }); if (result.rag_explanation?.status === 'pending') void refreshRagExplanation(id); }));
    elements.startTrainingTask?.addEventListener('click', async () => { const id = await ensureSession(); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/training/tasks/${encodeURIComponent(currentTrainingTaskId)}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); renderTrainingState(elements, state.training); });
    elements.completeTrainingTask?.addEventListener('click', async () => { const id = await ensureSession(); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(id)}/training/tasks/${encodeURIComponent(currentTrainingTaskId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); renderTrainingState(elements, state.training); });
    elements.saveEvidence?.addEventListener('click', async () => { const file = elements.evidenceFile?.files?.[0]; if (!file) { setMessage('请先选择 Evidence 文件。'); return; } const id = await ensureSession(); const result = await saveTrainingEvidence(fetchImpl, id, { task_id: currentTrainingTaskId, evidence_type: file.type.startsWith('video/') ? 'VIDEO' : 'PHOTO', source: 'STUDENT_UPLOAD', file_reference: `dev-upload://${file.name}`, metadata: { name: file.name, size: file.size, type: file.type } }); renderTrainingState(elements, result.training); setMessage('学习证据 Reference 已保存到 v2.0 Dev Storage。'); });
    elements.saveReflection?.addEventListener('click', async () => { try { const id = await ensureSession(); const result = await saveTrainingReflection(fetchImpl, id, { task_id: currentTrainingTaskId, original_text: elements.reflectionOriginal.value, ai_assisted_text: elements.reflectionAssisted.value || null, source_type: 'TEXT' }); renderTrainingState(elements, result.training); setMessage('学生原始学习总结已保存。'); } catch (error) { setMessage(error.message === 'student_original_summary_required' ? '请先填写真实的学生学习总结。' : `学习总结保存失败：${error.message}`); } });
    elements.teacherApprove?.addEventListener('click', async () => { const id = await ensureSession(); const result = await submitTeacherReview(fetchImpl, id, 'APPROVE', 'Development teacher review', currentTrainingTaskId); renderTrainingState(elements, result.training); });
    elements.teacherReject?.addEventListener('click', async () => { const id = await ensureSession(); const result = await submitTeacherReview(fetchImpl, id, 'REJECT_REWORK', 'Development teacher requested rework', currentTrainingTaskId); renderTrainingState(elements, result.training); });
    elements.trainingTaskList?.addEventListener('click', async (event) => { const taskId = event.target.closest?.('[data-view-task]')?.dataset?.viewTask; if (!taskId) return; const id = await ensureSession(); const result = await fetchTrainingTaskView(fetchImpl, id, taskId); renderTrainingState(elements, { ...result.training_task_view, progress: elements.trainingProgress.textContent, evidence_count: elements.trainingEvidence.textContent, reflection_state: elements.trainingReflection.textContent, teacher_review_state: result.training_task_view.task.teacher_review_required ? 'REQUIRED' : 'NOT_REQUIRED' }); setMessage(result.training_task_view.actionable ? '此任务目前可执行。' : `教材可阅读；正式执行仍被前置条件阻挡：${result.training_task_view.missing_prerequisites.join(', ')}`); });

    return { refreshHealth, refreshCameraDevices, startCamera, capture, stopCamera, startAutoObservation, stopAutoObservation };
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
      window.addEventListener('pagehide', () => controller.stopCamera());
    });
  }

  return {
    autoStartError,
    renderTaskState,
    renderTrainingState,
    studentFacingLabel,
    shouldTriggerVision,
    confirmStep,
    simulateVision,
    saveTrainingEvidence,
    saveTrainingReflection,
    submitTeacherReview,
    fetchTrainingTaskView,
    performCaptureInteraction,
    triggerFilePicker,
    performUploadInteraction,
    detectionResultHtml,
    cameraConstraints,
    cameraConstraintCandidates,
    cameraConstraintsForDevices,
    openCameraWithFallback,
    cameraErrorState,
    captureFrame,
    checkHealth,
    createController,
    drawDetectionOverlay,
    scaleBoxForContain,
    stopStream,
    submitSnapshot
  };
});
