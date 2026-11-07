(() => {
  const routeDefinitions = [
    { key: 'home', sectionId: 'home', path: '' },
    // 12 任務地圖路由保留（/platform/tasks 仍可直接開啟，供首頁「三分鐘看懂」與既有連結使用），
    // 但左側導航入口已改為「關於我們」（2026-11-05）
    { key: 'missions', sectionId: 'missions', path: 'tasks' },
    // 2026-11-05：新訪客認識平台的「關於我們 About FDE-AI」頁（/platform/about）
    { key: 'about', sectionId: 'about', path: 'about' },
    { key: 'learn', sectionId: 'learn', path: 'courses' },
    // 舊 /fde 連結保留相容性，但顯示新版三大「學」專區；原始 FDE 影片資料仍保留。
    { key: 'fde-column', sectionId: 'learn', path: 'fde' },
    { key: 'practice', sectionId: 'practice', path: 'simulator' },
    { key: 'build', sectionId: 'build', path: 'f450' },
    { key: 'inspection', sectionId: 'inspection', path: 'eagle' },
    { key: 'certify', sectionId: 'certify', path: 'github' },
    { key: 'cohorts', sectionId: 'cohorts', path: 'results' },
    { key: 'teacher', sectionId: 'teacher', path: 'teacher' }
  ];

  const routesByKey = new Map(routeDefinitions.map((route) => [route.key, route]));
  const routesByPath = new Map(routeDefinitions.filter((route) => route.path).map((route) => [route.path, route]));
  const routesBySection = new Map(routeDefinitions.map((route) => [route.sectionId, route]));

  function lastPathSegment(pathname = '') {
    const segments = String(pathname).split('/').filter(Boolean);
    return (segments.at(-1) || '').replace(/\.html$/i, '');
  }

  function routeFromLocation(location = window.location) {
    return routesByPath.get(lastPathSegment(location.pathname))?.key || 'home';
  }

  function routeFromHref(href, currentLocation = window.location) {
    if (!href) return null;

    const value = String(href).trim();
    if (value.startsWith('#')) {
      return routesBySection.get(value.slice(1))?.key || null;
    }

    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('file:')) {
      const currentOrigin = currentLocation.origin;
      const targetUrl = new URL(value);
      if (!currentOrigin || targetUrl.origin !== currentOrigin) return null;
      return routesByPath.get(lastPathSegment(targetUrl.pathname))?.key || null;
    }

    const pathPart = value.split(/[?#]/, 1)[0];
    return routesByPath.get(lastPathSegment(pathPart))?.key || (pathPart === './' || pathPart === '/' ? 'home' : null);
  }

  function hrefFor(routeKey) {
    const route = routesByKey.get(routeKey) || routesByKey.get('home');
    return route.path ? `./${route.path}` : './';
  }

  function hrefForTarget(target) {
    const routeKey = routeFromHref(target);
    return routeKey ? hrefFor(routeKey) : target;
  }

  window.FdeRouter = {
    definitions: routeDefinitions,
    routeFromLocation,
    routeFromHref,
    hrefFor,
    hrefForTarget
  };
})();
