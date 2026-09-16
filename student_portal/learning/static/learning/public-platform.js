(() => {
  const contextElement = document.getElementById('fde-public-context');
  let platformContext = {};
  try {
    platformContext = JSON.parse(contextElement?.textContent || '{}');
  } catch {
    platformContext = {};
  }

  const role = platformContext.role || 'anonymous';
  const primaryAction = role === 'teacher'
    ? { label: '教師後台', target: platformContext.teacherDashboardUrl, kind: 'primary' }
    : { label: '我的學習成長日誌', target: platformContext.growthUrl || '/student/growth/', kind: 'primary' };
  if (window.FdePlatform?.hero) window.FdePlatform.hero.actions = [primaryAction];

  const sameOriginTargets = new Map([
    ['http://127.0.0.1:8770/api/rag/ask', '/api/public/rag/ask/'],
    [`${window.location.origin}/api/rag/ask`, '/api/public/rag/ask/'],
    ['http://127.0.0.1:8765/api/detect', '/api/public/inspection/detect/'],
    ['http://127.0.0.1:8765/api/hover', '/api/public/inspection/hover/'],
    ['http://127.0.0.1:8765/api/voice/ask', '/api/public/voice/ask/']
  ]);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const sourceUrl = typeof input === 'string' ? input : input?.url;
    const target = sameOriginTargets.get(sourceUrl);
    if (!target) return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    const csrfToken = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
    if (csrfToken) headers.set('X-CSRFToken', decodeURIComponent(csrfToken));
    const rewrittenInput = input instanceof Request
      ? new Request(new URL(target, window.location.origin), input)
      : target;
    return originalFetch(rewrittenInput, { ...init, headers, credentials: 'same-origin' });
  };
})();
