// U08 無人機組裝：V1.2 四步單課資料（不提供腳位級焊接指示；Pixhawk 接口用途沿用組裝實訓室資料）
const V = [['three', '三維視角'], ['top', '俯視'], ['side', '側視'], ['reset', '復位']];
export default {
  unitId: 8, code: 'U08', title: '無人機組裝', subtitle: 'F450 組裝順序與檢查', kind: '組裝實作・3D 演示', reviewedBy: '',
  steps: {
    task: {
      title: '訓練任務', sub: '了解今天練什麼', eyebrow: 'MISSION', headline: '照順序組裝，裝完一定要檢查',
      objectives: ['說出組裝順序：機架 → 電機 → 電調 → 配電 → 飛控 → 接收機 → GPS → 電池固定。', '電機方向、正反槳、GPS 與飛控箭頭都朝機頭。', '測試電機前一定先拆槳。'],
      cards: [
        { h: '組裝順序', p: '先裝骨架再裝動力，最後裝電子零件：機架 → 電機 → 電調 → 配電 → 飛控 → 接收機 → GPS → 電池固定。' },
        { h: '電機與正反槳', p: 'M1 右前、M2 左後逆時針，M3 左前、M4 右後順時針；槳要配合電機轉向，裝反一起飛就翻。' },
        { h: '飛控與 GPS 方向', p: '飛控和 GPS 上的箭頭都要朝機頭。飛控用減震座固定在機身中心，GPS 架高遠離電源線。' },
        { h: '接線與檢查', p: '電調訊號線依編號接飛控 MAIN OUT 1–4，接收機接 RC IN。裝完檢查螺絲、線材會不會被槳打到、電池綁緊。' }
      ]
    },
    demo: {
      title: '三維演示', sub: '看清每一步怎麼做', eyebrow: 'DEMONSTRATION', headline: '一件一件裝上去，看順序和方向',
      scene: 'u08-assembly', views: V, durationSec: 80, hudLabel: '已安裝零件',
      phases: [
        { key: 'frame', label: '機架', t: 0, action: { name: '安裝機架', desc: '先把下板和 4 支機臂鎖好，紅色機臂朝前（機頭）。', status: '骨架完成', target: 16 } },
        { key: 'motor', label: '電機', t: 16, action: { name: '安裝電機', desc: '電機鎖在機臂末端，螺絲不可太長碰到線圈；注意 M1–M4 的位置。', status: '電機 4/4', target: 16 } },
        { key: 'esc', label: 'ESC', t: 32, action: { name: '安裝電調', desc: '電調固定在機臂上，電源線接配電板，三條相線接電機。', status: '電調 4/4', target: 16 } },
        { key: 'fc', label: '飛控／接收機', t: 48, action: { name: '飛控與接收機', desc: '飛控箭頭朝機頭、用減震座固定；接收機接 RC IN。', status: '大腦就位', target: 16 } },
        { key: 'check', label: 'GPS／檢查', t: 64, action: { name: 'GPS 與總檢查', desc: 'GPS 架高、箭頭朝前；最後綁好電池，檢查螺絲、線材、槳葉正反。', status: '組裝完成', target: 16 } }
      ],
      observe: { rows: [['機架', 'F450'], ['飛控', 'Pixhawk 2.4.8'], ['機頭', '紅色機臂方向']], legend: [['orange', '這一步安裝的零件'], ['blue', '已安裝零件']], pass: ['組裝順序正確', '方向全部朝機頭', '測試前拆槳'] },
      tips: ['橘色＝這一步要裝的零件', '拖曳旋轉視角・滾輪縮放'], tipsTouch: ['橘色＝這一步要裝的零件', '單指旋轉・雙指縮放']
    },
    criteria: {
      title: '考核標準', sub: '明確怎樣才算達標', eyebrow: 'ASSESSMENT', headline: '順序對、方向對、檢查做完',
      items: [{ big: '8', small: '步', label: '組裝順序' }, { big: '4', small: '顆', label: '電機編號與轉向' }, { big: '0', small: '錯', label: '方向錯誤' }],
      rules: ['在 F450 組裝實驗完成電機編號與轉向檢核', '說出組裝順序', '指出飛控與 GPS 的箭頭方向'], judge: '課堂判定：組裝實訓室評分＋隨堂測驗', quizPick: 5,
      quiz: [
        { q: 'ArduPilot Quad X 的 M1 在哪個位置？', options: ['左前', '右前', '左後', '右後'], answer: 1, explain: 'M1 右前、M2 左後、M3 左前、M4 右後。' },
        { q: '電機轉向相反，怎麼改？', options: ['換電池', '對調電機任意兩條線', '把槳反裝', '重灌韌體'], answer: 1, explain: '三相無刷電機對調任兩相，轉向就相反。' },
        { q: '測試電機前一定要？', options: ['裝上槳', '拆下螺旋槳', '打開 GPS', '把電池充過飽'], answer: 1, explain: '拆槳測試是最基本的安全規定。' },
        { q: '飛控上的箭頭應該朝？', options: ['機尾', '機頭', '左邊', '隨便'], answer: 1, explain: '飛控與 GPS 箭頭都朝機頭，方向才不會錯。' },
        { q: '組裝的第一步通常是？', options: ['裝 GPS', '裝機架', '綁電池', '裝槳'], answer: 1, explain: '先把骨架（機架）裝好，其他零件才有地方固定。' },
        { q: '電調訊號線要接到飛控的？', options: ['RC IN', 'MAIN OUT 1–4', 'GPS', 'USB'], answer: 1, explain: '電調訊號線依電機編號接 MAIN OUT 1–4。' },
        { q: 'GPS 為什麼要架高？', options: ['比較好看', '遠離電源線干擾、收訊較好', '比較輕', '規定'], answer: 1, explain: '架高可減少電源線磁場干擾，收衛星也較好。' },
        { q: '電機螺絲太長會怎樣？', options: ['比較牢', '可能碰到線圈造成短路', '轉比較快', '沒影響'], answer: 1, explain: '螺絲太長會刮傷線圈，造成短路或燒毀。' }
      ]
    },
    tips: {
      title: '訓練技巧', sub: '掌握做好的小竅門', eyebrow: 'TECHNIQUE', headline: '先找機頭，再裝零件',
      tips: [{ h: '先定機頭', p: '一開始就用紅色機臂或貼紙標出機頭，之後所有方向都跟著它。' }, { h: '裝一件檢一件', p: '每裝好一個零件就檢查螺絲和方向，不要全部裝完才找問題。' }, { h: '線材整理', p: '用束帶把線固定好，確定螺旋槳轉的範圍內沒有任何線。' }],
      mistakes: ['飛控裝反，一起飛就亂衝', '正反槳裝錯位置', '線材垂到槳的範圍被打斷', '測電機時沒拆槳'],
      practice: { href: '#/lab/f450?unit=8&from=lesson', label: '開始實作：F450 組裝', task: '完成電機編號與轉向檢核，並到組裝實訓室練習組裝' }
    }
  },
  summary: { motto: '順序對，方向對', lines: ['先定機頭・依序安裝', '裝完檢查・拆槳測試'] },
  next: 9
};
