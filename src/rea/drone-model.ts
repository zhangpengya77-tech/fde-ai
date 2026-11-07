/**
 * REA 考照模擬器：精緻無人機模型（2026-11-08）。
 *
 * 全部用 Three.js 基本幾何「程式建模」，不使用外部模型檔或他人美術素材：
 *  - 機身：上下兩片碳纖板（圓角）、外殼罩、電池（含綁帶）、飛控、GPS 天線桿
 *  - 機臂：碳纖圓管＋機臂座；機頭方向的兩支機臂套紅色識別套（業界慣例：紅色＝機頭）
 *  - 馬達：底座＋定子＋外轉子鐘罩＋槳帽
 *  - 槳葉：兩葉槳（翼形外型、略帶扭轉），相鄰馬達反向轉；高速時顯示半透明槳盤
 *  - 起落架：800 g 為短腳；4 kg 為 T 型滑橇；18 kg 為加寬滑橇＋機腹酬載（藥箱）
 *  - 航行燈：機頭白燈、機尾綠燈（閃爍），飛行時才亮
 * 尺寸依機型軸距（wheelbase）等比例放大，三種機型一眼看得出大小差別。
 * 座標：機頭方向為 -z（與 scene.ts 一致），y 向上，單位公尺。
 */

import * as THREE from 'three';
import type { Airframe } from './physics';

export interface DroneModel {
  group: THREE.Group;
  /** 會轉的槳葉組（每顆馬達一個），附帶轉向 dir = ±1 */
  props: { obj: THREE.Object3D; dir: number }[];
  /** 高速時的半透明槳盤 */
  discs: THREE.Mesh[];
  /** 會閃的尾燈 */
  blink: THREE.Mesh[];
  /** 起落架最低點到機身中心的距離（放到地面時要抬高這麼多） */
  lift: number;
  /** 槳葉直徑（公尺） */
  propDiameter: number;
}

/** 各機型的外觀規格（槳徑以軸距換算，接近真實常見搭配）。 */
export function modelSpec(af: Airframe): { propDiameter: number; gear: 'stub' | 'skid' | 'wide-skid'; payload: 'camera' | 'none' | 'tank'; gps: boolean } {
  switch (af.id) {
    case 'quad-800g':
      return { propDiameter: af.wheelbase * 0.5, gear: 'stub', payload: 'camera', gps: false }; // 約 7 吋槳
    case 'hexa-18kg':
      return { propDiameter: af.wheelbase * 0.42, gear: 'wide-skid', payload: 'tank', gps: true }; // 約 22 吋槳
    default:
      return { propDiameter: af.wheelbase * 0.42, gear: 'skid', payload: 'none', gps: true }; // 約 15 吋槳
  }
}

const mat = {
  carbon: () => new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.45, metalness: 0.3 }),
  shell: () => new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.35, metalness: 0.05 }),
  accent: () => new THREE.MeshStandardMaterial({ color: 0xd62839, roughness: 0.4 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0xb8c0c8, roughness: 0.25, metalness: 0.85 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6, metalness: 0.2 }),
  battery: () => new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.5 }),
  strap: () => new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  prop: () => new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, side: THREE.DoubleSide }),
};

