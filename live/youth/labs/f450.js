// 實驗 E：F450 組裝（沿用既有組裝實訓室 R2.1：零件拖放、Pixhawk 2.4.8 接線、電機方向、錯誤檢查、評分）
// 本頁另提供「電機編號與轉向」快速檢核，作為青少年版的完成判定；完整組裝評分紀錄保存在組裝實訓室本身
export const meta = { id: 'f450', title: 'F450 組裝', unit: 7 };

const ANSWER = { FR: 'M1', RL: 'M2', FL: 'M3', RR: 'M4' };
const DIR = { M1: 'CCW', M2: 'CCW', M3: 'CW', M4: 'CW' };

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="lab3 two">
    <div class="card">
      <h4>進入完整組裝實訓室</h4>
      <p>F450＋Pixhawk 2.4.8 的零件拖放、ESC 接線、接收機與 GPS 安裝、錯誤檢查與組裝評分，使用 FDE-AI 既有的「組裝實訓室」（3D 數位孿生）。</p>
      <p><a class="btn" href="/f450-twin/build-lab/" target="_blank" rel="noopener">開啟組裝實訓室（新分頁）</a></p>
      <p class="muted small">組裝實訓室的評分與紀錄保存在該頁面內；完成後回到這裡做下方檢核，青少年實驗室才會記錄本實驗完成。</p>
      <h4>組裝前必記</h4>
      <ul class="small"><li>飛控箭頭朝機頭，用減震座固定在中心。</li><li>GPS 架高、箭頭朝前，遠離電源線。</li><li>ESC 訊號線依編號接 MAIN OUT 1–4。</li><li>測試電機前一定拆槳。</li></ul>
    </div>
    <div class="card">
      <h4>檢核：電機編號與轉向（ArduPilot Quad X）</h4>
      <p class="small muted">把每個位置選上正確的電機編號與轉向。機頭朝上。</p>
      <div class="quadpick">
        ${[['FL', '左前'], ['FR', '右前'], ['RL', '左後'], ['RR', '右後']].map(([k, n]) => `
          <div class="qp-${k}"><b>${n}</b>
            <select data-k="${k}" data-f="m"><option value="">編號</option>${['M1', 'M2', 'M3', 'M4'].map(m => `<option>${m}</option>`).join('')}</select>
            <select data-k="${k}" data-f="d"><option value="">轉向</option><option value="CW">順時針 CW</option><option value="CCW">逆時針 CCW</option></select>
          </div>`).join('')}
        <div class="qp-nose">▲ 機頭</div>
      </div>
      <button class="btn" id="f-check">檢查</button>
      <p id="f-res" class="state"></p>
    </div>
  </div>`;
  const $ = s => host.querySelector(s);
  $('#f-check').onclick = () => {
    const errs = [];
    for (const k of Object.keys(ANSWER)) {
      const m = host.querySelector(`select[data-k="${k}"][data-f="m"]`).value;
      const d = host.querySelector(`select[data-k="${k}"][data-f="d"]`).value;
      if (m !== ANSWER[k]) errs.push(`${({ FL: '左前', FR: '右前', RL: '左後', RR: '右後' })[k]}的編號不對`);
      else if (d !== DIR[m]) errs.push(`${m} 的轉向不對`);
    }
    const r = $('#f-res');
    if (errs.length) { r.className = 'state over'; r.textContent = '還有錯誤：' + errs.join('、') + '。提示：M1 在右前。'; ctx.log?.('check', { ok: false, errs }); }
    else { r.className = 'state ok'; r.textContent = '全部正確！M1 右前 CCW、M2 左後 CCW、M3 左前 CW、M4 右後 CW。'; ctx.task?.(); ctx.done?.({ completed: true, check: 'motor-order' }); }
  };
  ctx.onReset = () => { host.querySelectorAll('select').forEach(s => { s.value = ''; }); $('#f-res').textContent = ''; };
  return () => {};
}
