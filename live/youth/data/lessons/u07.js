// U07 飛控與感測器：V1.2 四步單課資料（★每升高約 8 m 氣壓少 1 hPa）
const V = [['three', '三維視角'], ['top', '俯視'], ['side', '側視'], ['reset', '復位']];
export default {
  unitId: 7, code: 'U07', title: '飛控與感測器', subtitle: '陀螺儀、加速度計、氣壓計、GPS', kind: '感測原理・回饋控制', reviewedBy: '',
  steps: {
    task: {
      title: '訓練任務', sub: '了解今天練什麼', eyebrow: 'MISSION', headline: '飛控靠感測器知道自己的狀態',
      objectives: ['說出陀螺儀、加速度計、氣壓計、GPS、羅盤各量什麼。', '說明陀螺儀和加速度計為什麼要互補。', '說明回饋控制怎麼把歪掉的機身扶正。'],
      cards: [
        { h: '陀螺儀', p: '量「轉得多快」（角速度），不是角度。短時間很準，但時間久了會慢慢漂移。' },
        { h: '加速度計', p: '量加速度，靜止時量到的是重力方向，可以算出傾斜角。長時間準，但很怕震動。' },
        { h: '氣壓計', p: '高度越高氣壓越低，地面附近每升高約 8 公尺氣壓少 1 hPa，用來估算高度。' },
        { h: 'GPS 與羅盤', p: 'GPS 接收衛星訊號算位置，室內收不到；羅盤量地磁，知道機頭朝哪個方向。' },
        { h: '回饋控制', p: '飛控每秒上百次比較「目標」和「量到的」，差多少就修正多少，這就是回饋控制（PID 的基礎）。' }
      ]
    },
    demo: {
      title: '三維演示', sub: '看清每一步怎麼做', eyebrow: 'DEMONSTRATION', headline: '看每個感測器量到什麼數字',
      scene: 'u07-sensors', views: V, durationSec: 75, hudLabel: '感測器讀數',
      phases: [
        { key: 'gyro', label: '陀螺儀', t: 0, action: { name: '陀螺儀', desc: '機身轉動時，陀螺儀量到角速度；停止轉動，讀數回到 0。', status: '量角速度', target: 15 } },
        { key: 'accel', label: '加速度計', t: 15, action: { name: '加速度計', desc: '機身傾斜，重力在機身上的分量改變，飛控由此算出傾角。', status: '量重力方向', target: 15 } },
        { key: 'baro', label: '氣壓計', t: 30, action: { name: '氣壓計', desc: '飛機上升，氣壓慢慢變低，飛控換算出高度。', status: '量氣壓', target: 15 } },
        { key: 'gps', label: 'GPS／羅盤', t: 45, action: { name: 'GPS 與羅盤', desc: '頭頂的衛星訊號讓飛機知道位置，羅盤指出機頭方向。', status: '定位中', target: 15 } },
        { key: 'loop', label: '回饋穩定', t: 60, action: { name: '回饋穩定', desc: '一陣風把機身吹歪，飛控發現誤差，讓低的那一側電機加速，把機身扶正。', status: '自穩修正中', target: 15 } }
      ],
      observe: { rows: [['陀螺儀', '角速度 °/s'], ['加速度計', '重力分量 g'], ['氣壓計', 'hPa → 高度']], legend: [['orange', '感測器量到的方向'], ['blue', '機身座標軸']], pass: ['說出 5 種感測器', '說明互補原因'] },
      tips: ['橘色箭頭＝感測器量到的量', '拖曳旋轉視角・滾輪縮放'], tipsTouch: ['橘色箭頭＝感測器量到的量', '單指旋轉・雙指縮放']
    },
    criteria: {
      title: '考核標準', sub: '明確怎樣才算達標', eyebrow: 'ASSESSMENT', headline: '感測器說得清，回饋原理講得出',
      items: [{ big: '5', small: '種', label: '感測器' }, { big: '8', small: 'm／hPa', label: '氣壓與高度' }, { big: '±2°', small: '', label: '自穩回正' }],
      rules: ['在感測器實驗把機身傾斜 20° 以上', '開啟自穩讓機身回到 ±2° 以內', '說出陀螺儀與加速度計的互補關係'], judge: '課堂判定：感測器實驗紀錄＋隨堂測驗', quizPick: 5,
      quiz: [
        { q: '量「轉動有多快」的是？', options: ['氣壓計', '陀螺儀', 'GPS', '電流計'], answer: 1, explain: '陀螺儀量角速度。' },
        { q: '在室內飛行，哪個感測器通常沒作用？', options: ['陀螺儀', '加速度計', 'GPS', '氣壓計'], answer: 2, explain: '屋頂擋住衛星訊號，室內一般收不到 GPS。' },
        { q: '飛控發現機體右傾，會怎麼做？', options: ['右側電機加速把它扶正', '全部電機停止', '左側電機加速', '不理會'], answer: 0, explain: '右側下沉就讓右側推力變大，推回水平。' },
        { q: '陀螺儀的缺點是？', options: ['怕震動', '時間久會漂移', '室內不能用', '太重'], answer: 1, explain: '陀螺儀短時準，但積分久了會漂移。' },
        { q: '加速度計的缺點是？', options: ['會漂移', '很怕震動', '要接衛星', '量不到重力'], answer: 1, explain: '震動會讓加速度計讀數亂跳。' },
        { q: '地面附近每升高約幾公尺，氣壓少 1 hPa？', options: ['1 m', '8 m', '100 m', '1000 m'], answer: 1, explain: '約每 8 公尺氣壓下降 1 hPa。' },
        { q: '知道機頭朝哪個方向的是？', options: ['羅盤', '氣壓計', '電池', '電調'], answer: 0, explain: '羅盤量地磁方向，告訴飛控機頭朝向。' },
        { q: '「比較目標和量到的，差多少修多少」叫做？', options: ['開迴路', '回饋控制', '隨機控制', '手動控制'], answer: 1, explain: '回饋控制是自穩的基礎，PID 就是一種回饋控制。' }
      ]
    },
    tips: {
      title: '訓練技巧', sub: '掌握做好的小竅門', eyebrow: 'TECHNIQUE', headline: '把感測器想成飛機的五官',
      tips: [{ h: '五官比喻', p: '陀螺儀像內耳感覺轉動、氣壓計像耳朵感覺高度、GPS 像地圖、羅盤像指南針。' }, { h: '互補記法', p: '陀螺儀「快而會飄」、加速度計「穩而怕抖」，兩個合起來剛好互補。' }, { h: '回饋三步', p: '量現在 → 比目標 → 修誤差，一直重複。' }],
      mistakes: ['以為陀螺儀直接量角度', '在室內期待 GPS 定點', '以為飛控一次就能修到完美'],
      practice: { href: '#/lab/sensor?unit=7&from=lesson', label: '開始實作：感測器實驗', task: '傾斜機身到 20° 以上，再開啟自穩讓它回到 ±2°' }
    }
  },
  summary: { motto: '量得準，才修得穩', lines: ['感測器量・飛控算', '比較誤差・持續修正'] },
  next: 8
};
