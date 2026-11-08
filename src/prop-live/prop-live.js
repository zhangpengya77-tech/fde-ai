/**
 * 即時鏡頭檢測（鷹眼 AI 檢測中心 → F450 槳葉檢查 →「即時鏡頭」分頁）。
 *
 * 流程：取得教師已啟用的模型（/api/v1/vision/prop-live/model）→ 核對類別與 SHA-256 →
 *       交給 Web Worker（onnxruntime-web，WebGPU 優先、WASM 後備）→ 鏡頭畫面逐幀推論 →
 *       共用判定模組 judgePropellers 判斷 → 畫面疊綠／紅／灰框，答案面板顯示文字。
 * 原則：畫面不上傳伺服器；Worker 忙碌時跳過新畫面（不排隊）；模型或規則任一不符就停止，不猜。
 * 依賴：window.FdePropJudge、window.FdePropLiveConfig、window.FdeVisionClient（visionApiBase）。
 */
(function attachPropLive(root) {
  const ORT_BASE = new URL('./src/vendor/onnxruntime-web-1.20.1/', document.baseURI).href;
  const WORKER_URL = new URL('./src/prop-live/prop-live-worker.js?v=4', document.baseURI).href;
  const COLORS = { green: '#2ec27e', red: '#e01b24', gray: '#9a9996' };

  function fill(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => (params[key] !== undefined ? params[key] : ''));
  }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function createController(rootEl, options) {
    const opts = options || {};
    const el = (name) => rootEl.querySelector(`[data-live="${name}"]`);
    const video = el('video');
    const canvas = el('overlay');
    const ctx = canvas.getContext('2d');
    const state = {
      config: null, judge: null, worker: null, ready: false, busy: false, stream: null,
      running: false, frameId: 0, devices: [], deviceIndex: -1, fps: 0, lastResultAt: 0,
      lastText: '', imgsz: 640, backend: '', modelInfo: null, lastJudgement: null, onJudgement: opts.onJudgement || null,
    };

    function ui(key, params) {
      const messages = state.config && state.config.messages;
      const text = messages && messages.ui && messages.ui[key];
      return text ? fill(text, params || {}) : key;
    }

    function showError(key, params) {
      const box = el('error');
      box.textContent = ui(key, params);
      box.hidden = false;
      setStatus('');
    }

    function clearError() {
      el('error').hidden = true;
    }

    function setStatus(text) {
      el('status').textContent = text;
    }

    function setRunning(running) {
      state.running = running;
      el('start').disabled = running;
      el('stop').disabled = !running;
      el('switch').disabled = !running || state.devices.length < 2;
      rootEl.dataset.liveRunning = running ? '1' : '0';
    }

    /** 把 i18n 文字填進介面（data-live-text="key"）。 */
    function applyTexts() {
      rootEl.querySelectorAll('[data-live-text]').forEach((node) => {
        node.textContent = ui(node.dataset.liveText);
      });
      rootEl.querySelectorAll('[data-live-qa-text]').forEach((node) => {
        node.textContent = state.config.messages.qa[node.dataset.liveQaText] || '';
      });
      const input = el('question');
      if (input) input.placeholder = ui('askPlaceholder');
    }

    async function ensureConfig() {
      if (state.config) return;
      const { rules, messages } = await root.FdePropLiveConfig.loadPropLiveConfig();
      state.config = { rules, messages };
      state.judge = root.FdePropJudge;
      // 穩定化（8 幀取 5、晃動、修正完成）與問答（不問不答、只有錯才查知識庫一次）
      state.stabilizer = root.FdePropStabilizer.createStabilizer(rules);
      let askRag = null;
      if (root.FdeRagClient) {
        const rag = root.FdeRagClient.createRagClient(root.FdeRagConfig || {});
        askRag = (question) => rag.askRag(question);
      }
      state.asker = root.FdePropQa.createAsker({ askRag: opts.askRag || askRag, messages, rules });
      applyTexts();
    }

    function apiBase() {
      const client = root.FdeVisionClient;
      return client ? client.visionApiBase(root.FdeRagConfig || {}, root.location) : null;
    }

    /** 取得教師已啟用的模型並核對；回傳 ArrayBuffer。任何不符直接丟出對應的提示代碼。 */
    async function fetchModel() {
      const base = apiBase();
      if (!base) throw new Error('noModel');
      const fetchImpl = opts.fetchImpl || root.fetch.bind(root);
      let metaResponse;
      try {
        metaResponse = await fetchImpl(`${base}/api/v1/vision/prop-live/model`, { credentials: 'include' });
      } catch {
        throw new Error('noModel');
      }
      let meta = null;
      try { meta = await metaResponse.json(); } catch { meta = null; }
      if (!metaResponse.ok) {
        const code = meta && meta.error && meta.error.code;
        if (metaResponse.status === 401 || metaResponse.status === 403) throw new Error('needLogin');
        if (code === 'no_active_model') throw new Error('modelNotEnabled');
        if (code === 'model_class_names_mismatch') throw new Error('modelRejected');
        if (code === 'live_model_source_mismatch' || code === 'live_model_hash_mismatch') throw new Error('modelHashMismatch');
        throw new Error('noModel');
      }
      const expected = state.config.rules.classes;
      if (JSON.stringify(meta.class_names) !== JSON.stringify(expected)) throw new Error('modelRejected');
      const fileResponse = await fetchImpl(`${base}${meta.onnx_url.replace(/^\/+/, '/')}`, { credentials: 'include' });
      if (!fileResponse.ok) throw new Error(fileResponse.status === 403 ? 'needLogin' : 'noModel');
      const bytes = await fileResponse.arrayBuffer();
      if ((await sha256Hex(bytes)) !== String(meta.onnx_sha256).toLowerCase()) throw new Error('modelHashMismatch');
      state.modelInfo = meta;
      return bytes;
    }

    function startWorker(bytes, forceWasm) {
      return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_URL);
        state.worker = worker;
        worker.onmessage = (event) => {
          const message = event.data || {};
          if (message.type === 'ready') {
            state.ready = true;
            state.backend = message.backend;
            el('backend').textContent = ui('backend', { backend: message.backend === 'webgpu' ? 'WebGPU' : 'WASM' });
            resolve();
          } else if (message.type === 'result') {
            state.frameErrors = 0;
            onResult(message);
          } else if (message.type === 'error') {
            if (!state.ready) reject(new Error('modelLoadFailed'));
            else onFrameError(message.message || message.code || 'inference_failed');
          }
        };
        worker.onerror = (event) => {
          if (!state.ready) reject(new Error('modelLoadFailed'));
          else onFrameError((event && event.message) || 'worker_error');
        };
        // 測試／疑難排解用：網址加 ?liveBackend=wasm，或 localStorage「fde-live-backend」設為 wasm，可強制改用 WASM（預設 WebGPU 優先）
        let forced = '';
        try { forced = root.localStorage.getItem('fde-live-backend') || ''; } catch { forced = ''; }
        const preferWebGPU = !forceWasm && !(/[?&]liveBackend=wasm\b/.test(root.location.search) || forced === 'wasm');
        // 保留一份模型位元組：WebGPU 在某些手機（例如 iPhone）推論失敗時，要用同一份模型改以 WASM 重新載入
        if (!state.modelBytes) state.modelBytes = bytes.slice(0);
        // 測試專用：localStorage「fde-live-test-fail-webgpu」=1 時，Worker 在 WebGPU 推論時故意失敗（驗證自動改用 WASM）
        let testFailWebgpu = false;
        try { testFailWebgpu = root.localStorage.getItem('fde-live-test-fail-webgpu') === '1'; } catch { testFailWebgpu = false; }
        worker.postMessage({ type: 'init', ortBase: ORT_BASE, modelBytes: bytes, classNames: state.config.rules.classes, preferWebGPU, testFailWebgpu }, [bytes]);
      });
    }

    /**
     * 2026-11-08（iPhone 實測回報）：推論失敗不能默默略過，否則畫面會永遠停在「還在判斷中」。
     * 連續失敗 3 次：WebGPU → 自動改用 WASM 重新載入模型；已是 WASM 仍失敗 → 停止並顯示原因。
     */
    async function onFrameError(detail) {
      state.busy = false;
      state.lastFrameError = String(detail).slice(0, 120);
      state.frameErrors = (state.frameErrors || 0) + 1;
      if (state.frameErrors < 3 || state.recovering) return;
      if (state.backend === 'webgpu' && state.modelBytes) {
        await fallbackToWasm();
        return;
      }
      showError('inferenceFailed', { detail: state.lastFrameError });
      stop();
    }

    async function fallbackToWasm() {
      state.recovering = true;
      setStatus(ui('fallbackWasm'));
      try { state.worker.terminate(); } catch { /* 略過 */ }
      state.ready = false;
      state.busy = false;
      state.frameErrors = 0;
      try {
        await startWorker(state.modelBytes.slice(0), true);
        state.resultsAtCheck = state.results || 0;
        state.checkAt = performance.now();
        if (state.running) setStatus(ui('hint'));
      } catch {
        showError('inferenceFailed', { detail: state.lastFrameError || 'wasm_init_failed' });
        stop();
      } finally {
        state.recovering = false;
      }
    }

    /** 取得目前畫面：優先 createImageBitmap(video)；不支援的瀏覽器改用畫布擷取。 */
    async function grabFrame() {
      if (!state.useCanvasGrab) {
        try {
          return await createImageBitmap(video);
        } catch {
          state.useCanvasGrab = true;
        }
      }
      const grab = state.grabCanvas || (state.grabCanvas = document.createElement('canvas'));
      grab.width = video.videoWidth;
      grab.height = video.videoHeight;
      grab.getContext('2d').drawImage(video, 0, 0, grab.width, grab.height);
      return createImageBitmap(grab);
    }

    /** 無回應偵測：開始後 15 秒還沒有任何辨識結果 → 先改用 WASM，仍沒有就停止並說明原因。 */
    function watchdog() {
      if (!state.running) return;
      if (state.ready && !state.recovering && (state.results || 0) === (state.resultsAtCheck || 0)
        && performance.now() - (state.checkAt || 0) > 15000) {
        if (state.backend === 'webgpu' && state.modelBytes) {
          fallbackToWasm();
        } else {
          showError('inferenceStalled', { detail: state.lastFrameError || '' });
          stop();
          return;
        }
      }
      if ((state.results || 0) !== (state.resultsAtCheck || 0)) {
        state.resultsAtCheck = state.results;
        state.checkAt = performance.now();
      }
      setTimeout(watchdog, 2000);
    }

    async function listCameras() {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        state.devices = all.filter((d) => d.kind === 'videoinput');
      } catch {
        state.devices = [];
      }
      const select = el('camera');
      select.innerHTML = '';
      state.devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = device.label || `${ui('cameraLabel')} ${index + 1}`;
        select.appendChild(option);
      });
      if (state.deviceIndex >= 0) select.value = String(state.deviceIndex);
    }

    async function openCamera() {
      if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
      // 換鏡頭或切省電模式：畫面不同，重新累積穩定判定
      if (state.stabilizer) state.stabilizer.reset();
      // 推論尺寸由設定檔決定（固定 640）；省電模式只降低擷取解析度與每秒推論次數，不降低推論尺寸
      const live = state.config.rules.live;
      const powerSave = el('lowres').checked;
      state.imgsz = live.imgsz;
      state.minIntervalMs = 1000 / (powerSave ? live.powerSaveMaxFps : live.maxFps);
      const capture = powerSave ? live.powerSaveCapture : live.capture;
      const device = state.devices[state.deviceIndex];
      const video_ = { width: { ideal: capture.width }, height: { ideal: capture.height } };
      // 手機預設後置鏡頭（environment）；使用者選過鏡頭後改用指定的 deviceId
      if (device && device.deviceId) video_.deviceId = { exact: device.deviceId };
      else video_.facingMode = { ideal: opts.facingMode || live.defaultFacingMode };
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
      } catch (error) {
        // 2026-11-08（iPhone 實測）：指定鏡頭（例如「後置三鏡頭」）打不開時，退回預設後置鏡頭，不整個停止
        if (!video_.deviceId) throw error;
        delete video_.deviceId;
        video_.facingMode = { ideal: live.defaultFacingMode };
        state.deviceIndex = -1;
        state.stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
        setStatus(ui('cameraFallback'));
      }
      video.srcObject = state.stream;
      await video.play();
      // 舞台比例跟著實際畫面（手機直拿時是直式），框才不會被壓扁或留大片黑邊
      if (video.videoWidth && video.videoHeight) {
        el('stage').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }
      const track = state.stream.getVideoTracks()[0];
      const settings = track && track.getSettings ? track.getSettings() : {};
      if (settings.deviceId) {
        const index = state.devices.findIndex((d) => d.deviceId === settings.deviceId);
        if (index >= 0) state.deviceIndex = index;
      }
    }

    async function start() {
      clearError();
      try {
        await ensureConfig();
      } catch {
        showError('noModel');
        return;
      }
      if (!root.isSecureContext) { showError('needHttps'); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showError('noCamera'); return; }
      try {
        if (!state.ready) {
          setStatus(ui('loadingModel'));
          const bytes = await fetchModel();
          await startWorker(bytes);
        }
        setStatus(ui('startingCamera'));
        await openCamera();
        await listCameras();
      } catch (error) {
        const key = String(error && error.message || '');
        if (error && (error.name === 'NotAllowedError' || error.name === 'NotFoundError' || error.name === 'OverconstrainedError' || error.name === 'NotReadableError')) showError('noCamera');
        else showError(['needLogin', 'modelNotEnabled', 'modelRejected', 'modelHashMismatch', 'noModel', 'modelLoadFailed'].includes(key) ? key : 'noCamera');
        stop();
        return;
      }
      setStatus(ui('hint'));
      setRunning(true);
      state.stabilizer.reset();
      state.lastText = '';
      render({ stable: null, fixed: false });
      state.lastResultAt = performance.now();
      state.resultsAtCheck = state.results || 0;
      state.checkAt = performance.now();
      loop();
      setTimeout(watchdog, 2000);
    }

    function stop() {
      if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
      video.srcObject = null;
      state.busy = false;
      setRunning(false);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (state.stabilizer) state.stabilizer.reset();
      stopSpeaking();
      // 停止後答案面板清空，不再停在「還在判斷中」
      if (state.config) {
        state.lastText = '';
        el('answer').dataset.tone = 'gray';
        el('headline').textContent = '';
        el('lines').innerHTML = '';
      }
    }

    async function switchCamera() {
      if (state.devices.length < 2) return;
      state.deviceIndex = (state.deviceIndex + 1) % state.devices.length;
      el('camera').value = String(state.deviceIndex);
      try {
        await openCamera();
      } catch {
        showError('noCamera');
        stop();
      }
    }

    /** 主迴圈：Worker 空閒才送下一張畫面（忙碌時自動跳幀，不堆積）。 */
    function loop() {
      if (!state.running) return;
      const now = performance.now();
      const due = now - (state.lastSentAt || 0) >= (state.minIntervalMs || 0);
      if (state.ready && !state.busy && due && video.readyState >= 2 && video.videoWidth) {
        state.busy = true;
        state.lastSentAt = now;
        state.frameId += 1;
        grabFrame().then((bitmap) => {
          state.worker.postMessage({
            type: 'frame', id: state.frameId, bitmap, imgsz: state.imgsz,
            candidateConfidence: state.config.rules.candidateConfidence,
          }, [bitmap]);
        }).catch((error) => onFrameError(`grab_failed: ${error && error.message}`));
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop);
      else requestAnimationFrame(loop);
    }

    function onResult(message) {
      state.busy = false;
      if (!state.running) return;
      const now = performance.now();
      const instant = 1000 / Math.max(1, now - state.lastResultAt);
      state.lastResultAt = now;
      state.fps = state.fps ? state.fps * 0.8 + instant * 0.2 : instant;
      // 診斷用：Worker 內單次推論耗時（含前後處理）的移動平均與總結果數，供實測 FPS 紀錄
      state.inferMs = state.inferMs ? state.inferMs * 0.8 + message.inferMs * 0.2 : message.inferMs;
      state.results = (state.results || 0) + 1;
      el('fps').textContent = ui('fps', { fps: state.fps.toFixed(1), frames: state.results });
      const judgement = state.judge.judgePropellers(message.detections, state.config.rules);
      state.lastJudgement = judgement;
      // 穩定化：8 幀取 5、晃動判斷、修正完成
      const stableInfo = state.stabilizer.push(judgement, { width: message.width, height: message.height });
      state.stableInfo = stableInfo;
      // 框的顏色：只有本幀與穩定結果一致時才上色，否則一律灰色（綠色必須有穩定結果支持）
      const agree = stableInfo.stable && stableInfo.signature !== 'UNCERTAIN' && stableInfo.frameSignature === stableInfo.signature;
      const shown = agree ? judgement : { ...judgement, boxes: judgement.boxes.map((b) => ({ ...b, color: 'gray' })) };
      draw(shown, message.width, message.height);
      render(stableInfo);
      if (state.onJudgement) state.onJudgement(judgement, message, stableInfo);
    }

    /** 疊框：依影片實際顯示大小縮放（object-fit: contain）。 */
    function draw(judgement, srcW, srcH) {
      const rect = video.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const scale = Math.min(rect.width / srcW, rect.height / srcH);
      const offX = (rect.width - srcW * scale) / 2;
      const offY = (rect.height - srcH * scale) / 2;
      ctx.lineWidth = 3;
      ctx.font = '600 14px system-ui, sans-serif';
      for (const box of judgement.boxes) {
        const [x1, y1, x2, y2] = box.bbox;
        const color = COLORS[box.color] || COLORS.gray;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.strokeRect(offX + x1 * scale, offY + y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);
        ctx.fillText(`${box.class} ${Math.round(box.confidence * 100)}%`, offX + x1 * scale + 2, Math.max(14, offY + y1 * scale - 4));
      }
    }

    /** 答案面板（顯示穩定後的結果，不出聲）：文字有變才更新（避免螢幕閱讀器一直重念）。 */
    function render(stableInfo) {
      const text = stableInfo && stableInfo.stable
        ? state.judge.formatJudgement(stableInfo.stable, state.config.messages, { fixed: stableInfo.fixed })
        : { tone: 'gray', headline: state.config.messages.qa.judging, lines: [] };
      const signature = `${text.tone}|${text.headline}|${text.lines.join('|')}`;
      if (signature === state.lastText) return;
      state.lastText = signature;
      const answer = el('answer');
      answer.dataset.tone = text.tone;
      el('headline').textContent = text.headline;
      const list = el('lines');
      list.innerHTML = '';
      for (const line of text.lines) {
        const item = document.createElement('li');
        item.textContent = line;
        list.appendChild(item);
      }
    }

    // ---- 問答：學員不發問時不講話；發問時依穩定結果回答對錯與正確答案，必要時附知識庫補充並朗讀 ----
    function stopSpeaking() {
      try { if (root.speechSynthesis) root.speechSynthesis.cancel(); } catch { /* 不支援時略過 */ }
    }

    function speak(text) {
      if (!root.speechSynthesis || !text) return;
      stopSpeaking();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = state.config.messages.qa.speechLang;
      utterance.rate = 0.95;
      root.speechSynthesis.speak(utterance);
    }

    function showReply(ruleText, ragText) {
      const box = el('reply');
      box.hidden = false;
      el('replyRule').textContent = ruleText;
      const rag = el('replyRag');
      rag.hidden = !ragText;
      rag.textContent = ragText ? `${state.config.messages.qa.ragLabel}：${ragText}` : '';
    }

    async function askQuestion(questionText) {
      try { await ensureConfig(); } catch { return; }
      const qa = state.config.messages.qa;
      // iOS Safari 需在點擊當下解鎖語音
      try { if (root.speechSynthesis) root.speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(' '), { volume: 0 })); } catch { /* 略過 */ }
      const question = String(questionText || el('question').value || '').trim();
      if (!state.running) {
        showReply(qa.notRunning, null);
        speak(qa.notRunning);
        return;
      }
      // 以發問當下的穩定結果回答（之後畫面再變也不影響這次的答案）
      const info = state.stabilizer.current();
      // 規則答案立即顯示，知識庫補充（只有錯誤時）回來後再補上
      showReply(root.FdePropQa.buildRuleAnswer(info, state.config.messages, state.config.rules).text, null);
      el('ask').disabled = true;
      try {
        const reply = await state.asker.ask(question, info);
        showReply(reply.ruleText, reply.ragText);
        speak(reply.speech);
      } finally {
        el('ask').disabled = false;
      }
    }

    function listen() {
      const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
      const qa = state.config && state.config.messages.qa;
      if (!Recognition) {
        if (qa) showReply(qa.micUnsupported, null);
        return;
      }
      const recognition = new Recognition();
      recognition.lang = qa ? qa.speechLang : 'zh-TW';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      if (qa) setStatus(qa.listening);
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        el('question').value = text;
        askQuestion(text);
      };
      recognition.onend = () => setStatus(state.running ? ui('hint') : '');
      recognition.start();
    }

    el('ask').addEventListener('click', () => askQuestion());
    el('question').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); askQuestion(); }
    });
    el('mic').addEventListener('click', listen);
    el('stopSpeak').addEventListener('click', stopSpeaking);

    el('start').addEventListener('click', start);
    el('stop').addEventListener('click', stop);
    el('switch').addEventListener('click', switchCamera);
    el('camera').addEventListener('change', async (event) => {
      state.deviceIndex = Number(event.target.value);
      if (state.running) {
        try { await openCamera(); } catch { showError('noCamera'); stop(); }
      }
    });
    el('lowres').addEventListener('change', async () => {
      if (state.running) {
        try { await openCamera(); } catch { showError('noCamera'); stop(); }
      }
    });
    // 切到背景或鎖螢幕時關閉鏡頭（省電、避免鏡頭一直開著），回來後請學員再按開始
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.running) {
        stop();
        setStatus(ui('pausedHidden'));
      }
    });
    setRunning(false);
    ensureConfig().catch(() => {});

    return { start, stop, switchCamera, state };
  }

  /** 圖片上傳／即時鏡頭分頁切換；切走時自動關閉鏡頭。 */
  function initTabs(panel, controller) {
    const tabs = panel.querySelectorAll('[data-prop-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.propTab;
        tabs.forEach((t) => t.setAttribute('aria-selected', t === tab ? 'true' : 'false'));
        panel.querySelectorAll('[data-prop-pane]').forEach((pane) => {
          pane.hidden = pane.dataset.propPane !== target;
        });
        if (target !== 'live' && controller) controller.stop();
      });
    });
  }

  function boot() {
    const panel = document.querySelector('[data-prop-panel]');
    const liveRoot = document.querySelector('[data-live-root]');
    if (!panel || !liveRoot) return;
    const controller = createController(liveRoot);
    initTabs(panel, controller);
    root.FdePropLive.controller = controller;
  }

  root.FdePropLive = { createController, initTabs, boot, controller: null };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(globalThis);
