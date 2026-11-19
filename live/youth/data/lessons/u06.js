// U06 飛行姿態：V1.2 四步單課資料（★ArduPilot Quad X 電機編號依 V1.1 第 3 節）
const V = [['three', '三維視角'], ['top', '俯視'], ['side', '側視'], ['reset', '復位']];
export default {
  unitId: 6, code: 'U06', title: '飛行姿態', subtitle: '油門、俯仰、橫滾、偏航', kind: '操控原理・姿態演示', reviewedBy: '',
  steps: {
    task: {
      title: '訓練任務', sub: '了解今天練什麼', eyebrow: 'MISSION', headline: '看懂四個控制量，知道哪顆電機在加速',
      objectives: ['分辨 Throttle、Pitch、Roll、Yaw 四個控制量。', '說出前傾、左滾、偏航時哪幾顆電機加速。', '知道美國手（Mode 2）的搖桿配置。'],
      cards: [
        { h: 'Throttle 油門', p: '4 顆電機一起加速或減速，控制上升與下降。美國手是左搖桿上下。' },
        { h: 'Pitch 俯仰', p: '後兩顆電機加速、前兩顆減速，機頭往下、往前飛。美國手是右搖桿上下。' },
        { h: 'Roll 橫滾', p: '右邊兩顆加速，機身往左滾、往左飛；左邊兩顆加速就往右。美國手是右搖桿左右。' },
        { h: 'Yaw 偏航', p: '同轉向的一組電機加速、另一組減速，反扭力不平衡，機身原地轉向。美國手是左搖桿左右。' },
        { h: '電機編號（Quad X）', p: 'M1 右前逆時針、M2 左後逆時針、M3 左前順時針、M4 右後順時針。對角同轉向。' }
      ]
    },
    demo: {
      title: '三維演示', sub: '看清每一步怎麼做', eyebrow: 'DEMONSTRATION', headline: '橘色電機在加速，看機身怎麼跟著動',
      scene: 'u06-attitude', views: V, durationSec: 75, hudLabel: '目前姿態',
      phases: [
        { key: 'thr', label: '油門', t: 0, action: { name: 'Throttle 油門', desc: '4 顆電機同時加速，飛機垂直上升；一起減速就下降。', status: '4 顆同時變速', target: 15 } },
        { key: 'pitch', label: '俯仰', t: 15, action: { name: 'Pitch 前傾', desc: '後面 M2、M4 加速，前面 M1、M3 減速，機頭往下，飛機往前。', status: 'M2・M4 加速', target: 15 } },
        { key: 'roll', label: '橫滾', t: 30, action: { name: 'Roll 左滾', desc: '右邊 M1、M4 加速，左邊減速，機身往左傾、往左飛，機頭方向不變。', status: 'M1・M4 加速', target: 15 } },
        { key: 'yaw', label: '偏航', t: 45, action: { name: 'Yaw 右轉', desc: '逆時針的 M1、M2 加速，反扭力讓機身往順時針方向轉。', status: 'M1・M2 加速', target: 15 } },
        { key: 'combo', label: '組合', t: 60, action: { name: '組合動作', desc: '真實飛行常同時用兩三個控制量，例如一邊前進一邊轉彎。動作要小、要慢。', status: '前進＋轉向', target: 15 } }
      ],
      observe: { rows: [['機型', 'Quad X'], ['M1／M2', '逆時針'], ['M3／M4', '順時針']], legend: [['orange', '加速中的電機'], ['blue', '機頭方向']], pass: ['說出 4 個控制量', '說出加速的電機'] },
      tips: ['橘色電機＝正在加速', '拖曳旋轉視角・滾輪縮放'], tipsTouch: ['橘色電機＝正在加速', '單指旋轉・雙指縮放']
    },
    criteria: {
      title: '考核標準', sub: '明確怎樣才算達標', eyebrow: 'ASSESSMENT', headline: '控制量分得清、電機說得對、任務做得到',
      items: [{ big: '4', small: '個', label: '控制量' }, { big: '15°', small: '前傾', label: '姿態實驗任務' }, { big: '90°', small: '偏航', label: '姿態實驗任務' }],
      rules: ['在姿態實驗中保持水平 3 秒', '只用 Yaw 轉到 90°', '前傾 15° 並保持 2 秒'], judge: '課堂判定：姿態實驗紀錄＋隨堂測驗', quizPick: 5,
      quiz: [
        { q: '讓機頭原地轉向的是哪一個？', options: ['Pitch', 'Roll', 'Yaw', 'Throttle'], answer: 2, explain: 'Yaw 偏航＝水平旋轉機頭方向。' },
        { q: 'Roll 往右，無人機會？', options: ['往右平移', '往前飛', '上升', '原地轉圈'], answer: 0, explain: '機身右傾，推力分出向右的分量。' },
        { q: '前傾時哪兩顆電機加速？', options: ['前面 M1、M3', '後面 M2、M4', '左邊兩顆', '全部減速'], answer: 1, explain: '後面兩顆加速、前面兩顆減速，機頭往下。' },
        { q: 'Yaw 為什麼能轉向？', options: ['有尾舵', '同轉向電機的反扭力不平衡', 'GPS 推動', '螺旋槳變形'], answer: 1, explain: '一組同轉向的電機加速，反扭力不再抵消，機身就轉。' },
        { q: '美國手（Mode 2）的油門在？', options: ['右搖桿上下', '左搖桿上下', '右搖桿左右', '按鈕'], answer: 1, explain: 'Mode 2：左搖桿上下油門、左右偏航；右搖桿俯仰與橫滾。' },
        { q: 'ArduPilot Quad X 的 M1 在哪裡？', options: ['左前', '右前', '左後', '右後'], answer: 1, explain: 'M1 右前、M2 左後、M3 左前、M4 右後。' },
        { q: '只動油門，飛機會？', options: ['轉向', '上升或下降', '左右平移', '翻滾'], answer: 1, explain: '油門讓 4 顆電機一起變速，只改變高度。' },
        { q: '同時前進又轉彎，用了哪些控制量？', options: ['只有 Throttle', 'Pitch 和 Yaw', '只有 Roll', '都沒用'], answer: 1, explain: '前進用 Pitch，轉彎用 Yaw。' }
      ]
    },
    tips: {
      title: '訓練技巧', sub: '掌握做好的小竅門', eyebrow: 'TECHNIQUE', headline: '一次只動一個控制量',
      tips: [{ h: '先單一再組合', p: '剛開始一次只動一個搖桿方向，熟練後再加第二個。' }, { h: '記住哪邊加速', p: '想往哪邊傾，對面的電機就加速，把那一邊頂起來。' }, { h: '看機頭', p: '機頭朝自己時左右會相反，練習時先保持機頭朝前。' }],
      mistakes: ['同時亂推兩個搖桿，不知道是哪個造成的', '以為 Roll 會改變機頭方向', '機頭朝自己時左右打反'],
      practice: { href: '#/lab/attitude?unit=6&from=lesson', label: '開始實作：飛行姿態實驗', task: '完成保持水平、偏航 90°、前傾 15°、左滾 20° 四個任務' }
    }
  },
  summary: { motto: '一桿一動作', lines: ['分清四量・看懂電機', '先單後合・小打慢修'] },
  next: 7
};
