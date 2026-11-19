// 實驗 A：3D 無人機拆解（360° 旋轉、縮放、透明機殼、爆炸圖、零件解說、拖放組裝）
import { THREE, makeStage, buildQuad, spinProps, label } from './three-kit.js';

export const meta = { id: 'teardown', title: '3D 無人機拆解', unit: 1 };

export function mount(host, ctx) {
  host.innerHTML = `
  <div class="lab3">
    <aside class="card lab-side">
      <h4>操作</h4>
      <label class="sw"><input type="checkbox" id="ta-trans"> 透明機殼</label>
      <label class="sw"><input type="checkbox" id="ta-spin"> 螺旋槳轉動</label>
      <label class="sw"><input type="checkbox" id="ta-tag" checked> 顯示零件名稱</label>
      <label class="rng">爆炸圖 <input type="range" id="ta-exp" min="0" max="100" value="0"></label>
      <h4>模式</h4>
      <div class="seg"><button id="ta-learn" class="on">認識零件</button><button id="ta-build">拖放組裝</button></div>
      <p class="muted small">滑鼠拖曳可 360° 旋轉，滾輪或雙指縮放。</p>
    </aside>
    <div class="lab-stage" id="ta-stage"><div class="stage-tip" id="ta-tip">點選零件查看說明</div></div>
    <aside class="card lab-info">
      <h4 id="ta-name">零件說明</h4>
      <p id="ta-info" class="muted">在 3D 畫面或下方清單點選零件。</p>
      <h4>零件清單 <small id="ta-count"></small></h4>
      <ul class="part-list" id="ta-list"></ul>
    </aside>
  </div>`;
  const $ = s => host.querySelector(s);
  const st = makeStage($('#ta-stage'), { cam: [2.6, 2.0, 2.8] });
  const quad = buildQuad(); st.scene.add(quad);
  const parts = quad.userData.parts;
  const tags = new THREE.Group(); st.scene.add(tags);
  parts.forEach(p => { const l = label(p.name, { size: 0.09 }); p.tag = l; tags.add(l); });

  let explode = 0, mode = 'learn', spin = false, selected = null;
  const placed = new Set(parts.map(p => p.key));    // 已安裝的零件
  const visited = new Set();

  const list = $('#ta-list');
  const renderList = () => {
    list.innerHTML = parts.map(p => `<li draggable="${mode === 'build' && !placed.has(p.key)}" data-k="${p.key}" class="${placed.has(p.key) ? 'ok' : 'todo'} ${selected === p.key ? 'sel' : ''}">${p.name}${mode === 'build' ? (placed.has(p.key) ? ' ✓' : ' ⇢ 拖到 3D 畫面') : ''}</li>`).join('');
    $('#ta-count').textContent = mode === 'build' ? `${placed.size}/${parts.length}` : '';
  };
  const select = key => {
    selected = key; const p = parts.find(x => x.key === key); if (!p) return;
    visited.add(key);
    $('#ta-name').textContent = p.name; $('#ta-info').textContent = p.info;
    parts.forEach(x => x.obj.traverse(o => { if (o.material?.emissive) o.material.emissive.setHex(x.key === key ? 0x2255aa : 0); }));
    renderList(); ctx.log?.('select', key);
    // 認識零件：點過飛控、電池、任一電機即完成單元任務
    if (['fc', 'battery'].every(k => visited.has(k)) && [...visited].some(k => k.startsWith('motor'))) ctx.task?.();
  };
  list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) select(li.dataset.k); });
  list.addEventListener('dragstart', e => { const li = e.target.closest('li'); if (li) e.dataTransfer.setData('text/plain', li.dataset.k); });
  const stageEl = $('#ta-stage');
  stageEl.addEventListener('dragover', e => { if (mode === 'build') e.preventDefault(); });
  stageEl.addEventListener('drop', e => { e.preventDefault(); install(e.dataTransfer.getData('text/plain')); });
  // 觸控裝置無法拖放：清單點選後再點畫面也可安裝
  stageEl.addEventListener('click', () => { if (mode === 'build' && selected && !placed.has(selected)) install(selected); });

  function install(key) {
    const p = parts.find(x => x.key === key); if (!p || placed.has(key)) return;
    placed.add(key); p.obj.visible = true; $('#ta-tip').textContent = `已安裝：${p.name}`;
    renderList();
    if (placed.size === parts.length) {
      $('#ta-tip').textContent = '組裝完成！';
      ctx.done?.({ completed: true, mode: 'build', parts: parts.length });
    }
  }

  // 3D 點選
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  st.renderer.domElement.addEventListener('pointerup', e => {
    if (mode !== 'learn') return;
    const r = st.renderer.domElement.getBoundingClientRect();
    ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ptr, st.camera);
    const hit = ray.intersectObjects(parts.map(p => p.obj), true)[0];
    if (hit) { let o = hit.object; while (o && !parts.find(p => p.obj === o)) o = o.parent; if (o) select(o.name); }
  });

  $('#ta-trans').onchange = e => { const m = quad.userData.shell.material; m.opacity = e.target.checked ? 0.18 : 0.95; m.depthWrite = !e.target.checked; };
  $('#ta-spin').onchange = e => { spin = e.target.checked; };
  $('#ta-tag').onchange = e => { tags.visible = e.target.checked; };
  $('#ta-exp').oninput = e => { explode = e.target.value / 100; };
  $('#ta-learn').onclick = () => { mode = 'learn'; parts.forEach(p => { placed.add(p.key); p.obj.visible = true; }); $('#ta-learn').classList.add('on'); $('#ta-build').classList.remove('on'); renderList(); };
  $('#ta-build').onclick = () => {
    mode = 'build'; placed.clear(); placed.add('frame');   // 機架先放好，其餘零件拖進來
    parts.forEach(p => { p.obj.visible = placed.has(p.key); });
    $('#ta-exp').value = 0; explode = 0;
    $('#ta-build').classList.add('on'); $('#ta-learn').classList.remove('on');
    $('#ta-tip').textContent = '把右側清單的零件拖到 3D 畫面（手機：點零件再點畫面）'; renderList();
  };

  st.onFrame(dt => {
    parts.forEach(p => {
      p.obj.position.lerpVectors(p.home, p.explode, explode);
      p.tag.position.copy(p.obj.position).add(new THREE.Vector3(0, 0.16, 0));
      p.tag.visible = p.obj.visible;
    });
    if (spin) spinProps(quad, dt, 0.6);
  });
  renderList();
  ctx.onReset = () => { $('#ta-learn').onclick(); visited.clear(); };
  return () => st.dispose();
}
