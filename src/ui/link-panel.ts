/**
 * 「連線方式」面板（2026-11-07）
 *
 * 四種操作方式都在這裡切換：
 *   - 鍵盤（預設）：W/S 前後、A/D 左右、Q/E 轉向、R/F 升降
 *   - 實體遙控器：USB 插上後撥一下搖桿就會自動接手（沿用既有校正精靈）
 *   - 原子筆（鏡頭）：點畫面上的筆尖選色，筆移動＝右搖桿
 *   - 手機遙控器：產生配對 QR 碼，手機掃碼後用雙拇指操作
 * 優先順序：實體遙控器 → 手機 → 原子筆 → 鍵盤（前者有訊號就由前者控制）。
 */
import qrcode from '../vendor/qrcode-generator.js';
import type { PenCameraInputAdapter, PenState } from '../input/adapters/PenCameraInputAdapter';
import type { PhoneLinkInputAdapter, PhoneState } from '../input/adapters/PhoneLinkInputAdapter';
import type { HandGestureInputAdapter, GestureState } from '../input/adapters/HandGestureInputAdapter';

export interface LinkPanelOptions {
  root: HTMLElement;
  pen: PenCameraInputAdapter;
  phone: PhoneLinkInputAdapter;
  /** 手勢搖桿（可選） */
  gesture?: HandGestureInputAdapter;
}

const PEN_TEXT: Record<PenState['status'], string> = {
  off: '鏡頭未開啟',
  starting: '正在開啟鏡頭…',
  'need-color': '請在畫面上「點一下」有顏色的筆蓋或筆尖',
  tracking: '追蹤中：移動筆尖＝右搖桿（R/F 升降、Q/E 轉向）',
  lost: '看不到筆：已自動懸停，請把筆移回畫面',
  error: '鏡頭無法使用',
};

const GESTURE_TEXT: Record<GestureState['status'], string> = {
  off: '鏡頭未開啟',
  loading: '正在載入手部辨識模型…',
  'no-hand': '請把手伸到鏡頭前（手掌張開）',
  tracking: '追蹤中：手掌移動＝右搖桿（雙手時左手＝升降與轉向）',
  fist: '握拳：懸停中（張開手即可繼續）',
  error: '手勢無法使用',
};

const PHONE_TEXT: Record<PhoneState['status'], string> = {
  off: '尚未配對',
  creating: '正在產生配對碼…',
  waiting: '請用手機相機掃描 QR 碼（3 分鐘內有效）',
  connecting: '手機已回應，正在直連…',
  connected: '已連線：手機橫放，用兩個拇指操作',
  lost: '手機已斷線',
  error: '配對失敗',
};

/** 把網址畫成 QR 碼（白底黑點、四周留白，手機才好掃） */
export function drawQr(canvas: HTMLCanvasElement, text: string, scale = 5): void {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  const size = (n + margin * 2) * scale;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
  }
}

/**
 * 在沒有控制列的頁面（考場模式）加一顆浮動的「🔗 連線方式」按鈕＋面板。
 * 回傳清除函式。
 */
export function mountFloatingLinkPanel(pen: PenCameraInputAdapter, phone: PhoneLinkInputAdapter, gesture?: HandGestureInputAdapter): () => void {
  const panel = new LinkPanel({ root: document.body, pen, phone, gesture });
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '🔗 連線方式';
  btn.setAttribute('data-action', 'open-link');
  btn.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:49;padding:8px 14px;border-radius:10px;border:1px solid #2fb4ff;background:#0f2b44e6;color:#e6f6ff;font-size:14px;cursor:pointer';
  btn.addEventListener('click', () => panel.toggle());
  document.body.appendChild(btn);
  return () => {
    pen.disconnect();
    phone.disconnect();
    gesture?.disconnect();
    panel.el.remove();
    btn.remove();
  };
}

export class LinkPanel {
  readonly el: HTMLElement;
  private readonly overlay: HTMLCanvasElement;
  private gOverlay: HTMLCanvasElement | null = null;
  private raf = 0;

