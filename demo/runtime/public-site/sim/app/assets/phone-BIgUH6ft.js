import"./modulepreload-polyfill-B5Qt9EMX.js";import{a as g,I as b,w as h,p as m}from"./simlink-client-CHQYWG8h.js";function x(t,e,o,i=.06){if(o<=0)return{x:0,y:0};let n=t/o,c=-e/o;const d=Math.hypot(n,c);d>1&&(n/=d,c/=d);const r=s=>Math.abs(s)<=i?0:Math.sign(s)*(Math.abs(s)-i)/(1-i);return{x:r(n),y:r(c)}}function y(t,e){return{roll:e.x,pitch:e.y,yaw:t.x,throttle:Math.min(1,Math.max(0,.5+t.y*.5))}}const f=document.getElementById("phone");f.innerHTML=`
<style>
  html,body{margin:0;height:100%;background:#06111f;color:#e6f6ff;font-family:system-ui,"PingFang TC","Microsoft JhengHei",sans-serif;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none}
  #phone{position:fixed;inset:0;display:flex;flex-direction:column}
  .bar{display:flex;align-items:center;gap:10px;padding:10px 14px;font-size:14px;background:#0b1b2e;border-bottom:1px solid #1fb8ff33}
  .dot{width:10px;height:10px;border-radius:50%;background:#888}
  .bar[data-s="connected"] .dot{background:#2ee59d;box-shadow:0 0 10px #2ee59d}
  .bar[data-s="error"] .dot{background:#ff5d5d}
  .pads{flex:1;display:flex}
  .pad{flex:1;position:relative;display:grid;place-items:center}
  .ring{width:min(42vw,42vh,240px);aspect-ratio:1;border-radius:50%;border:2px solid #1fb8ff66;background:radial-gradient(circle,#0e2a44 0%,#081626 70%);position:relative}
  .knob{position:absolute;left:50%;top:50%;width:34%;aspect-ratio:1;margin:-17% 0 0 -17%;border-radius:50%;background:radial-gradient(circle at 35% 30%,#5fd4ff,#0a7bc0);box-shadow:0 0 18px #1fb8ff88}
  .cap{position:absolute;bottom:10px;left:0;right:0;text-align:center;font-size:12px;color:#8fb4cc}
  .rotate{display:none;position:fixed;inset:0;background:#06111fee;place-items:center;text-align:center;font-size:18px;padding:24px}
  @media (orientation:portrait){.rotate{display:grid}}
</style>
<div class="bar" data-s="connecting"><span class="dot"></span><b data-msg>正在配對…</b></div>
<div class="pads">
  <div class="pad" data-pad="left"><div class="ring"><div class="knob"></div></div><div class="cap">左：上升／下降・左轉／右轉</div></div>
  <div class="pad" data-pad="right"><div class="ring"><div class="knob"></div></div><div class="cap">右：前進／後退・左移／右移</div></div>
</div>
<div class="rotate">請把手機<b>橫放</b>，用兩個拇指操作 📱↔️</div>`;const v=f.querySelector(".bar"),w=f.querySelector("[data-msg]"),a=(t,e)=>{v.dataset.s=t,w.textContent=e},p={left:{x:0,y:0},right:{x:0,y:0}};for(const t of["left","right"]){const e=f.querySelector(`[data-pad="${t}"]`),o=e.querySelector(".ring"),i=e.querySelector(".knob");let n=null;const c=r=>{const s=o.getBoundingClientRect(),l=s.width/2,u=x(r.clientX-(s.left+l),r.clientY-(s.top+l),l*.8);p[t]=u,i.style.transform=`translate(${u.x*l*.8}px, ${-u.y*l*.8}px)`},d=r=>{r.pointerId===n&&(n=null,p[t]={x:0,y:0},i.style.transform="")};e.addEventListener("pointerdown",r=>{if(n===null){n=r.pointerId;try{e.setPointerCapture(r.pointerId)}catch{}c(r)}}),e.addEventListener("pointermove",r=>{r.pointerId===n&&c(r)}),e.addEventListener("pointerup",d),e.addEventListener("pointercancel",d)}async function k(){const t=new URLSearchParams(location.search).get("code")?.trim();if(!t)return a("error","缺少配對碼：請用手機相機掃模擬器上的 QR 碼。");let e;try{const n=await fetch(`${g()}/rooms/${encodeURIComponent(t)}/offer`,{credentials:"omit",cache:"no-store"});if(n.status===404)return a("error","配對碼已過期，請在模擬器按「重新產生」後再掃一次。");if(n.status===409)return a("error","這個配對碼已被其他手機使用。");if(!n.ok)throw new Error(String(n.status));e=(await n.json()).offer}catch{return a("error","連不到配對服務：教學主機可能離線。")}const o=new RTCPeerConnection({iceServers:b});o.ondatachannel=n=>S(n.channel),o.onconnectionstatechange=()=>{o.connectionState==="failed"&&a("error","連不上筆電：請確認手機和筆電連同一個 Wi‑Fi（或用手機熱點）。"),o.connectionState==="disconnected"&&a("error","連線中斷，請在模擬器重新配對。")},await o.setRemoteDescription(e),await o.setLocalDescription(await o.createAnswer()),await h(o);const i=await m(`${g()}/rooms/${encodeURIComponent(t)}/answer`,{answer:o.localDescription});if(!i.ok)return a("error",i.status===409?"這個配對碼已被其他手機使用。":"配對失敗，請重新掃碼。");a("connecting","已送出配對，等待筆電連線…")}function S(t){let e=0,o=0;t.onopen=()=>{a("connected","已連線：橫放手機，用兩個拇指飛行"),navigator.wakeLock?.request("screen").catch(()=>{}),o=window.setInterval(()=>{if(t.readyState!=="open")return;const i={t:"sticks",n:e++,...y(p.left,p.right)};t.send(JSON.stringify(i))},33)},t.onclose=()=>{clearInterval(o),a("error","連線已關閉，請在模擬器重新配對。")}}k();
