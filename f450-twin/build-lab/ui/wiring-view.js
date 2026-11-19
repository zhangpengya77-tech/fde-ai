// 組裝實訓室｜接線模式畫面（俯視 2D 示意圖）
//
// 每個機型提供自己的版面（ui/layouts/*.js）：接點座標 points、零件位置 parts、短標籤 label()、底圖 drawStatic()。
// 這個模組只負責共用的部分：畫已接好的線、標出目前步驟的來源與（學習模式）目標、把點選轉成接法交給引擎。
// 判定一律交給 wiring-engine／wiring-rules。

const NS = 'http://www.w3.org/2000/svg';
const WIRE_COLOR = { power: '#d23b3b', signal: '#e0a800', data: '#1f6fd1', phase: '#6b7785' };

export function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

/**
 * @param {object} o { root, wiring, layout, mode: () => string, onAttempt(choice) }
 */
export function createWiringView(o) {
  const { root, wiring, layout } = o;
  const { points: POINTS, parts: PARTS } = layout;
  const svg = el('svg', { viewBox: '0 0 1000 700', class: 'bl-wsvg', role: 'img', 'aria-label': '接線示意圖（俯視，機頭朝上）' });
  root.replaceChildren(svg);
  // 放大倍率：手機螢幕窄，預設放大 2.2 倍，並自動捲到這一步的位置；電腦預設 1 倍（整張圖）
  const ZOOMS = [1, 1.6, 2.2, 3];
  let zoom = matchMedia('(max-width: 819px)').matches ? 2.2 : 1;
  function applyZoom() {
    svg.style.width = `${zoom * 100}%`;
    svg.style.height = 'auto';
    root.classList.toggle('is-zoomed', zoom > 1);
  }
  applyZoom();
  layout.drawStatic(svg, el);
  const wireLayer = el('g');
  const hotLayer = el('g');
  svg.append(wireLayer, hotLayer);   // 線與接點畫在最上層

  function hotspot(id, isTarget) {
    const [x, y] = POINTS[id];
    const g = el('g', { class: `bl-hot ${isTarget ? 'is-target' : ''}`, 'data-point': id, tabindex: 0, role: 'button', 'aria-label': wiring.catalog[id].nameZh });
    g.append(el('circle', { cx: x, cy: y, r: 11 }));
    const lb = layout.label(id, wiring.catalog);
    if (lb) g.append(el('text', { x: lb.x, y: lb.y, 'text-anchor': 'middle', class: `bl-wlabel ${lb.dark ? 'bl-wlabel-dark' : ''}` }, lb.text));
    return g;
  }

  function render() {
    const step = wiring.current;
    hotLayer.replaceChildren();
    wireLayer.replaceChildren();
    // 已接好的線
    for (const d of wiring.connections) {
      const s = wiring.steps.find((x) => x.id === d.stepId);
      const [fx, fy] = PARTS[s.fromPart];
      if (s.kind === 'polarity') {
        const [rx, ry] = POINTS[s.expect.red];
        const [bx, by] = POINTS[s.expect.black];
        // 電源：紅／黑；序列埠：黃（TX）／藍（RX）
        const [c1, c2] = s.pair === 'uart' ? ['#e0a800', '#1f6fd1'] : ['#d23b3b', '#111'];
        wireLayer.append(el('line', { x1: fx - 3, y1: fy, x2: rx, y2: ry, stroke: c1, 'stroke-width': 3 }));
        wireLayer.append(el('line', { x1: fx + 3, y1: fy, x2: bx, y2: by, stroke: c2, 'stroke-width': 3 }));
      } else {
        const target = d.choice?.target || s.expect;
        const [tx, ty] = POINTS[target];
        wireLayer.append(el('line', { x1: fx, y1: fy, x2: tx, y2: ty, stroke: WIRE_COLOR[s.wireType], 'stroke-width': s.kind === 'phase' ? 5 : 2.5, 'stroke-dasharray': s.wireType === 'data' ? '7 4' : '' }));
      }
    }
    // 目前步驟：線的來源零件
    if (step) {
      const [fx, fy] = PARTS[step.fromPart];
      hotLayer.append(el('circle', { cx: fx, cy: fy, r: 26, class: 'bl-src' }));
    }
    // 接點；學習模式標出這一步要接的位置與步驟編號
    const showTarget = step && o.mode() === 'learn';
    let focusId = null;   // 放大時要捲到的接點
    for (const id of Object.keys(POINTS)) {
      const isTarget = showTarget && (step.kind === 'polarity' ? id === step.expect.red : (step.accept || [step.expect]).includes(id));
      const g = hotspot(id, isTarget);
      if (isTarget) {
        const [x, y] = POINTS[id];
        g.append(el('text', { x: x + 15, y: y - 12, class: 'bl-wnum' }, String(wiring.progress.done + 1)));
        focusId = id;
      }
      hotLayer.append(g);
    }
    if (zoom > 1 && step) scrollToStep(focusId, step);
  }

  /** 放大時把「來源零件與目標接點的中間」捲到畫面中央（考試模式沒有目標，就只捲到來源零件） */
  function scrollToStep(targetId, step) {
    const src = PARTS[step.fromPart];
    const tgt = targetId ? POINTS[targetId] : src;
    const cx = (src[0] + tgt[0]) / 2;
    const cy = (src[1] + tgt[1]) / 2;
    const w = svg.clientWidth;
    const h = svg.clientHeight;
    root.scrollTo({ left: (cx / 1000) * w - root.clientWidth / 2, top: (cy / 700) * h - root.clientHeight / 2, behavior: 'smooth' });
  }

  /** 調整放大倍率：dir = +1 放大、-1 縮小、0 回到整張圖 */
  function setZoom(dir) {
    const i = ZOOMS.indexOf(zoom);
    zoom = dir === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
    applyZoom();
    render();
    return zoom;
  }

  function pick(id) {
    const step = wiring.current;
    if (!step || !id) return;
    o.onAttempt(step.kind === 'polarity' ? { red: id } : { target: id });
  }
  svg.addEventListener('click', (e) => pick(e.target.closest('[data-point]')?.dataset.point));
  svg.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(e.target.closest('[data-point]')?.dataset.point); } });

  return { render, setZoom, get zoom() { return zoom; } };
}