  constructor(private readonly opts: LinkPanelOptions) {
    const el = document.createElement('aside');
    el.className = 'link-panel';
    el.hidden = true;
    el.setAttribute('aria-label', '連線方式');
    el.innerHTML = `
<style>
  .link-panel{position:fixed;right:12px;top:12px;bottom:12px;width:min(360px,calc(100vw - 24px));overflow:auto;z-index:50;
    background:#0b1520f2;color:#e6f2fa;border:1px solid #2fb4ff55;border-radius:14px;padding:14px 16px;font-size:14px;box-shadow:0 10px 40px #0008}
  .link-panel h2{margin:0 0 8px;font-size:17px;display:flex;justify-content:space-between;align-items:center}
  .link-panel h3{margin:14px 0 6px;font-size:15px;color:#5fd4ff}
  .link-panel p{margin:4px 0;line-height:1.6;color:#b9cfdd}
  .link-panel button{padding:6px 12px;border-radius:8px;border:1px solid #2fb4ff;background:#0f2b44;color:#e6f6ff;cursor:pointer;margin:4px 6px 4px 0}
  .link-panel .stage{position:relative;width:100%;aspect-ratio:4/3;background:#000;border-radius:10px;overflow:hidden;margin-top:6px;cursor:crosshair}
  .link-panel video,.link-panel .stage canvas{position:absolute;inset:0;width:100%;height:100%;transform:scaleX(-1);object-fit:cover}
  .link-panel .status{font-weight:700;color:#e6f6ff}
  .link-panel .err{color:#ff8a8a}
  .link-panel .qr{display:block;margin:8px auto;width:200px;height:200px;image-rendering:pixelated;border-radius:6px}
  .link-panel .code{text-align:center;font:700 22px/1.2 ui-monospace,Consolas,monospace;letter-spacing:4px}
  .link-panel .url{word-break:break-all;font-size:12px;color:#8fb4cc;text-align:center}
  .link-panel label[data-pen-depth]{display:flex;align-items:center;gap:6px;margin:4px 0;cursor:pointer}
  .link-panel label[data-pen-depth][hidden]{display:none}
  .link-panel label[data-pen-dual]{display:flex;align-items:flex-start;gap:6px;margin:4px 0;cursor:pointer}
  .link-panel label[data-pen-dual][hidden]{display:none}
  .link-panel kbd{background:#1b3248;border-radius:4px;padding:0 5px;font-family:inherit}
</style>
<h2>連線方式 <button type="button" data-close aria-label="關閉">✕</button></h2>
<p>優先順序：實體遙控器 → 手機 → 手勢 → 原子筆 → 鍵盤。</p>

<h3>⌨️ 鍵盤（預設）</h3>
<p><kbd>W</kbd><kbd>S</kbd> 前後、<kbd>A</kbd><kbd>D</kbd> 左右、<kbd>Q</kbd><kbd>E</kbd> 轉向、<kbd>R</kbd><kbd>F</kbd> 升降</p>

<h3>🎮 實體遙控器（USB）</h3>
<p>用 USB 線把遙控器接上電腦（模擬器模式），撥一下搖桿就會自動接手；第一次使用請照畫面完成校正。</p>

<h3>🖊️ 原子筆搖桿（筆電鏡頭）</h3>
<p>拿一支<b>筆蓋有顏色</b>的筆（紅、藍、綠最好）。開鏡頭後在畫面上點一下筆蓋，筆往上下左右移就是右搖桿。影像只在本機計算，不錄影、不上傳。</p>
<button type="button" data-pen="toggle">開啟鏡頭</button>
<button type="button" data-pen="center" hidden>設為中心</button>
<button type="button" data-pen="color" hidden>重新選色</button>
<label data-pen-depth hidden><input type="checkbox" data-pen="depth"> 遠近控油門（筆靠近＝上升）</label>
<label data-pen-dual hidden><input type="checkbox" data-pen="dual"> <span>雙筆四軸：左手再拿一支<b>不同顏色</b>的筆（上下＝升降、左右＝轉向）</span></label>
<div class="stage" data-pen-stage hidden></div>
<p class="status" data-pen-status>${PEN_TEXT.off}</p>

<h3>✋ 手勢搖桿（筆電鏡頭）</h3>
<p>不用筆，直接對鏡頭伸手：手掌移動＝前後左右；兩隻手時左手上下＝升降、左右＝轉向；<b>握拳＝懸停</b>。第一次開啟會下載約 17MB 的手部辨識模型。影像只在本機計算，不上傳。</p>
<button type="button" data-gesture="toggle">開啟手勢</button>
<button type="button" data-gesture="center" hidden>設為中心</button>
<div class="stage" data-gesture-stage hidden></div>
<p class="status" data-gesture-status>${GESTURE_TEXT.off}</p>

<h3>📱 手機遙控器</h3>
<p>手機和筆電連<b>同一個 Wi‑Fi</b>（或筆電連手機熱點）。按下面按鈕，用手機相機掃 QR 碼。手機頁上方可開「體感」：傾斜手機＝前後左右。</p>
<button type="button" data-phone="pair">產生配對 QR 碼</button>
<button type="button" data-phone="stop" hidden>中斷手機</button>
<div data-phone-qr hidden><canvas class="qr"></canvas><div class="code" data-phone-code></div><div class="url" data-phone-url></div></div>
<p class="status" data-phone-status>${PHONE_TEXT.off}</p>`;
    opts.root.appendChild(el);
    this.el = el;
    // 手勢：鏡頭畫面＋關鍵點標示；與原子筆共用鏡頭，開一個就關另一個
    if (opts.gesture) {
      const g = opts.gesture;
      const gStage = el.querySelector<HTMLElement>('[data-gesture-stage]')!;
      gStage.appendChild(g.video);
      this.gOverlay = document.createElement('canvas');
      this.gOverlay.width = 320;
      this.gOverlay.height = 240;
      gStage.appendChild(this.gOverlay);
      g.onState = (s) => this.renderGesture(s);
      el.querySelector('[data-gesture="toggle"]')!.addEventListener('click', () => {
        if (g.state().status === 'off' || g.state().status === 'error') {
          opts.pen.disconnect();
          void g.connect();
        } else g.disconnect();
      });
      el.querySelector('[data-gesture="center"]')!.addEventListener('click', () => g.recenter());
    } else {
      el.querySelectorAll<HTMLElement>('[data-gesture], [data-gesture-stage], [data-gesture-status]').forEach((n) => (n.hidden = true));
    }
    // 轉接器的狀態變化直接更新本面板
    opts.pen.onState = (s) => this.renderPen(s);
    opts.phone.onState = (s) => this.renderPhone(s);

    const stage = el.querySelector<HTMLElement>('[data-pen-stage]')!;
    stage.appendChild(opts.pen.video);
    this.overlay = document.createElement('canvas');
    this.overlay.width = 320;
    this.overlay.height = 240;
    stage.appendChild(this.overlay);
    // 畫面是鏡像顯示：點擊位置要換回「原始影像」座標
    stage.addEventListener('click', (ev) => {
      const r = stage.getBoundingClientRect();
      opts.pen.pickColorAt(1 - (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    });

    el.querySelector('[data-close]')!.addEventListener('click', () => this.toggle(false));
    el.querySelector('[data-pen="toggle"]')!.addEventListener('click', () => {
      if (opts.pen.state().status === 'off' || opts.pen.state().status === 'error') {
        opts.gesture?.disconnect();
        void opts.pen.connect();
      }
      else opts.pen.disconnect();
    });
    el.querySelector('[data-pen="center"]')!.addEventListener('click', () => opts.pen.recenter());
    el.querySelector('[data-pen="color"]')!.addEventListener('click', () => opts.pen.resetColor());
    el.querySelector<HTMLInputElement>('[data-pen="depth"]')!.addEventListener('change', (ev) => {
      opts.pen.depthThrottle = (ev.target as HTMLInputElement).checked;
      opts.pen.recenter();
    });
    el.querySelector<HTMLInputElement>('[data-pen="dual"]')!.addEventListener('change', (ev) => {
      opts.pen.setDual((ev.target as HTMLInputElement).checked);
    });
    el.querySelector('[data-phone="pair"]')!.addEventListener('click', () => void opts.phone.connect());
    el.querySelector('[data-phone="stop"]')!.addEventListener('click', () => opts.phone.disconnect());
  }

  toggle(show = this.el.hidden): void {
    this.el.hidden = !show;
    cancelAnimationFrame(this.raf);
    if (show) this.drawLoop();
  }

  /** 原子筆狀態更新（由轉接器回呼） */
  renderPen(s: PenState): void {
    const q = <T extends HTMLElement>(sel: string): T => this.el.querySelector<T>(sel)!;
    const on = s.status !== 'off' && s.status !== 'error';
    q('[data-pen="toggle"]').textContent = on ? '關閉鏡頭' : '開啟鏡頭';
    q('[data-pen-stage]').hidden = !on;
    q('[data-pen="center"]').hidden = s.status !== 'tracking' && s.status !== 'lost';
    q('[data-pen="color"]').hidden = !on || s.status === 'need-color';
    // 雙筆模式時升降轉向由左手筆負責，遠近控油門不適用
    q('[data-pen-depth]').hidden = !on || this.opts.pen.isDual;
    q('[data-pen-dual]').hidden = !on;
    const st = q('[data-pen-status]');
    st.textContent = s.message
      ? s.message
      : s.picking === 'left'
        ? '請在畫面上點一下「左手」那支筆的筆蓋'
        : s.left
          ? PEN_TEXT[s.status].replace('（R/F 升降、Q/E 轉向）', '；左手筆＝升降與轉向')
          : PEN_TEXT[s.status];
    st.classList.toggle('err', s.status === 'error' || s.status === 'lost');
  }

  /** 手勢狀態更新（由轉接器回呼） */
  renderGesture(s: GestureState): void {
    const q = <T extends HTMLElement>(sel: string): T => this.el.querySelector<T>(sel)!;
    const on = s.status !== 'off' && s.status !== 'error';
    q('[data-gesture="toggle"]').textContent = on ? '關閉手勢' : '開啟手勢';
    q('[data-gesture-stage]').hidden = !on || s.status === 'loading';
    q('[data-gesture="center"]').hidden = s.status !== 'tracking';
    const st = q('[data-gesture-status]');
    st.textContent = s.message || GESTURE_TEXT[s.status];
    st.classList.toggle('err', s.status === 'error' || s.status === 'no-hand');
  }

  /** 手機狀態更新（由轉接器回呼） */
  renderPhone(s: PhoneState): void {
    const q = <T extends HTMLElement>(sel: string): T => this.el.querySelector<T>(sel)!;
    const showQr = s.status === 'waiting' && !!s.url;
    q('[data-phone-qr]').hidden = !showQr;
    if (showQr && s.url) {
      drawQr(q<HTMLCanvasElement>('[data-phone-qr] canvas'), s.url);
      q('[data-phone-code]').textContent = s.code ?? '';
      q('[data-phone-url]').textContent = s.url;
      // QR 碼在面板下方，產生後自動捲到看得見的位置
      q('[data-phone-qr]').scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    q('[data-phone="pair"]').textContent = s.status === 'off' ? '產生配對 QR 碼' : '重新產生';
    q('[data-phone="stop"]').hidden = s.status === 'off';
    const st = q('[data-phone-status]');
    st.textContent = s.message || PHONE_TEXT[s.status];
    st.classList.toggle('err', s.status === 'error' || s.status === 'lost');
  }

  /** 手勢畫面：每隻手畫出骨架，掌心中立位置畫圈 */
  private drawGesture(): void {
    const g = this.opts.gesture;
    const ctx = this.gOverlay?.getContext('2d');
    if (!g || !ctx || !this.gOverlay) return;
    const { width: w, height: h } = this.gOverlay;
    ctx.clearRect(0, 0, w, h);
    const s = g.state();
    const bones = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12], [0, 13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];
    s.hands.forEach((hand) => {
      ctx.strokeStyle = s.status === 'fist' ? '#ffb347' : '#2ee59d';
      ctx.lineWidth = 2;
      for (const chain of bones) {
        ctx.beginPath();
        chain.forEach((i, k) => (k ? ctx.lineTo(hand[i].x * w, hand[i].y * h) : ctx.moveTo(hand[i].x * w, hand[i].y * h)));
        ctx.stroke();
      }
    });
    for (const n of [s.rightNeutral, s.leftNeutral]) {
      if (!n) continue;
      ctx.strokeStyle = '#5fd4ff';
      ctx.beginPath();
      ctx.arc(n.x * w, n.y * h, g.range * w, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** 畫一支筆的中心圈與目前位置（左手筆用） */
  private drawPen(
    ctx: CanvasRenderingContext2D,
    center: { x: number; y: number },
    blob: { x: number; y: number } | null,
    color: string,
    ok: boolean,
    w: number,
    h: number,
  ): void {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(center.x * w, center.y * h, this.opts.pen.range * w, 0, Math.PI * 2);
    ctx.stroke();
    if (blob) {
      ctx.fillStyle = ok ? color : '#ff5d5d';
      ctx.beginPath();
      ctx.arc(blob.x * w, blob.y * h, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 在鏡頭畫面上標出：中心十字、筆尖位置、目前搖桿方向 */
  private drawLoop = (): void => {
    this.raf = requestAnimationFrame(this.drawLoop);
    const ctx = this.overlay.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = this.overlay;
    ctx.clearRect(0, 0, w, h);
    this.drawGesture();
    const s = this.opts.pen.state();
    if (s.left?.center) this.drawPen(ctx, s.left.center, s.left.blob, '#ffb347', s.status === 'tracking', w, h);
    if (s.center) {
      const cx = s.center.x * w;
      const cy = s.center.y * h;
      ctx.strokeStyle = '#5fd4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, this.opts.pen.range * w, 0, Math.PI * 2);
      ctx.moveTo(cx - 10, cy);
      ctx.lineTo(cx + 10, cy);
      ctx.moveTo(cx, cy - 10);
      ctx.lineTo(cx, cy + 10);
      ctx.stroke();
    }
    if (s.blob) {
      ctx.fillStyle = s.status === 'tracking' ? '#2ee59d' : '#ff5d5d';
      ctx.beginPath();
      ctx.arc(s.blob.x * w, s.blob.y * h, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}
