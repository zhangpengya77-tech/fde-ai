(function attachFdeRagClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.FdeRagClient = api;
  }
})(globalThis, function createFdeRagClient() {
  const sourceLabels = {
    rag: 'F450 知识库',
    rag_plus_llm: 'F450 知识库 + AI 补充',
    common_knowledge: 'AI 常识补充',
    refuse: 'F450 AI 助教'
  };

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

  function apiCandidates(config, pageLocation) {
    const local = normalizeBase(config.RAG_API_BASE_URL, 'local', pageLocation);
    const publicApi = normalizeBase(config.PUBLIC_RAG_API_URL, 'public', pageLocation);
    // 手機（非 loopback）直開時 PUBLIC_RAG_API_URL 為空會導致完全沒有候選端點，
    // 因此與 vision-client 一致，加入「同源」後備（由 8111 代理至 RAG）。
    const sameOrigin = normalizeBase(pageLocation?.origin, 'local', pageLocation);
    const mode = config.RAG_API_MODE || 'auto';
    const localPage = pageLocation && isLoopback(pageLocation.hostname);
    const endpoints = mode === 'local'
      ? [local]
      : mode === 'public'
        ? [publicApi]
        : localPage
          ? [local, publicApi]
          : [publicApi, sameOrigin];
    const seen = new Set();

    return endpoints.filter(Boolean).filter(({ base }) => {
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    }).map(({ base }) => `${base}/api/rag/ask`);
  }

  function apiUnavailableError() {
    const error = new Error('AI 助教知識庫暫時無法連接，請稍後再試。');
    error.code = 'RAG_API_UNAVAILABLE';
    return error;
  }

  async function postQuestion(fetchImpl, endpoint, question, timeoutMs) {
    const controller = new AbortController();
    let timeoutId;
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error('RAG request timeout'));
      }, timeoutMs);
    });

    try {
      const response = await Promise.race([
        fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify({ question }),
          signal: controller.signal
        }),
        timeout
      ]);

      if (!response?.ok) throw new Error('RAG API returned an unsuccessful status');
      const payload = await response.json();
      if (!payload || typeof payload.answer !== 'string' || !payload.answer.trim()) {
        throw new Error('RAG API returned an empty answer');
      }
      if (!Object.hasOwn(sourceLabels, payload.source_type)) {
        throw new Error('RAG API returned an unsupported source type');
      }

      return {
        answer: payload.answer.trim(),
        source_type: payload.source_type,
        version: typeof payload.version === 'string' ? payload.version : ''
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function createRagClient(config = {}, fetchImpl = globalThis.fetch, pageLocation = globalThis.location) {
    const timeoutMs = Number.isFinite(Number(config.RAG_API_TIMEOUT_MS))
      ? Math.max(1, Number(config.RAG_API_TIMEOUT_MS))
      : 20000;

    return {
      async askRag(question) {
        const text = String(question || '').trim();
        if (!text) throw apiUnavailableError();
        if (typeof fetchImpl !== 'function') throw apiUnavailableError();

        for (const endpoint of apiCandidates(config, pageLocation)) {
          try {
            return await postQuestion(fetchImpl, endpoint, text, timeoutMs);
          } catch {
            // Try the next configured endpoint; never expose transport details to students.
          }
        }
        throw apiUnavailableError();
      }
    };
  }

  function inspectionQuestion(context = {}) {
    const status = String(context.status || 'CHECK').toUpperCase() === 'NG' ? 'NG' : 'CHECK';
    const errors = Array.isArray(context.errors) ? context.errors : [];
    const details = errors.map((item) => {
      const motor = String(item.motor || '位置未確認');
      const result = String(item.status || status).toUpperCase();
      const detected = item.detected == null || item.detected === '' ? '' : `檢測 ${String(item.detected)}`;
      const expected = item.expected == null || item.expected === '' ? '' : `標準 ${String(item.expected)}`;
      const face = item.blade_face == null || item.blade_face === '' ? '' : `正反面 ${String(item.blade_face)}`;
      return [motor, result, detected, expected, face].filter(Boolean).join(' ');
    });
    const summary = details.length ? details.join('；') : 'M1-M4 關鍵檢測資料不足，實際方向未確認';
    return `F450 槳葉方向 CW CCW 安裝檢查（${status}）：${summary}。請優先依 F450 知識庫提供 1-2 句修正建議；資料不足時不要推測具體電機方向或安裝參數。`;
  }

  /**
   * 2026-11-18 使用者要求：「無法判斷」時也查知識庫，但只問「看不清楚的原因」與「怎麼重拍」，
   * 明確要求不得判斷槳葉裝對或裝錯（PASS／NG／CHECK 仍只由判定規則決定）。
   */
  function uncertainQuestion(context = {}) {
    const reason = String(context.reasonText || '').trim() || '畫面資訊不足';
    const found = Number.isFinite(Number(context.detectedCount)) ? `，目前畫面辨識到 ${Number(context.detectedCount)} 支槳` : '';
    return `F450 槳葉方向檢查照片無法判斷（原因：${reason}${found}）。`
      + '請依 F450 知識庫用 2-3 句說明：1. 可能看不清楚的原因；2. 如何重新拍攝（手機位置、角度、背景、光線、機頭方向、四支槳完整入鏡）。'
      + '不要判斷任何槳葉裝對或裝錯，也不要推測各電機的實際旋向。';
  }

  /**
   * 2026-11-19：知識庫目前沒有「怎麼拍照」的條目，問「無法判斷」時常回傳 M1～M4 安裝位置的固定說明，
   * 對看不清楚的照片沒有幫助，也容易被誤會成在判斷對錯 → 這類回答一律不顯示。
   */
  function isDirectionAnswer(text) {
    const value = String(text || '');
    return /M[1-4]/.test(value) && /(CW|CCW|正槳|反槳)/i.test(value);
  }

  function inspectionSummary(context = {}) {
    const errors = Array.isArray(context.errors) ? context.errors : [];
    return errors.map((item) => {
      const motor = String(item.motor || '位置未確認');
      const status = String(item.status || context.status || 'CHECK').toUpperCase();
      const detected = item.detected == null || item.detected === '' ? '' : String(item.detected);
      const expected = item.expected == null || item.expected === '' ? '' : String(item.expected);
      const detection = status === 'NG' && detected ? `檢測 ${detected}` : '檢測方向未能確認';
      const standard = expected ? `標準 ${expected}` : '標準方向待確認';
      return `${motor} ${detection}，${standard}`;
    }).join('；');
  }

  function createF450AssistantService(ragClient) {
    if (!ragClient || typeof ragClient.askRag !== 'function') {
      throw new TypeError('A unified F450 RAG client is required');
    }

    return {
      askF450Assistant(question, context, source = 'student_chat') {
        // 無法判斷：只取拍攝與原因說明，不帶入任何對錯推測
        if (source === 'eagle_uncertain') {
          return ragClient.askRag(uncertainQuestion(context)).then((result) => (
            // 拒答或答成安裝位置說明 → 不顯示（畫面上已有固定的重拍清單）
            result.source_type === 'refuse' || isDirectionAnswer(result.answer) ? { skipped: true } : result
          ));
        }
        if (source === 'eagle_detection') {
          const status = String(context?.status || '').toUpperCase();
          if (status === 'PASS') return Promise.resolve({ skipped: true });
          return ragClient.askRag(inspectionQuestion(context)).then((result) => {
            const summary = inspectionSummary(context);
            return summary ? { ...result, answer: `檢測結果：${summary}。${result.answer}` } : result;
          });
        }
        return ragClient.askRag(question);
      }
    };
  }

  function sourceLabel(sourceType) {
    return sourceLabels[sourceType] || sourceLabels.refuse;
  }

  return { createRagClient, createF450AssistantService, sourceLabel, uncertainQuestion, isDirectionAnswer };
});