/** 圓角矩形板（碳纖板、外殼用）。 */
function roundedPlate(w: number, d: number, t: number, r: number, m: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // 平放（厚度往上）
  g.translate(0, -t / 2, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  return mesh;
}

/** 一片槳葉：翼形外型（根部窄、中段寬、尖端收窄），長度 = 半徑。 */
function bladeGeometry(radius: number): THREE.BufferGeometry {
  const c = radius * 0.16; // 最寬處弦長
  const s = new THREE.Shape();
  s.moveTo(0, -c * 0.18);
  s.bezierCurveTo(radius * 0.25, -c * 0.6, radius * 0.6, -c * 0.55, radius * 0.97, -c * 0.12);
  s.quadraticCurveTo(radius, 0, radius * 0.97, c * 0.12);
  s.bezierCurveTo(radius * 0.6, c * 0.3, radius * 0.25, c * 0.35, 0, c * 0.18);
  s.lineTo(0, -c * 0.18);
  const g = new THREE.ExtrudeGeometry(s, { depth: radius * 0.012, bevelEnabled: false, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  return g;
}

export function buildDroneModel(af: Airframe): DroneModel {
  const spec = modelSpec(af);
  const W = af.wheelbase;
  const group = new THREE.Group();
  group.name = 'drone';
  const props: DroneModel['props'] = [];
  const discs: THREE.Mesh[] = [];
  const blink: THREE.Mesh[] = [];
  const add = (o: THREE.Object3D) => { o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).castShadow = true; }); group.add(o); return o; };

  // ---------- 機身 ----------
  const bodyW = W * 0.24, bodyD = W * 0.3, plateT = Math.max(0.003, W * 0.006);
  const gap = W * 0.055; // 上下板間距
  const bottom = add(roundedPlate(bodyW, bodyD, plateT, W * 0.04, mat.carbon()));
  bottom.position.y = -gap / 2;
  const top = add(roundedPlate(bodyW * 0.92, bodyD * 0.92, plateT, W * 0.04, mat.carbon()));
  top.position.y = gap / 2;
  // 支柱（四角）
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.006, W * 0.006, gap, 8), mat.metal());
    st.position.set(sx * bodyW * 0.36, 0, sz * bodyD * 0.38);
    add(st);
  }
  // 飛控（中間）
  const fc = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.38, gap * 0.45, bodyW * 0.38), mat.dark());
  add(fc);
  // 外殼罩（前低後高的流線型，機頭稍尖）
  const shellGeo = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const shell = new THREE.Mesh(shellGeo, mat.shell());
  shell.scale.set(bodyW * 0.47, gap * 1.15, bodyD * 0.5);
  shell.position.y = gap / 2 + plateT / 2;
  add(shell);
  // 機頭紅色識別條
  const nose = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.42, gap * 0.25, W * 0.012), mat.accent());
  nose.position.set(0, gap / 2 + gap * 0.25, -bodyD * 0.46);
  add(nose);
  // 電池（機身下方，含兩條綁帶）
  const batt = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.62, gap * 0.9, bodyD * 0.72), mat.battery());
  batt.position.y = -gap / 2 - plateT - gap * 0.45;
  add(batt);
  for (const sz of [-1, 1]) {
    const strap = new THREE.Mesh(new THREE.BoxGeometry(bodyW * 0.66, gap * 0.95, W * 0.012), mat.strap());
    strap.position.set(0, batt.position.y, sz * bodyD * 0.18);
    add(strap);
  }
  // GPS 天線桿（4 kg、18 kg）
  if (spec.gps) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.005, W * 0.005, W * 0.12, 8), mat.metal());
    mast.position.set(0, gap / 2 + gap * 1.1 + W * 0.06, bodyD * 0.22);
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.035, W * 0.035, W * 0.014, 20), mat.dark());
    puck.position.set(0, mast.position.y + W * 0.065, mast.position.z);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(W * 0.01, W * 0.025, 3), mat.shell());
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, puck.position.y + W * 0.008, puck.position.z - W * 0.012);
    add(mast); add(puck); add(arrow);
  }

  // ---------- 機臂、馬達、槳葉 ----------
  const n = af.rotors;
  const armLen = W / 2;
  const tubeR = Math.max(0.006, W * 0.014);
  const propR = spec.propDiameter / 2;
  const motorR = Math.max(0.01, W * 0.03);
  const motorH = motorR * 1.1;
  const blade = bladeGeometry(propR);
  for (let i = 0; i < n; i++) {
    const a = ((n === 4 ? 45 : 30) + (360 / n) * i) * (Math.PI / 180);
    const front = Math.cos(a) > 0.1;
    const dx = Math.sin(a), dz = -Math.cos(a);
    // 碳纖圓管機臂（從機身邊緣延伸到馬達）
    const start = bodyW * 0.3;
    const len = armLen - start;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, len, 12), mat.carbon());
    tube.rotation.z = Math.PI / 2;
    const armGroup = new THREE.Group();
    tube.position.x = start + len / 2;
    armGroup.add(tube);
    // 機臂夾座
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.05, tubeR * 3, tubeR * 3), mat.dark());
    clamp.position.x = start + W * 0.02;
    armGroup.add(clamp);
    // 機頭兩支機臂的紅色識別套
    if (front) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(tubeR * 1.15, tubeR * 1.15, len * 0.45, 12), mat.accent());
      sleeve.rotation.z = Math.PI / 2;
      sleeve.position.x = start + len * 0.62;
      armGroup.add(sleeve);
    }
    // 馬達座＋馬達（定子＋外轉子鐘罩）
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(motorR * 1.15, motorR * 1.15, tubeR * 1.2, 16), mat.dark());
    mount.position.set(armLen, tubeR * 1.4, 0);
    const stator = new THREE.Mesh(new THREE.CylinderGeometry(motorR * 0.85, motorR * 0.85, motorH * 0.4, 16), mat.dark());
    stator.position.set(armLen, tubeR * 2 + motorH * 0.2, 0);
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(motorR, motorR, motorH * 0.65, 20), mat.metal());
    bell.position.set(armLen, tubeR * 2 + motorH * 0.4 + motorH * 0.32, 0);
    armGroup.add(mount, stator, bell);
    // 機臂旋轉到正確方向（armGroup 的 +x 指向馬達）
    armGroup.rotation.y = Math.atan2(-dz, dx);
    add(armGroup);

    // 槳葉組（放在世界方向，方便獨立旋轉）
    const hubY = tubeR * 2 + motorH * 1.08;
    const prop = new THREE.Group();
    prop.position.set(dx * armLen, hubY, dz * armLen);
    const dir = i % 2 === 0 ? 1 : -1; // 相鄰馬達反向轉（扭力抵消）
    for (const k of [0, 1]) {
      const b = new THREE.Mesh(blade, mat.prop());
      b.rotation.y = k * Math.PI;
      b.rotation.x = dir * 0.12 * (k === 0 ? 1 : -1); // 槳距扭轉
      prop.add(b);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(motorR * 0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.metal());
    prop.add(cap);
    prop.rotation.y = i * 0.7;
    add(prop);
    props.push({ obj: prop, dir });
    // 高速時的半透明槳盤
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(propR, 32),
      new THREE.MeshBasicMaterial({ color: 0x1a1d22, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(dx * armLen, hubY + 0.002, dz * armLen);
    group.add(disc);
    discs.push(disc);

    // 航行燈（馬達座下方）：機頭白、機尾綠閃
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(0.006, W * 0.012), 10, 8),
      new THREE.MeshStandardMaterial({ color: front ? 0xffffff : 0x26d07c, emissive: front ? 0xffffff : 0x26d07c, emissiveIntensity: 0.2 }),
    );
    led.position.set(dx * armLen, -tubeR * 0.6, dz * armLen);
    group.add(led);
    if (!front) blink.push(led);
    else led.userData.front = true;
  }

  // ---------- 起落架 ----------
  const baseY = batt.position.y - gap * 0.45; // 電池底部
  let footY = baseY;
  if (spec.gear === 'stub') {
    // 800 g：四支短腳（機臂下方）
    for (let i = 0; i < 4; i++) {
      const a = (45 + 90 * i) * (Math.PI / 180);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.008, W * 0.012, W * 0.12, 8), mat.dark());
      leg.position.set(Math.sin(a) * W * 0.22, -W * 0.06, -Math.cos(a) * W * 0.22);
      add(leg);
    }
    footY = -W * 0.12;
  } else {
    // 4 kg／18 kg：T 型滑橇（兩支立管＋橫向滑橇＋端蓋）
    const wide = spec.gear === 'wide-skid';
    const legH = W * (wide ? 0.26 : 0.22);
    const half = W * (wide ? 0.2 : 0.15);
    const skidLen = W * (wide ? 0.55 : 0.42);
    const r = Math.max(0.006, W * 0.011);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(r, r, legH, 10), mat.carbon());
        // 從機身往外斜下
        leg.position.set(sx * half * 0.75, -gap / 2 - legH / 2, sz * skidLen * 0.28);
        leg.rotation.z = sx * 0.22;
        add(leg);
      }
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.1, r * 1.1, skidLen, 10), mat.carbon());
      skid.rotation.x = Math.PI / 2;
      skid.position.set(sx * half, -gap / 2 - legH, 0);
      add(skid);
      for (const sz of [-1, 1]) {
        const capEnd = new THREE.Mesh(new THREE.SphereGeometry(r * 1.6, 10, 8), mat.accent());
        capEnd.position.set(sx * half, -gap / 2 - legH, sz * skidLen / 2);
        add(capEnd);
      }
    }
    footY = -gap / 2 - legH - r;
  }

  // ---------- 酬載 ----------
  if (spec.payload === 'camera') {
    // 800 g：機頭下方小雲台相機
    const gimbal = new THREE.Mesh(new THREE.BoxGeometry(W * 0.06, W * 0.05, W * 0.05), mat.dark());
    gimbal.position.set(0, -gap / 2 - W * 0.03, -bodyD * 0.45);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.016, W * 0.016, W * 0.02, 16), mat.metal());
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, gimbal.position.y, gimbal.position.z - W * 0.03);
    add(gimbal); add(lens);
  } else if (spec.payload === 'tank') {
    // 18 kg：機腹白色藥箱（植保機常見外型）＋噴桿
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.09, W * 0.07, W * 0.16, 20), mat.shell());
    tank.position.set(0, baseY - W * 0.09, 0);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.03, W * 0.03, W * 0.015, 16), mat.accent());
    lid.position.set(0, tank.position.y + W * 0.085, 0);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.006, W * 0.006, W * 0.7, 8), mat.metal());
    boom.rotation.z = Math.PI / 2;
    boom.position.set(0, tank.position.y - W * 0.07, W * 0.06);
    add(tank); add(lid); add(boom);
    footY = Math.min(footY, tank.position.y - W * 0.08);
  }

  return { group, props, discs, blink, lift: -footY, propDiameter: spec.propDiameter };
}

/**
 * 每幀更新：槳葉旋轉、槳盤透明度、航行燈。
 * spin = 0（停槳）～1（懸停）以上；t = 秒（閃燈用）。
 */
export function animateDrone(m: DroneModel, spin: number, dt: number, t: number): void {
  const rate = spin * 70; // 弧度／秒（畫面上看起來的轉速，避免頻閃假象時用槳盤補）
  for (const p of m.props) p.obj.rotation.y += p.dir * rate * dt;
  const blur = Math.max(0, Math.min(0.22, (spin - 0.35) * 0.45));
  for (const d of m.discs) (d.material as THREE.MeshBasicMaterial).opacity = blur;
  const on = spin > 0.05;
  m.group.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (o.userData.front && mm) mm.emissiveIntensity = on ? 1.6 : 0.2;
  });
  for (const b of m.blink) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = on && Math.floor(t * 2) % 2 === 0 ? 1.8 : 0.15;
}
