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
      id: 'enterprise-rag-knowledge-base',
      title: '企業 RAG 知識庫搭建解析（FDE-AI）',
      description: '介紹如何整理專業資料，建立可檢索、可追溯的 AI 知識庫。',
      category: 'fde',
      tags: ['FDE-AI', 'RAG', '知識庫'],
      youtubeUrl: 'https://youtu.be/ajWnFJSM_BU?si=aU3E3hNoRwgIZl2E',
      videoId: 'ajWnFJSM_BU'
    },
    {
      id: 'youtube-dWkH5YVi3gY',
      title: 'F450&px2.4.8飛控&mp地面站設置（FDE-Ai）',
      description: 'F450、Pixhawk PX2.4.8 與 Mission Planner 地面站設定。',
      category: 'f450',
      tags: ['FDE-AI', 'F450', 'Pixhawk', 'Mission Planner', '飛控'],
      youtubeUrl: 'https://youtu.be/dWkH5YVi3gY',
      videoId: 'dWkH5YVi3gY'
    },
    {
      id: 'youtube-N0fW9Q9sWMU',
      title: 'MP地面站軟體基礎介紹（FDE-Ai）',
      description: 'Mission Planner 地面站軟體基礎操作。',
      category: 'flight-control',
      tags: ['FDE-AI', 'Mission Planner', '飛控'],
      youtubeUrl: 'https://youtu.be/N0fW9Q9sWMU',
      videoId: 'N0fW9Q9sWMU'
    },
    {
      id: 'youtube-F9RLymjxsVo',
      title: 'F450&dji naza組裝步驟（FDE-Ai）',
      description: 'F450 與 DJI Naza 組裝步驟示範。',
      category: 'f450',
      tags: ['FDE-AI', 'F450', 'DJI Naza', '組裝'],
      youtubeUrl: 'https://youtu.be/F9RLymjxsVo',
      videoId: 'F9RLymjxsVo'
    },
    {
      id: 'youtube-U3VhDWSoLUE',
      title: 'F450&djinaza調參軟體介紹（FDE-Ai）',
      description: 'F450 與 DJI Naza 調參軟體介紹。',
      category: 'f450',
      tags: ['FDE-AI', 'F450', 'DJI Naza', '飛控'],
      youtubeUrl: 'https://youtu.be/U3VhDWSoLUE',
      videoId: 'U3VhDWSoLUE'
    },
    {
      id: 'youtube-omPgcb1PFRM',
      title: 'F450無人機&樂迪AT9S遥控器（FDE-Ai）',
      description: 'F450 無人機搭配 AT9S 遙控器的設定內容。',
      category: 'f450',
      tags: ['FDE-AI', 'F450', '遙控器', 'AT9S'],
      youtubeUrl: 'https://youtu.be/omPgcb1PFRM',
      videoId: 'omPgcb1PFRM'
    },
    {
      id: 'youtube-9ZeOb67IN5s',
      title: '無人機充電器介紹（FDE-Ai）',
      description: '無人機充電器介紹。',
      category: 'tutorial',
      tags: ['FDE-AI', '無人機', '充電器', '教學'],
      youtubeUrl: 'https://youtu.be/9ZeOb67IN5s',
      videoId: '9ZeOb67IN5s'
    },
    {
      id: 'youtube-qo1f1FZn0Qo',
      title: '無人機訓練鳳凰模擬器遙控器設置（FDE-Ai）',
      description: '鳳凰模擬器遙控器設定與訓練場地介紹。',
      category: 'tutorial',
      tags: ['FDE-AI', '無人機', '模擬器', '遙控器'],
      youtubeUrl: 'https://youtu.be/qo1f1FZn0Qo',
      videoId: 'qo1f1FZn0Qo'
    },
    {
      id: 'youtube-iqasSBlnyZg',
      title: '無人機Mp地面站設定飛行計劃（FDE-Ai）',
      description: 'Mission Planner 無人機地面站飛行計劃設定講解。',
      category: 'flight-control',
      tags: ['FDE-AI', '無人機', 'Mission Planner', '飛行計劃'],
      youtubeUrl: 'https://youtu.be/iqasSBlnyZg',
      videoId: 'iqasSBlnyZg'
    }
  ];

  return { FDE_VIDEO_CATEGORIES, FDE_VIDEO_FILTERS, FDE_VIDEOS, YOUTUBE_PLAYLIST_ID };
});
