(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data;
  root.FdeVideoData = data;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FDE_VIDEO_CATEGORIES = {
    fde: 'FDE-AI',
    ai: 'AI 應用',
    yolo: 'YOLO 目標檢測',
    rag: 'RAG 知識庫',
    f450: 'F450',
    'flight-control': '飛控',
    inspection: '無人機巡檢',
    industry: '產業應用',
    tutorial: '教學'
  };

  const FDE_VIDEO_FILTERS = [
    { id: 'all', label: '全部' },
    { id: 'ai', label: 'AI' },
    { id: 'yolo', label: 'YOLO' },
    { id: 'rag', label: 'RAG' },
    { id: 'f450', label: 'F450' },
    { id: 'flight-control', label: '飛控' },
    { id: 'inspection', label: '巡檢' },
    { id: 'industry', label: '產業應用' }
  ];

  const YOUTUBE_PLAYLIST_ID = '';

  const FDE_VIDEOS = [
    {
      id: 'fde-lab-introduction',
      title: 'FDE-AI 無人載具實驗室｜頻道導覽',
      description: '認識 FDE 專欄，了解無人機操作、AI 視覺與實作學習主題。',
      category: 'fde',
      tags: ['FDE-AI', '無人載具', '實作學習'],
      youtubeUrl: ''
    },
    {
      id: 'enterprise-rag-knowledge-base',
      title: '企業 RAG 知識庫搭建解析',
      description: '介紹如何整理專業資料，建立可檢索、可追溯的 AI 知識庫。',
      category: 'rag',
      tags: ['FDE-AI', 'RAG', '知識庫'],
      youtubeUrl: ''
    },
    {
      id: 'ai-yolo-visual-detection',
      title: 'AI 視覺 YOLO 目標檢測商業開發案例',
      description: '從影像資料、目標標註到 YOLO 檢測應用的實作案例。',
      category: 'yolo',
      tags: ['AI', 'YOLO', '目標檢測'],
      youtubeUrl: ''
    },
    {
      id: 'ai-visual-drone-applications',
      title: 'AI 視覺辨識在無人機任務中的應用',
      description: '了解 AI 視覺如何協助無人載具辨識目標與支援任務流程。',
      category: 'ai',
      tags: ['FDE-AI', 'AI 視覺', '無人機'],
      youtubeUrl: ''
    },
    {
      id: 'f450-dji-naza-installation',
      title: 'F450 與 DJI Naza 飛控驅動安裝異常處理',
      description: '整理 F450 組裝及 DJI Naza 飛控驅動安裝時常見的操作問題。',
      category: 'f450',
      tags: ['F450', 'DJI Naza', '飛控'],
      youtubeUrl: ''
    },
    {
      id: 'drone-powerline-inspection',
      title: '無人機電力巡檢案例介紹',
      description: '認識無人機在電力設施巡檢中的任務方式與應用情境。',
      category: 'inspection',
      tags: ['無人機巡檢', '電力', '應用案例'],
      youtubeUrl: ''
    },
    {
      id: 'open-vs-closed-flight-controller',
      title: '開源飛控與閉源飛控講解',
      description: '比較不同飛控生態的操作方式、工具與學習重點。',
      category: 'flight-control',
      tags: ['飛控', '開源', '產業應用'],
      youtubeUrl: ''
    },
    {
      id: 'drone-industry-use-cases',
      title: '無人載具產業應用與實作案例',
      description: '分享無人載具如何結合 AI、巡檢與現場工作流程。',
      category: 'industry',
      tags: ['無人載具', 'AI', '產業應用'],
      youtubeUrl: ''
    },
    {
      id: 'fde-drone-ai-tutorials',
      title: 'FDE / AI / 無人機教學影片整理',
      description: '持續整理無人機操作、F450、AI 與工程實作的教學內容。',
      category: 'tutorial',
      tags: ['FDE-AI', '教學', '無人機'],
      youtubeUrl: ''
    }
  ];

  return { FDE_VIDEO_CATEGORIES, FDE_VIDEO_FILTERS, FDE_VIDEOS, YOUTUBE_PLAYLIST_ID };
});
