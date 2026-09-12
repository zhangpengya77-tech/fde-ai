(function configureF450Rag(root) {
  root.FdeRagConfig = Object.freeze({
    FDE_RAG_V1_ENABLED: true,
    RAG_API_MODE: 'auto',
    RAG_API_BASE_URL: 'http://127.0.0.1:8770',
    // classroom-start.ps1 publishes the current HTTPS URL to gh-pages.
    PUBLIC_RAG_API_URL: '',
    RAG_API_TIMEOUT_MS: 20000
  });
})(window);
