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

  function cameraConstraintsForDevices(devices = [], selectedDeviceId = '', preferEnvironment = false) {
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    if (selectedDeviceId) return { video: { deviceId: { exact: selectedDeviceId } }, audio: false };
    if (cameras.length === 1) return { video: { deviceId: { exact: cameras[0].deviceId } }, audio: false };
    if (preferEnvironment) return cameraConstraints();
    return { video: true, audio: false };
  }

  function cameraErrorState(error = {}) {
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return { state: 'NO CAMERA', message: '找不到可用摄像头。' };
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return { state: 'PERMISSION REQUIRED', message: '请允许浏览器使用摄像头。' };
    return { state: 'CAMERA ERROR', message: '摄像头错误：' + (error.message || error.name || 'unknown') };
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
      throw new Error(body?.error?.code || 'snapshot_failed');
    }
    return {
      payload: body,
      uploadMs,
      responseBytes: new TextEncoder().encode(text).byteLength
    };
  }

  function createController({ documentRef = document, navigatorRef = navigator, fetchImpl = fetch } = {}) {
    const elements = {
      health: documentRef.querySelector('#backendStatus'),
      vision: documentRef.querySelector('#visionStatus'),
      cameraStatus: documentRef.querySelector('#cameraStatus'),
      cameraDevice: documentRef.querySelector('#cameraDevice'),
      cameraResolution: documentRef.querySelector('#cameraResolution'),
      cameraHint: documentRef.querySelector('#cameraHint'),
      video: documentRef.querySelector('#cameraPreview'),
      captureCanvas: documentRef.querySelector('#captureCanvas'),
      overlay: documentRef.querySelector('#detectionOverlay'),
      start: documentRef.querySelector('#startCamera'),
      capture: documentRef.querySelector('#captureFrame'),
      stop: documentRef.querySelector('#stopCamera'),
      file: documentRef.querySelector('#imageFile'),
      results: documentRef.querySelector('#detectionResults'),
      metrics: documentRef.querySelector('#timingMetrics'),
      message: documentRef.querySelector('#liveMessage')
    };
    let stream = null;
    let sessionId = null;
    let cameras = [];

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
      sessionId = (await response.json()).session_id;
      return sessionId;
    }

    async function startCamera() {
      if (!navigatorRef.mediaDevices?.getUserMedia) {
        setMessage('此瀏覽器不支援攝影機；仍可選擇一張圖片測試。');
        return;
      }
      try {
        await refreshCameraDevices();
        setCameraState("PERMISSION REQUIRED");
        const mobile = /Android|iPhone|iPad|iPod/i.test(navigatorRef.userAgent || "");
        stream = await navigatorRef.mediaDevices.getUserMedia(cameraConstraintsForDevices(cameras, elements.cameraDevice.value, mobile));
        elements.video.srcObject = stream;
        await elements.video.play();
        await refreshCameraDevices();
        await ensureSession();
        elements.start.disabled = true;
        elements.stop.disabled = false;
        elements.capture.disabled = false;
        const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
        elements.cameraResolution.textContent = String(settings.width || elements.video.videoWidth) + " × " + String(settings.height || elements.video.videoHeight);
        elements.cameraHint.hidden = true;
        setCameraState('CAMERA ACTIVE', 'online');
        setMessage('攝影機已開啟；按「擷取一張並辨識」。');
      } catch (error) {
        stopStream(stream);
        stream = null;
        const mapped = cameraErrorState(error);
        setCameraState(mapped.state);
        setMessage(mapped.message);
      }
    }

    async function sendImage(imageData, captureMs, sourceWidth, sourceHeight, encodeMs = 0) {
      const id = await ensureSession();
      const frameId = `frame-${Date.now()}`;
      setMessage('正在傳送單張影像…');
      const totalStarted = performance.now();
      const result = await submitSnapshot(fetchImpl, id, {
        frame_id: frameId,
        file_name: `${frameId}.jpg`,
        image_data: imageData
      });
      const totalMs = Number((performance.now() - totalStarted + captureMs).toFixed(1));
      drawDetectionOverlay(elements.overlay, result.payload.detections, sourceWidth, sourceHeight);
      elements.results.innerHTML = result.payload.detections.length
        ? result.payload.detections.map((item) =>
            `<li><strong>${escapeHtml(item.class)}</strong><span>${(item.confidence * 100).toFixed(1)}%</span><code>[${item.box.join(', ')}]</code></li>`
          ).join('')
        : '<li>本張影像沒有偵測結果。</li>';
      elements.metrics.textContent = [
        `Resolution ${sourceWidth}×${sourceHeight}`,
        `Snapshot ${Math.round((imageData.length - imageData.indexOf(",") - 1) * 0.75)} bytes`,
        `Capture ${captureMs.toFixed(1)} ms`,
        `Encode ${encodeMs.toFixed(1)} ms`,
        `Upload/response ${result.uploadMs.toFixed(1)} ms`,
        `Inference ${Number(result.payload.metrics.model_inference_ms || 0).toFixed(1)} ms`,
        `Vision upstream ${result.payload.metrics.vision_upstream_ms.toFixed(1)} ms`,
        `Total ${totalMs.toFixed(1)} ms`,
        `Response ${result.responseBytes} bytes`
      ].join(' · ');
      setMessage('單張辨識完成。');
    }

    async function capture() {
      try {
        const captured = captureFrame(elements.video, elements.captureCanvas);
        await sendImage(captured.imageData, captured.captureMs, captured.width, captured.height, captured.encodeMs);
      } catch (error) {
        setMessage(`辨識失敗：${error.message}`);
      }
    }

    async function useFile(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const image = await createImageBitmap(file);
      elements.captureCanvas.width = image.width;
      elements.captureCanvas.height = image.height;
      elements.captureCanvas.getContext('2d').drawImage(image, 0, 0);
      const imageData = elements.captureCanvas.toDataURL('image/jpeg', 0.82);
      await sendImage(imageData, 0, image.width, image.height);
      image.close();
    }

    async function stopCamera() {
      stopStream(stream);
      stream = null;
      elements.video.srcObject = null;
      elements.start.disabled = false;
      elements.capture.disabled = true;
      elements.stop.disabled = true;
      elements.cameraResolution.textContent = "—";
      elements.cameraHint.hidden = false;
      setCameraState(cameras.length ? "CAMERA READY" : "NO CAMERA");
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

    elements.start.addEventListener('click', startCamera);
    elements.capture.addEventListener('click', capture);
    elements.stop.addEventListener('click', stopCamera);
    elements.file.addEventListener('change', (event) => useFile(event.target.files?.[0]).catch((error) => setMessage(`圖片辨識失敗：${error.message}`)));

    return { refreshHealth, refreshCameraDevices, startCamera, capture, stopCamera };
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
    cameraConstraints,
    cameraConstraintsForDevices,
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
