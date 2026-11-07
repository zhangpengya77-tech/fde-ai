/**
 * REA 考照模擬器：3D 考場（Three.js，全部程式繪製，不使用參考網站的圖檔或 3D 資產）。
 * 考場座標 (x, y, h) → Three.js (x, h, -y)。
 */

import * as THREE from 'three';
import type { Field, Subject, Vec2 } from './courses';
import type { Airframe } from './physics';
import { animateDrone, buildDroneModel, type DroneModel } from './drone-model';

const FIELD_TO_3D = (p: Vec2, h = 0) => new THREE.Vector3(p.x, h, -p.y);

export type ViewMode = 'examinee' | 'drone' | 'top';
export type ExamineeCam = 'fixed' | 'follow' | 'zoom';

export interface SceneSettings {
  hour: number;
  /** 考生面向（度，0 = 北），影響太陽方位。 */
  facingDeg: number;
  sunny: boolean;
}

export class ExamScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.05, 2000);
  view: ViewMode = 'examinee';
  examineeCam: ExamineeCam = 'follow';
  private fieldGroup = new THREE.Group();
  private drone = new THREE.Group();
  /** 2026-11-08：精緻模型（機臂、馬達、槳葉、起落架、航行燈） */
  private model: DroneModel | null = null;
  private clock = 0;
  private spin = 0;
  private trail: THREE.Line;
  private trailPts: THREE.Vector3[] = [];
  private ghostTrail: THREE.Line;
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xcfe6ff, 0x55634a, 0.9);
  private sock = new THREE.Group();
  private field: Field | null = null;
  private readonly ro: ResizeObserver;

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('data-rea-canvas', '');
    this.scene.background = new THREE.Color(0xbfd9ee);
    this.scene.fog = new THREE.Fog(0xbfd9ee, 120, 600);
    this.scene.add(this.hemi, this.sun, this.fieldGroup, this.drone, this.sock);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 });

    // 大範圍草地＋考場柏油
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0x6f9a52 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.02;
    grass.receiveShadow = true;
    this.scene.add(grass);

    const trailMat = new THREE.LineBasicMaterial({ color: 0xffb703 });
    this.trail = new THREE.Line(new THREE.BufferGeometry(), trailMat);
    this.ghostTrail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x4cc9f0, dashSize: 0.4, gapSize: 0.3 }));
    this.scene.add(this.trail, this.ghostTrail);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setSun(s: SceneSettings): void {
    // 簡化太陽軌跡：6 時東升、12 時天頂附近（台灣緯度）、18 時西落；方位相對考生面向換算
    const dayFrac = (s.hour - 6) / 12;
    const elev = Math.sin(Math.PI * Math.min(1, Math.max(0, dayFrac))) * (Math.PI / 180) * 80 + 0.05;
    const azWorld = (90 + 180 * dayFrac) * (Math.PI / 180); // 東→南→西
    const az = azWorld - (s.facingDeg * Math.PI) / 180;
    const r = 60;
    this.sun.position.set(r * Math.sin(az) * Math.cos(elev), r * Math.sin(elev), -r * Math.cos(az) * Math.cos(elev));
    this.sun.intensity = s.sunny ? 2.4 : 0.6;
    this.hemi.intensity = s.sunny ? 0.9 : 1.4;
    this.scene.background = new THREE.Color(s.sunny ? 0xbfd9ee : 0xc9ced3);
  }

  /** 建立考場標線與角錐。 */
  buildField(field: Field, subject: Subject): void {
    this.field = field;
    this.fieldGroup.clear();
    const g = this.fieldGroup;
    const b = field.bounds;
    const pad = 4;
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(b.xMax - b.xMin + pad * 2, b.yMax - b.yMin + pad * 2),
      new THREE.MeshLambertMaterial({ color: 0x8d9196 }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set((b.xMin + b.xMax) / 2, 0, -(b.yMin + b.yMax) / 2);
    asphalt.receiveShadow = true;
    g.add(asphalt);

    const white = new THREE.MeshBasicMaterial({ color: 0xf5f5f5 });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xf4c430 });
    const pink = new THREE.MeshBasicMaterial({ color: 0xe56b8f, transparent: true, opacity: 0.55 });
    const red = new THREE.MeshBasicMaterial({ color: 0xd62839 });

    // 場地外框
    const frame = [
      [{ x: b.xMin, y: b.yMin }, { x: b.xMax, y: b.yMin }], [{ x: b.xMax, y: b.yMin }, { x: b.xMax, y: b.yMax }],
      [{ x: b.xMax, y: b.yMax }, { x: b.xMin, y: b.yMax }], [{ x: b.xMin, y: b.yMax }, { x: b.xMin, y: b.yMin }],
    ];
    for (const [p, q] of frame) g.add(stripe(p, q, 0.12, white));

    // 8 字環帶（粉紅）＋內外邊線＋八字內圈
    for (const r of field.rings) {
      const band = new THREE.Mesh(new THREE.RingGeometry(r.inner, r.outer, 96), pink);
      band.rotation.x = -Math.PI / 2;
      band.position.copy(FIELD_TO_3D(r.center, 0.01));
      g.add(band);
      for (const rad of [r.inner, r.radius, r.outer]) {
        const line = new THREE.Mesh(new THREE.RingGeometry(rad - (rad === r.radius ? 0.03 : 0.06), rad + (rad === r.radius ? 0.03 : 0.06), 128), rad === r.radius ? yellow : white);
        line.rotation.x = -Math.PI / 2;
        line.position.copy(FIELD_TO_3D(r.center, 0.015));
        g.add(line);
      }
    }
    // I2 矩形航線標線
    if (field.kind === 'I2') {
      const { P1, P2, P3, P4 } = field.cones;
      for (const [p, q] of [[P1, P2], [P2, P3], [P3, P4], [P4, P1]]) g.add(stripe(p, q, 0.08, yellow));
    }
    // 考生站位線
    g.add(stripe({ x: -2, y: field.examinee.y }, { x: 2, y: field.examinee.y }, 0.15, yellow));

    // 起降點 H：紅圓＋白色 H
    const hDisk = new THREE.Mesh(new THREE.CircleGeometry(field.hRadius, 64), red);
    hDisk.rotation.x = -Math.PI / 2;
    hDisk.position.y = 0.02;
    g.add(hDisk);
    const hRing = new THREE.Mesh(new THREE.RingGeometry(field.hRadius - 0.08, field.hRadius, 64), white);
    hRing.rotation.x = -Math.PI / 2;
    hRing.position.y = 0.025;
    g.add(hRing);
    for (const [x, w, d] of [[-0.3, 0.14, 1.0], [0.3, 0.14, 1.0], [0, 0.6, 0.14]] as const) {
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(x, 0.03, 0);
      g.add(bar);
    }

    // 角錐＋標籤
    for (const [id, p] of Object.entries(field.cones)) g.add(cone(p, id));
    for (const [id, p] of Object.entries(field.poi)) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ color: 0x3a86ff }));
      m.rotation.x = -Math.PI / 2;
      m.position.copy(FIELD_TO_3D(p, 0.02));
      g.add(m, label(id, FIELD_TO_3D(p, 1.2)));
    }

    // 五邊、緊急返航：顯示外部參考航線（虛線）
    const pts: THREE.Vector3[] = [];
    for (const st of subject.steps) if (st.kind === 'fly' && st.alt && st.alt > 5) pts.push(FIELD_TO_3D(st.to, 0.05));
    if (pts.length) {
      pts.unshift(FIELD_TO_3D({ x: 0, y: 0 }, 0.05));
      this.ghostTrail.geometry.dispose();
      this.ghostTrail.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.ghostTrail.computeLineDistances();
      this.ghostTrail.visible = true;
    } else this.ghostTrail.visible = false;

    // 風向袋放在場地右後方
    this.sock.clear();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.position.y = 2;
    const sockMesh = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.6, 16, 1, true), new THREE.MeshLambertMaterial({ color: 0xff7b00, side: THREE.DoubleSide }));
    sockMesh.rotation.z = Math.PI / 2;
    sockMesh.position.set(0.8, 3.8, 0);
    sockMesh.name = 'sock';
    this.sock.add(pole, sockMesh);
    this.sock.position.copy(FIELD_TO_3D({ x: b.xMax - 1, y: field.examinee.y + 1 }));
  }

  /** 依機型建立機體：紅色機臂那一側是機頭（比照業界慣例）。模型細節見 drone-model.ts。 */
  buildDrone(af: Airframe): void {
    this.drone.clear();
    this.model = buildDroneModel(af);
    this.drone.add(this.model.group);
    this.drone.userData.lift = this.model.lift;
    this.spin = 0;
  }

  setDrone(x: number, y: number, h: number, headingDeg: number, pitchDeg: number, rollDeg: number, spinning: boolean, dt: number): void {
    this.drone.position.set(x, h + (this.drone.userData.lift ?? 0.1), -y);
    // Three.js：yaw 繞 +y 逆時針為正 → 機頭角（順時針）取負
    this.drone.rotation.set(0, 0, 0);
    this.drone.rotateY((-headingDeg * Math.PI) / 180);
    this.drone.rotateX((-pitchDeg * Math.PI) / 180);
    this.drone.rotateZ((-rollDeg * Math.PI) / 180);
    // 槳葉轉速平滑變化：起飛時慢慢轉起來、落地後慢慢停
    this.clock += dt;
    const target = spinning ? 1 : 0;
    this.spin += (target - this.spin) * Math.min(1, dt * (spinning ? 3 : 1.2));
    if (this.model) animateDrone(this.model, this.spin, dt, this.clock);
  }

  setWindSock(wind: Vec2): void {
    const sp = Math.hypot(wind.x, wind.y);
    const sock = this.sock.getObjectByName('sock');
    if (!sock) return;
    // 風向袋指向下風處：本地 +x 轉到 (wind.x, -wind.y)
    if (sp > 0.05) this.sock.rotation.y = Math.atan2(wind.y, wind.x);
    // 風越大越水平（7.5 m/s 以上幾乎全展開），無風時下垂
    const lift = Math.min(1, sp / 7.5);
    sock.rotation.z = Math.PI / 2 + (1 - lift) * 1.2;
    sock.position.set(0.8 * lift + 0.15, 3.8 - (1 - lift) * 0.6, 0);
  }

  clearTrail(): void {
    this.trailPts = [];
    this.trail.geometry.dispose();
    this.trail.geometry = new THREE.BufferGeometry();
  }

  pushTrail(x: number, y: number, h: number): void {
    const p = new THREE.Vector3(x, h, -y);
    const last = this.trailPts[this.trailPts.length - 1];
    if (last && last.distanceTo(p) < 0.15) return;
    this.trailPts.push(p);
    if (this.trailPts.length > 6000) this.trailPts.shift();
    this.trail.geometry.dispose();
    this.trail.geometry = new THREE.BufferGeometry().setFromPoints(this.trailPts);
  }

  setTrailFromSamples(pts: { x: number; y: number; h: number }[]): void {
    this.trailPts = pts.map((p) => new THREE.Vector3(p.x, p.h, -p.y));
    this.trail.geometry.dispose();
    this.trail.geometry = new THREE.BufferGeometry().setFromPoints(this.trailPts);
  }

  render(): void {
    const d = this.drone.position;
    const f = this.field;
    if (this.view === 'drone') {
      // 飛機視角：機尾後上方追蹤
      const back = new THREE.Vector3(0, 0.9, 2.6).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.drone.rotation.y));
      this.camera.position.copy(d).add(back);
      this.camera.lookAt(d.x, d.y + 0.2, d.z);
      this.camera.fov = 60;
    } else if (this.view === 'top') {
      this.camera.position.set(0, 45, -6);
      this.camera.lookAt(0, 0, -6);
      this.camera.fov = 50;
    } else {
      // 考生視角：站在 H 後方，眼高 1.6 m
      const ex = f ? f.examinee : { x: 0, y: -7 };
      this.camera.position.set(ex.x, 1.6, -ex.y);
      if (this.examineeCam === 'fixed') {
        this.camera.lookAt(0, 1.2, -6);
        this.camera.fov = 60;
      } else {
        this.camera.lookAt(d.x * 0.85, Math.max(0.8, d.y * 0.85), d.z * 0.85 + (-ex.y) * 0.15);
        const dist = this.camera.position.distanceTo(d);
        this.camera.fov = this.examineeCam === 'zoom' ? Math.max(18, Math.min(60, 600 / Math.max(dist, 1))) : 60;
      }
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function stripe(p: Vec2, q: Vec2, width: number, mat: THREE.Material): THREE.Mesh {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.atan2(q.x - p.x, q.y - p.y);
  m.position.set((p.x + q.x) / 2, 0.012, -(p.y + q.y) / 2);
  return m;
}

function cone(p: Vec2, id: string): THREE.Group {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 24), new THREE.MeshLambertMaterial({ color: 0xff6d00 }));
  c.position.y = 0.35;
  c.castShadow = true;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.15, 0.12, 24), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  band.position.y = 0.38;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.45), new THREE.MeshLambertMaterial({ color: 0x222222 }));
  base.position.y = 0.02;
  g.add(c, band, base, label(id, new THREE.Vector3(0, 1.05, 0)));
  g.position.copy(FIELD_TO_3D(p));
  return g;
}

function label(text: string, at: THREE.Vector3): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 64;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(20,24,32,.75)';
  ctx.fillRect(14, 8, 100, 48);
  ctx.fillStyle = '#ffd166';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  sp.scale.set(0.9, 0.45, 1);
  sp.position.copy(at);
  return sp;
}
