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
    const mode = config.RAG_API_MODE || 'auto';
    const localPage = pageLocation && isLoopback(pageLocation.hostname);
    const endpoints = mode === 'local'
      ? [local]
      : mode === 'public'
        ? [publicApi]
        : localPage
          ? [local, publicApi]
          : [publicApi];
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

  function sourceLabel(sourceType) {
    return sourceLabels[sourceType] || sourceLabels.refuse;
  }

  return { createRagClient, sourceLabel };
});
