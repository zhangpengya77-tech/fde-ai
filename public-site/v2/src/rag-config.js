(function configureF450Rag(root) {
  root.FdeRagConfig = Object.freeze({
    FDE_RAG_V1_ENABLED: true,
    RAG_API_MODE: 'auto',
    RAG_API_BASE_URL: '',
    // classroom-start.ps1 publishes the current HTTPS URL to gh-pages.
    PUBLIC_RAG_API_URL: '',
    RAG_API_TIMEOUT_MS: 20000,
    // Platform Integration：正式 Vision API（Assess 測）與 F450 Main-12 入口（Build 作）。
    VISION_API_MODE: 'auto',
    VISION_API_BASE_URL: '',
    // classroom-start.ps1 可發布目前 HTTPS URL 到 gh-pages。
    PUBLIC_VISION_API_URL: '',
    LIVE_COACH_URL: '/live/',
    PUBLIC_LIVE_COACH_URL: '',
    // 僅開發測試用；正式學生流程永遠不走模擬結果。
    ASSESS_DEV_MODE: false
  });
})(window);
