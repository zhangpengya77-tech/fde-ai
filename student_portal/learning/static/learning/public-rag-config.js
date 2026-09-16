(() => {
  const current = window.FdeRagConfig || {};
  const hostname = window.location.hostname;
  const isLoopback = hostname === 'localhost'
    || hostname === '[::1]'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  window.FdeRagConfig = Object.freeze({
    ...current,
    RAG_API_MODE: isLoopback ? 'local' : 'public',
    RAG_API_BASE_URL: isLoopback ? window.location.origin : current.RAG_API_BASE_URL,
    PUBLIC_RAG_API_URL: window.location.origin
  });
})();
