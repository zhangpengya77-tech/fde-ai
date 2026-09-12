(function configureF450Rag(root) {
  root.FdeRagConfig = Object.freeze({
    FDE_RAG_V1_ENABLED: true,
    RAG_API_MODE: 'auto',
    RAG_API_BASE_URL: 'http://127.0.0.1:8770',
    // GitHub Pages requires a real HTTPS API URL here for non-local visitors.
    PUBLIC_RAG_API_URL: '',
    RAG_API_TIMEOUT_MS: 20000
  });
})(window);
