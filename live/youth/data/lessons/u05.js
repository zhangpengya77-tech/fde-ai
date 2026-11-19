// U05 電池科學：V1.2 四步單課資料（★業界通用值依 V1.1 第 3 節；不引導學生拆裝真實鋰電池）
export default {
  unitId: 5, code: 'U05', title: '電池科學', subtitle: '串聯並聯與電池安全', kind: '電學原理・虛擬實驗', reviewedBy: '',
  steps: {
    task: {
      title: '訓練任務', sub: '了解今天練什麼', eyebrow: 'MISSION', headline: '算出電池組的電壓、容量和能量',
      objectives: ['記住鋰電池單芯 3.7 V（標稱）、4.2 V（滿電）、3.8 V（儲存）。', '會算串聯電壓與並聯容量：3S＝11.1 V、4S＝14.8 V。', '說出 5 條鋰電池安全規則。'],
      cards: [
        { h: '鋰電池單芯', p: '每顆電芯標稱 3.7 V、充滿 4.2 V、長期存放充到約 3.8 V；飛行中每芯不要低於 3.5 V。' },
        { h: '串聯 S', p: '電芯頭尾相接，電壓相加、容量不變。3S＝11.1 V、4S＝14.8 V、6S＝22.2 V。' },
        { h: '並聯 P', p: '正接正、負接負，容量相加、電壓不變。2 顆 1500 mAh 並聯＝3000 mAh。' },
        { h: '能量 Wh', p: '能量（Wh）＝電壓（V）×容量（Ah）。4S 1500 mAh＝14.8×1.5＝22.2 Wh。' },
        { h: '電池安全', p: '用平衡充電器、充電時有人看著、放防爆袋、鼓包立刻停用、不刺不摔不短路、長放充到儲存電壓。' }
      ]
    },
    demo: {
      title: '三維演示', sub: '看清每一步怎麼做', eyebrow: 'DEMONSTRATION', headline: '一顆一顆接起來，看電壓和容量怎麼變',
      scene: 'u05-battery', views: [['three', '三維視角'], ['top', '俯視'], ['side', '側視'], ['reset', '復位']],
      durationSec: 80, hudLabel: '電池組',
      phases: [
        { key: 'cell', label: '單顆電芯', t: 0, action: { name: '單顆電芯', desc: '一顆鋰電芯標稱 3.7 V，充滿 4.2 V。這是所有電池組的基本單位。', status: '1S1P・3.7 V', target: 16 } },
        { key: 's3', label: '串聯 3S', t: 16, action: { name: '串聯 3S', desc: '3 顆頭尾相接：電壓 3×3.7＝11.1 V，容量不變。橘色光點是電流路徑。', status: '3S1P・11.1 V', target: 16 } },
        { key: 'p2', label: '並聯 2P', t: 32, action: { name: '並聯 2P', desc: '2 顆正接正、負接負：電壓還是 3.7 V，容量變 2 倍。', status: '1S2P・3.7 V', target: 16 } },
        { key: 's46', label: '4S/6S', t: 48, action: { name: '4S 與 6S', desc: '4S＝14.8 V、6S＝22.2 V。電壓越高，電機轉得越快、能帶更大的槳。', status: '6S1P・22.2 V', target: 16 } },
        { key: 'store', label: '安全存放', t: 64, action: { name: '安全存放', desc: '不用時充到每芯約 3.8 V，放進防爆袋、遠離熱源；鼓包立即停用交給老師處理。', status: '儲存電壓 3.8 V', target: 16 } }
      ],
      observe: { rows: [['單芯標稱', '3.7 V'], ['單芯滿電', '4.2 V'], ['單芯儲存', '約 3.8 V']], legend: [['orange', '電流路徑'], ['blue', '電芯']], pass: ['會算串聯電壓', '會算並聯容量', '會算 Wh 能量'] },
      tips: ['橘色光點＝電流路徑', '拖曳旋轉視角・滾輪縮放'], tipsTouch: ['橘色光點＝電流路徑', '單指旋轉・雙指縮放']
    },
    criteria: {
      title: '考核標準', sub: '明確怎樣才算達標', eyebrow: 'ASSESSMENT', headline: '電壓、容量、能量都算對，安全規則記得牢',
      items: [{ big: '11.1', small: 'V', label: '3S 標稱電壓' }, { big: '×2', small: '容量', label: '2P 並聯' }, { big: '22.2', small: 'Wh', label: '4S 1500 mAh' }],
      rules: ['在電池實驗組出 3S、2P、4S2P 並讀出數值', '用 Wh＝V×Ah 算出能量', '說出 5 條安全規則', '只在虛擬環境操作，不拆真實電池'], judge: '課堂判定：電池實驗紀錄＋隨堂測驗', quizPick: 5,
      quiz: [
        { q: '3 顆 3.7 V 電芯串聯，標稱電壓是？', options: ['3.7 V', '7.4 V', '11.1 V', '14.8 V'], answer: 2, explain: '串聯電壓相加：3×3.7＝11.1 V。' },
        { q: '2 顆 1500 mAh 電芯並聯，容量是？', options: ['750 mAh', '1500 mAh', '3000 mAh', '4500 mAh'], answer: 2, explain: '並聯容量相加：1500＋1500＝3000 mAh。' },
        { q: '4S 1500 mAh 的能量約是？', options: ['5.55 Wh', '14.8 Wh', '22.2 Wh', '1500 Wh'], answer: 2, explain: 'Wh＝14.8 V×1.5 Ah＝22.2 Wh。' },
        { q: '鋰電池單芯充滿是幾伏？', options: ['3.0 V', '3.7 V', '4.2 V', '5.0 V'], answer: 2, explain: '單芯滿電 4.2 V，超過就是過充。' },
        { q: '長時間不用的電池，應該充到每芯約？', options: ['4.2 V', '3.8 V', '3.0 V', '0 V'], answer: 1, explain: '長期存放充到約 3.8 V（儲存電壓）最不傷電池。' },
        { q: '發現電池鼓包，正確做法是？', options: ['壓扁繼續用', '立即停用交給老師處理', '拆開看看', '放進冰箱'], answer: 1, explain: '鼓包代表內部產氣受損，繼續用或拆解都可能起火。' },
        { q: '6S 電池單芯 4.2 V 時總電壓是？', options: ['22.2 V', '25.2 V', '24.0 V', '4.2 V'], answer: 1, explain: '6×4.2＝25.2 V（滿電）。' },
        { q: '充電時正確的做法是？', options: ['睡覺時充', '用平衡充電器並有人看著', '放在棉被上充', '隨便找充電器'], answer: 1, explain: '用平衡充電器、有人看管、放防爆袋，是充電基本規則。' }
      ]
    },
    tips: {
      title: '訓練技巧', sub: '掌握做好的小竅門', eyebrow: 'TECHNIQUE', headline: '記住「串壓並容」四個字',
      tips: [
        { h: '串壓並容', p: '串聯加電壓、並聯加容量。看到 S 就乘 3.7，看到 P 就乘容量。' },
        { h: '先換 Ah 再乘', p: '算 Wh 時先把 mAh 除以 1000 變成 Ah，再乘電壓。' },
        { h: '三個電壓記一組', p: '3.7 標稱、4.2 滿電、3.8 儲存，飛行中不低於 3.5。' }
      ],
      mistakes: ['把串聯也算成容量相加', '算 Wh 時忘了把 mAh 換成 Ah', '電池用完不管，長期放在滿電狀態', '以為鼓包壓一壓還能用'],
      practice: { href: '#/lab/battery?unit=5&from=lesson', label: '開始實作：電池實驗', task: '在電池實驗中組出 3S、2P、4S2P，讀出電壓、容量與能量' }
    }
  },
  summary: { motto: '串壓並容，安全第一', lines: ['會算電壓・會算容量', '平衡充電・儲存電壓'] },
  next: 6
};
