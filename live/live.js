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
    elements.confirm.disabled = session.state !== 'PASS_CANDIDATE';
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
      startCoach: documentRef.querySelector('#startCoach'), stopCoach: documentRef.querySelector('#stopCoach'), manualMode: documentRef.querySelector('#manualMode'), autoMode: documentRef.querySelector('#autoMode'), autoMetrics: documentRef.querySelector('#autoMetrics')
    };
    let stream = null;
    let sessionId = null;
    let cameras = [];
    let autoScheduler = null;

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

    async function ensureSession() {
      if (sessionId) return sessionId;
      const response = await fetchImpl('/api/live/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'demo' })
      });
      if (!response.ok) throw new Error('session_create_failed');
      const created = await response.json();
      sessionId = created.session_id;
      elements.devPanel.hidden = !created.dev_mode;
      const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`));
      renderTaskState(elements, state);
      return sessionId;
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
        await ensureSession();
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
      if (sessionId) {
        const oldSession = sessionId;
        sessionId = null;
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
      autoScheduler.start();
      elements.autoMode.checked = true;
      elements.startCoach.disabled = true;
      elements.stopCoach.disabled = false;
      setMessage('AI 自动观察已启动（1 FPS）。');
      return true;
    }

    function stopAutoObservation() {
      autoScheduler?.stop();
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
    elements.confirm.addEventListener('click', async () => { const result = await confirmStep(fetchImpl, await ensureSession()); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`)); renderTaskState(elements, { session: result.session, guidance: result.guidance, task: state }); });
    elements.devPanel.querySelectorAll?.('[data-scenario]').forEach((button) => button.addEventListener('click', async () => { const result = await simulateVision(fetchImpl, await ensureSession(), button.dataset.scenario); const state = await parseJsonResponse(await fetchImpl(`/api/live/sessions/${encodeURIComponent(sessionId)}`)); renderTaskState(elements, { ...result, task: state }); }));

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
    confirmStep,
    simulateVision,
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
