// 組裝實訓室｜程式生成零件 3D 外形（自行設計的簡化幾何，不使用任何外部模型或第三方素材）
//
// 每個零件依資料檔的 shape 描述產生一個 THREE.Group，原點在零件中心，單位公釐。
// 外形只求「看得出是什麼、方向正確」，精確尺寸以資料檔 dimensionsMm 與來源表為準。
import * as THREE from 'three';

const matCache = new Map();
/** 共用材質（同色同參數只建一次，降低記憶體） */
function mat(color, opts = {}) {
  const key = `${color}|${opts.metal || 0}|${opts.rough ?? 0.6}`;
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, metalness: opts.metal || 0, roughness: opts.rough ?? 0.6 }));
  }
  return matCache.get(key);
}

function box(w, h, d, color, opts) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
}
function cyl(r, h, color, opts, seg = 28) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat(color, opts));
}
function at(obj, x, y, z) { obj.position.set(x, y, z); return obj; }

/** 平面上的箭頭（指向 −Z＝機頭），貼在零件頂面 */
function arrow(len, width, color, y) {
  const s = new THREE.Shape();
  // 箭頭尖端在 Shape 的 +Y；繞 X 軸轉 −90° 平躺後，Shape 的 +Y 會變成 −Z（機頭方向）
  s.moveTo(0, len / 2); s.lineTo(width / 2, 0); s.lineTo(width / 5, 0); s.lineTo(width / 5, -len / 2);
  s.lineTo(-width / 5, -len / 2); s.lineTo(-width / 5, 0); s.lineTo(-width / 2, 0); s.closePath();
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

const BUILDERS = {
  // 中心板；pads=true 時畫出分電板的正負極焊盤（紅＝正、黑＝負）
  plate(s) {
    const g = new THREE.Group();
    g.add(box(s.w, s.t, s.d, s.color, { rough: 0.8 }));
    if (s.pads) {
      for (const [x, z] of [[1, -1], [-1, -1], [-1, 1], [1, 1]]) {
        g.add(at(box(9, 0.6, 6, '#c9302c', { metal: 0.6 }), x * 30, s.t / 2 + 0.3, z * 22));
        g.add(at(box(9, 0.6, 6, '#222222', { metal: 0.6 }), x * 22, s.t / 2 + 0.3, z * 30));
      }
    }
    return g;
  },
  // 機臂：長方體＋外端電機座
  arm(s) {
    const g = new THREE.Group();
    g.add(box(s.len, s.h, s.w, s.color, { rough: 0.5 }));
    g.add(at(cyl(18, 3, s.color), s.len / 2 - 15, s.h / 2 + 1.5, 0));
    return g;
  },
  box(s) {
    const g = new THREE.Group();
    g.add(box(s.w, s.h, s.d, s.color));
    if (s.lead === 'xt60') {
      g.add(at(box(16, 8, 16, '#f2c200'), 0, 0, s.d / 2 + 22));   // XT60 接頭
      g.add(at(box(4, 3, 14, '#c9302c'), -3, 0, s.d / 2 + 7));
      g.add(at(box(4, 3, 14, '#222222'), 3, 0, s.d / 2 + 7));
    }
    if (s.antenna) g.add(at(cyl(1.2, 50, '#111111', {}, 8), s.w / 2 - 4, s.h / 2 + 25, s.d / 2 - 4));
    return g;
  },
  cyl(s) {
    return cyl(s.r, s.h, s.color);
  },
  // 無刷電機：底座＋外轉子＋軸
  motor(s) {
    const g = new THREE.Group();
    g.add(at(cyl(s.r, s.h * 0.25, '#555d66', { metal: 0.7, rough: 0.35 }), 0, -s.h * 0.375, 0));
    g.add(at(cyl(s.r, s.h * 0.75, s.color, { metal: 0.8, rough: 0.3 }), 0, s.h * 0.125, 0));
    g.add(at(cyl(2.5, 8, '#cfd4d8', { metal: 0.9, rough: 0.2 }, 12), 0, s.h / 2 + 4, 0));
    return g;
  },
  // 減震座：上下兩片＋四顆減震球
  damper(s) {
    const g = new THREE.Group();
    g.add(at(box(s.w, 1.5, s.d, s.color), 0, -s.h / 2 + 0.75, 0));
    g.add(at(box(s.w, 1.5, s.d, s.color), 0, s.h / 2 - 0.75, 0));
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      g.add(at(new THREE.Mesh(new THREE.SphereGeometry(3.5, 12, 8), mat('#e0a030')), x * (s.w / 2 - 6), 0, z * (s.d / 2 - 6)));
    }
    return g;
  },
  // 飛控：外殼＋頂面朝機頭的箭頭
  fc(s) {
    const g = new THREE.Group();
    g.add(box(s.w, s.h, s.d, s.color, { rough: 0.4 }));
    if (s.arrow) g.add(arrow(s.d * 0.45, s.w * 0.55, '#1f6fd1', s.h / 2 + 0.2));
    return g;
  },
  // GPS：支架＋圓盤（盤面箭頭朝機頭）；原點在支架底部
  gps(s) {
    const g = new THREE.Group();
    g.add(at(cyl(3, s.mastH, '#2a2f35', {}, 12), 0, s.mastH / 2, 0));
    g.add(at(cyl(s.r, 14, s.color, { rough: 0.4 }), 0, s.mastH + 7, 0));
    g.add(arrow(s.r * 0.9, s.r * 0.7, '#e8eef4', s.mastH + 14.2));
    return g;
  },
  battery(s) {
    const g = new THREE.Group();
    g.add(box(s.w, s.h, s.d, s.color, { rough: 0.7 }));
    const strap = Math.max(8, s.d * 0.12);   // 綁帶寬度依電池長度縮放（5 吋電池較小）
    g.add(at(box(s.w + 3, s.h + 3, strap, '#1b1b1b'), 0, 0, -s.d / 4));
    g.add(at(box(s.w + 3, s.h + 3, strap, '#1b1b1b'), 0, 0, s.d / 4));
    return g;
  },
  // P3（5 吋 FPV）：四根鋁柱；原點在鋁柱底部中心
  standoffs(s) {
    const g = new THREE.Group();
    for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) g.add(at(cyl(2.5, s.h, s.color, { metal: 0.8, rough: 0.3 }, 12), x * s.dx, s.h / 2, z * s.dz));
    return g;
  },
  // 攝影機：方塊機身＋朝機頭（−Z）的鏡頭
  camera(s) {
    const g = new THREE.Group();
    g.add(box(s.w, s.w, s.w, s.color));
    const lens = cyl(s.w * 0.32, 6, '#0d0d0d', { metal: 0.3, rough: 0.2 });
    lens.rotation.x = Math.PI / 2;
    lens.position.z = -s.w / 2 - 3;
    g.add(lens);
    return g;
  },
  // 天線：細桿＋頂端天線帽；原點在底部
  antenna(s) {
    const g = new THREE.Group();
    g.add(at(cyl(1.5, s.len, '#222', {}, 8), 0, s.len / 2, 0));
    g.add(at(cyl(5, 14, s.color, {}, 16), 0, s.len + 7, 0));
    return g;
  },
  // 電解電容（外殼條紋側為負極）
  capacitor(s) {
    const g = new THREE.Group();
    const body = cyl(s.r, s.h, s.color);
    body.rotation.z = Math.PI / 2;
    g.add(body);
    const stripe = box(s.h * 0.98, s.r * 0.6, 1, '#e8e8e8');
    stripe.position.z = s.r - 0.2;
    g.add(stripe);
    return g;
  },
  // 螺旋槳：兩片槳葉（依旋向決定扭轉方向）＋槳轂；方向環上的箭頭只做視覺提示
  prop(s) {
    const g = new THREE.Group();
    const dir = s.spin === 'CW' ? 1 : -1;
    for (const side of [1, -1]) {
      const blade = box(s.dia / 2 - 10, 2, Math.max(10, s.dia * 0.08), s.color, { rough: 0.5 });
      blade.position.x = side * (s.dia / 4 + 3);
      blade.rotation.x = side * dir * 0.18;   // 槳葉攻角：CW 與 CCW 互為鏡像
      g.add(blade);
    }
    g.add(cyl(10, 8, '#222222'));
    return g;
  },
};

/** 依零件資料產生 3D 物件；userData.partId 給點選與拖放辨識 */
export function buildPart(part) {
  const builder = BUILDERS[part.shape.type];
  if (!builder) throw new Error(`build_lab_unknown_shape_${part.shape.type}`);
  const obj = builder(part.shape);
  const group = obj.isGroup ? obj : new THREE.Group().add(obj);
  group.userData.partId = part.partId;
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.partId = part.partId; } });
  return group;
}
