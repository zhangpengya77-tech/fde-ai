(function configureF450Rag(root) {
  root.FdeRagConfig = Object.freeze({
    FDE_RAG_V1_ENABLED: true,
    RAG_API_MODE: 'public',
    RAG_API_BASE_URL: '',
    // classroom-start.ps1 publishes the current HTTPS URL to gh-pages.
    PUBLIC_RAG_API_URL: 'https://there-fleet-homes-hist.trycloudflare.com',
    RAG_API_TIMEOUT_MS: 20000
  });
})(window);
