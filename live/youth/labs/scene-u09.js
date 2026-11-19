// U09 基礎懸停：第三人稱站位 3D 演示場景（全部程式生成，自製模型）
// 學生人物站在機尾後方、手持遙控器面向飛機；起降墊有橙色起降參考線、藍色懸停容差框；無人機有黑色鏡頭與紅箭頭標示機頭。
// setTime(t) 依時間軸決定飛機高度與螺旋槳轉速；數值（身高、距離、容差、懸停高度）全部來自內容檔 spec。
import { THREE, makeStage, buildQuad, spinProps, label } from './three-kit.js';

const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);

export function createU09Scene(host, demo) {
  const st = makeStage(host, { bg: 0xe4f0ff, cam: [2.6, 2.2, 3.8], target: [0, 0.9, 0.7], grid: false });
  const { scene } = st;
  const H = demo.hoverHeight, S = demo.student, TOL = demo.tolerance;

  // 地面與格線
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: 0xf4f7fb }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const grid = new THREE.GridHelper(16, 32, 0xc9d6ea, 0xdfe7f3); grid.position.y = 0.001; scene.add(grid);

  // 起降墊（白底藍框）＋橙色起降參考線（十字與外圈）
  const pad = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 1.2), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  pad.position.y = 0.01; scene.add(pad);
  const lines = (pts, color, y = 0.025) => { const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p[0], y, p[1]))); scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color }))); };
  lines([[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6], [-0.6, -0.6]], 0x2f6bf0);
  lines([[-1.6, 0], [1.6, 0]], 0xff8a00); lines([[0, -1.6], [0, 1.6]], 0xff8a00);
  const ring = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; ring.push([Math.cos(a) * 0.45, Math.sin(a) * 0.45]); } lines(ring, 0xff8a00);
  // 藍色懸停容差框（高度 ±TOL.h、水平 ±TOL.xy）
  const tolGeo = new THREE.BoxGeometry(TOL.xy * 2, TOL.h * 2, TOL.xy * 2);
  const tolBox = new THREE.Mesh(tolGeo, new THREE.MeshBasicMaterial({ color: 0x2f8cff, transparent: true, opacity: 0.12, depthWrite: false }));
  tolBox.position.y = H; scene.add(tolBox);
  const tolEdge = new THREE.LineSegments(new THREE.EdgesGeometry(tolGeo), new THREE.LineBasicMaterial({ color: 0x2f6bf0 }));
  tolEdge.position.y = H; scene.add(tolEdge);

  // 無人機：機頭朝 -z；黑色鏡頭＋紅色箭頭
  const drone = buildQuad({ scale: 0.3 }); scene.add(drone);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.12, 0.14), new THREE.MeshStandardMaterial({ color: 0x111111 }));
  cam.position.set(0, 0.12, -0.42); drone.add(cam);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0xff3355 }));
  arrow.rotation.x = -Math.PI / 2; arrow.position.set(0, 0.32, -0.3); drone.add(arrow);
  // 高度垂直參考線
  const hLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]);
  const hLine = new THREE.Line(hLineGeo, new THREE.LineDashedMaterial({ color: 0x2f6bf0, dashSize: 0.05, gapSize: 0.04 }));
  hLine.computeLineDistances(); scene.add(hLine);

  // 學生人物：站在機尾後方 S.behind 公尺，面向 -z，雙手持遙控器
  const kid = new THREE.Group(); const h = S.height;
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0 }), shirt = new THREE.MeshStandardMaterial({ color: 0x2f6bf0 }), pants = new THREE.MeshStandardMaterial({ color: 0x24324d });
  const legH = h * 0.47, bodyH = h * 0.3, headR = h * 0.075;
  for (const x of [-0.09, 0.09]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, legH, 12), pants); leg.position.set(x, legH / 2, 0); kid.add(leg); }
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, bodyH, 16), shirt); body.position.y = legH + bodyH / 2; kid.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 20, 16), skin); head.position.y = legH + bodyH + headR * 1.2; kid.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(headR * 1.03, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2b2b2b })); hair.position.copy(head.position); kid.add(hair);
  for (const x of [-0.17, 0.17]) { const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 10), shirt); arm.position.set(x * 0.85, legH + bodyH * 0.62, -0.13); arm.rotation.x = Math.PI / 2.6; kid.add(arm); }
  const rc = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.14), new THREE.MeshStandardMaterial({ color: 0x333a45 })); rc.position.set(0, legH + bodyH * 0.45, -0.3); rc.rotation.x = -0.5; kid.add(rc);
  kid.position.set(0, 0, S.behind); scene.add(kid);
  const hTag = label(`學生身高 ${h.toFixed(2)} m`, { size: 0.13 }); hTag.position.set(0.55, h + 0.05, S.behind); scene.add(hTag);
  // 學生到機尾的距離標示（地面虛線）
  const dGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0.35, 0.03, 0), new THREE.Vector3(0.35, 0.03, S.behind)]);
  const dLine = new THREE.Line(dGeo, new THREE.LineDashedMaterial({ color: 0x555555, dashSize: 0.08, gapSize: 0.05 })); dLine.computeLineDistances(); scene.add(dLine);
  const dTag = label(`機尾後方 ${S.behind.toFixed(2)} m`, { size: 0.11 }); dTag.position.set(0.75, 0.12, S.behind / 2); scene.add(dTag);
  const noseTag = label('機頭', { size: 0.1, color: '#c0123d' }); scene.add(noseTag);

  // 依時間計算飛機狀態
  const P = demo.phases, T = demo.durationSec;
  const phaseAt = t => { let i = 0; P.forEach((p, k) => { if (t >= p.t) i = k; }); return i; };
  const yAt = t => {
    const tk = P[1].t, hv = P[2].t, ds = P[3].t, dz = P[4].t;
    if (t < tk) return 0;
    if (t < hv) return H * ease((t - tk) / (hv - tk));
    if (t < ds) return H + Math.sin(t * 0.9) * TOL.h * 0.35;
    if (t < dz - 4) return H * (1 - ease((t - ds) / (dz - 4 - ds)));
    return 0;
  };
  let tNow = 0, view = 'three';
  const state = { y: 0, phase: 0, x: 0, z: 0 };
  function setTime(t) {
    tNow = Math.max(0, Math.min(T, t));
    state.phase = phaseAt(tNow); state.y = yAt(tNow);
    const hov = state.phase === 2;
    state.x = hov ? Math.sin(tNow * 0.6) * TOL.xy * 0.4 : 0; state.z = hov ? Math.cos(tNow * 0.45) * TOL.xy * 0.3 : 0;
    drone.position.set(state.x, state.y + 0.03, state.z);
    drone.rotation.z = hov ? Math.sin(tNow * 0.6) * 0.04 : 0;
    hLine.scale.y = Math.max(0.001, state.y); hLine.position.set(state.x, 0, state.z);
    noseTag.position.set(state.x, state.y + 0.35, state.z - 0.55);
    return state;
  }
  const spinSpeed = () => (state.phase === 0 && tNow > 3 ? 0.15 : state.phase === 4 && tNow > P[4].t + 3 ? 0 : state.phase === 0 ? 0 : 0.9);
  st.onFrame(dt => {
    spinProps(drone, dt, spinSpeed());
    if (view === 'nose') { st.camera.position.set(state.x + 0.5, state.y + 0.35, state.z - 1.3); st.controls.target.set(state.x, state.y + 0.05, state.z); }
  });
  function setView(v) {
    view = v === 'reset' ? 'three' : v;
    st.controls.enabled = view !== 'nose';
    const V = { three: [[2.6, 2.2, 3.8], [0, 0.9, 0.7]], top: [[0, 6.5, 0.9], [0, 0, 0.9]], side: [[4.6, 1.3, 0.9], [0, 0.9, 0.9]] };
    if (V[view]) { st.camera.position.set(...V[view][0]); st.controls.target.set(...V[view][1]); }
  }
  setTime(0);
  return { setTime, setView, state, phaseAt, dispose: () => st.dispose() };
}
