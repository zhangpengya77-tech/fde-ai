/**
 * 科目 E 五邊教學場景（第一階段）— 獨立 Three.js 可視化。
 *
 * 隔離於既有考試場景（src/exam/scene.ts）：不改 P0-C 機體、P0-D 圍欄、
 * P0-A 相機等既有功能；本場景只做「教學演示」——航線、延伸線、級距空域、
 * 20m 高度參考面與一架簡易機，**不含任何評分/判定物件**。
 *
 * 座標約定與全專案飛控一致（forward = −Z、right = +X）；
 * heading 0 = 機頭朝 −Z，setDronePose 換算 rotation.y = −heading。
 */

import * as THREE from 'three';
import type { ExamField } from './field';
import type { PentaRoute, PentaWaypoint } from './penta';

export interface PentaSceneOptions {
  /** 級距最小操作空域（長沿 Z、寬沿 X）；null = 不畫。 */
  airspace: { lengthM: number; widthM: number } | null;
  /** 操作高度參考面（公尺）。 */
  altitudeM: number;
}

/** 訓練視覺覆疊（第四輪教學練習；null = 僅演示模式）。 */
export interface PentaTrainingView3D {
  /** 目前目標是否為進入段（W0→W1）。 */
  entry: boolean;
  /** 目前目標航段（route.legs index）；entry=true 時忽略。 */
  legIndex: number | null;
  /** 已到達的航路點 index（route.waypoints）。 */
  reachedWaypoints: number[];
  /** 偏離連線起點（機體世界座標）；null = 不畫。 */
  deviationFrom: { x: number; y: number; z: number } | null;
  /** 偏離連線終點（航線上最近點）；null = 不畫。 */
  deviationTo: { x: number; y: number; z: number } | null;
}

export interface PentaSceneHandle {
  /** 設定機體位姿（世界座標 + 航向角，度）。 */
  setDronePose(pos: { x: number; y: number; z: number }, headingDeg: number): void;
  /** 設定／清除訓練視覺覆疊（目前目標高亮、已達航點、偏離連線）。 */
  setTrainingView(view: PentaTrainingView3D | null): void;
  /** 移除並釋放本場景建立的所有物件。 */
  dispose(): void;
}

/** 累積待釋放資源（幾何體/材質），供 dispose 統一清理。 */
interface Disposable {
  dispose(): void;
}

export function createPentaScene(
  scene: THREE.Scene,
  field: ExamField,
  route: PentaRoute,
  options: PentaSceneOptions,
): PentaSceneHandle {
  const disposables: Disposable[] = [];
  const objects: THREE.Object3D[] = [];
  const track = <T extends Disposable>(item: T): T => {
    disposables.push(item);
    return item;
  };
  const add = <T extends THREE.Object3D>(obj: T, name: string): T => {
    obj.name = name;
    scene.add(obj);
    objects.push(obj);
    return obj;
  };

  // ------------------------------------------------------------------
  // PentaExtensionLine：P3→P7 延伸線（官方條件③錨點），畫在操作高度。
  // ------------------------------------------------------------------
  const extGeo = track(new THREE.BufferGeometry());
  {
    const p3 = field.figure8.cones.P3;
    const p7 = field.figure8.cones.P7;
    extGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([p3.x, 0, p3.z, p7.x, 0, p7.z], 3),
    );
  }
  const extLine = add(
    new THREE.Line(
      extGeo,
      track(new THREE.LineBasicMaterial({ color: 0xffc94d, depthTest: false, transparent: true, opacity: 0.95 })),
    ),
    'PentaExtensionLine',
  );
  extLine.position.y = options.altitudeM;
  extLine.renderOrder = 5;

  // ------------------------------------------------------------------
  // PentaRouteLine：教學假設航線（進入段 + 五邊，依飛行順序）。
  // ------------------------------------------------------------------
  const routeGeo = track(new THREE.BufferGeometry());
  {
    const pts: number[] = [];
    const seq = [route.waypoints[route.entry.fromIndex], route.waypoints[route.entry.toIndex]];
    for (const leg of route.legs) seq.push(route.waypoints[leg.toIndex]);
    for (const w of seq) pts.push(w.x, w.y, w.z);
    routeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
  add(
    new THREE.Line(
      routeGeo,
      track(new THREE.LineBasicMaterial({ color: 0x4fa3ff, depthTest: false, transparent: true, opacity: 0.9 })),
    ),
    'PentaRouteLine',
  ).renderOrder = 4;

  // 航路點標記（小球）。
  const wpGeo = track(new THREE.SphereGeometry(0.35, 12, 10));
  const wpMat = track(new THREE.MeshBasicMaterial({ color: 0x9ad0ff }));
  const wpGroup = add(new THREE.Group(), 'PentaWaypoints');
  route.waypoints.forEach((w, i) => {
    const m = new THREE.Mesh(wpGeo, wpMat);
    m.position.set(w.x, w.y, w.z);
    m.name = `PentaWaypoint${i}`;
    wpGroup.add(m);
  });

  // ------------------------------------------------------------------
  // PentaAirspaceBox：級距最小操作空域（地面矩形 + 半透明面板）。
  // ------------------------------------------------------------------
  if (options.airspace) {
    const { lengthM, widthM } = options.airspace;
    const boxGeo = track(new THREE.BoxGeometry(widthM, 0.08, lengthM));
    const box = add(
      new THREE.Mesh(
        boxGeo,
        track(
          new THREE.MeshBasicMaterial({
            color: 0x3d7a52,
            transparent: true,
            opacity: 0.12,
            depthWrite: false,
          }),
        ),
      ),
      'PentaAirspaceBox',
    );
    box.position.y = 0.04;
    const edgeGeo = track(new THREE.EdgesGeometry(boxGeo));
    add(new THREE.LineSegments(edgeGeo, track(new THREE.LineBasicMaterial({ color: 0x5fae7d }))), 'PentaAirspaceEdges')
      .position.y = 0.04;
  }

  // ------------------------------------------------------------------
  // PentaAltitudeReference：操作高度參考面（官方 20m）。
  // ------------------------------------------------------------------
  const altGeo = track(new THREE.PlaneGeometry(24, 44));
  const altPlane = add(
    new THREE.Mesh(
      altGeo,
      track(
        new THREE.MeshBasicMaterial({
          color: 0x4fa3ff,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    ),
    'PentaAltitudeReference',
  );
  altPlane.rotation.x = -Math.PI / 2;
  altPlane.position.set(0, options.altitudeM, -11);

  // ------------------------------------------------------------------
  // PentaDrone：簡易教學機（不與考試機 createExamQuad 共用，避免耦合）。
  // ------------------------------------------------------------------
  const drone = add(new THREE.Group(), 'PentaDrone');
  {
    const bodyGeo = track(new THREE.BoxGeometry(0.34, 0.12, 0.34));
    const body = new THREE.Mesh(bodyGeo, track(new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5 })));
    body.position.y = 0.16;
    body.castShadow = true;
    drone.add(body);
    // 機頭錐（本地 −Z 為前，與 P0-C DroneNoseMarker 同色系）。
    const noseGeo = track(new THREE.ConeGeometry(0.07, 0.18, 12));
    const nose = new THREE.Mesh(noseGeo, track(new THREE.MeshStandardMaterial({ color: 0xd8493f, emissive: 0x45100c })));
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, 0.16, -0.24);
    drone.add(nose);
    // 四臂 + 馬達（對角 1.00m，附件十二級別 I 樣機軸距 90–110cm 中值）。
    const armGeo = track(new THREE.BoxGeometry(0.66, 0.03, 0.05));
    const motorGeo = track(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 10));
    const armMat = track(new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.6 }));
    const motorMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa39d, metalness: 0.7, roughness: 0.3 }));
    const armAngles = [Math.PI * 0.25, Math.PI * 0.75, Math.PI * 1.25, Math.PI * 1.75];
    for (const angle of armAngles) {
      const arm = new THREE.Mesh(armGeo, armMat);
      arm.position.set(Math.cos(angle) * 0.35, 0.14, Math.sin(angle) * 0.35);
      arm.rotation.y = -angle;
      drone.add(arm);
      const motor = new THREE.Mesh(motorGeo, motorMat);
      motor.position.set(Math.cos(angle) * 0.5, 0.18, Math.sin(angle) * 0.5);
      drone.add(motor);
    }
  }

  // ------------------------------------------------------------------
  // 訓練視覺覆疊（第四輪教學練習）：目前目標高亮／已達航點／偏離連線。
  // 純視覺輔助——判定與量測皆在 penta-training.ts（純函式），本區塊
  // 不參與任何評分；setTrainingView(null) 時全部隱藏（演示模式不受影響）。
  // ------------------------------------------------------------------
  const TRAIN_HIGHLIGHT = 0xffe066;
  const TRAIN_DIM = 0x4fa3ff;
  const TRAIN_REACHED = 0x35d07f;
  const TRAIN_DEVIATION = 0xffb347;

  /** 進入段 + 五邊的高亮線（index 0 = 進入段；i+1 = route.legs[i]）。 */
  const segLines: Array<{ mat: THREE.LineBasicMaterial }> = [];
  const mkSegLine = (a: PentaWaypoint, b: PentaWaypoint): void => {
    const geo = track(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z], 3));
    const mat = track(new THREE.LineBasicMaterial({ color: TRAIN_DIM, depthTest: false, transparent: true, opacity: 0.3 }));
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 6;
    add(line, 'PentaTrainingSegLine');
    segLines.push({ mat });
  };
  mkSegLine(route.waypoints[route.entry.fromIndex], route.waypoints[route.entry.toIndex]);
  for (const leg of route.legs) {
    mkSegLine(route.waypoints[leg.fromIndex], route.waypoints[leg.toIndex]);
  }

  // 已達航點標記（綠球；依 reachedWaypoints 顯示）。
  const reachedGeo = track(new THREE.SphereGeometry(0.5, 14, 12));
  const reachedMat = track(
    new THREE.MeshBasicMaterial({ color: TRAIN_REACHED, depthTest: false, transparent: true, opacity: 0.95 }),
  );
  const reachedMeshes: THREE.Mesh[] = route.waypoints.map((w, i) => {
    const m = new THREE.Mesh(reachedGeo, reachedMat);
    m.position.set(w.x, w.y, w.z);
    m.visible = false;
    m.renderOrder = 7;
    m.name = `PentaTrainingReached${i}`;
    add(m, `PentaTrainingReached${i}`);
    return m;
  });

  // 偏離連線（機體 → 航線上最近點；僅供教學提示）。
  const devGeo = track(new THREE.BufferGeometry());
  devGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const devLine = add(
    new THREE.Line(
      devGeo,
      track(new THREE.LineBasicMaterial({ color: TRAIN_DEVIATION, depthTest: false, transparent: true, opacity: 0.95 })),
    ),
    'PentaTrainingDeviation',
  );
  devLine.renderOrder = 8;
  devLine.visible = false;

  // 環境光（場景自足，不依賴外部燈光；既有考試場景的燈光由 scene.ts 管）。
  add(new THREE.AmbientLight(0xffffff, 1.4), 'PentaAmbientLight');
  const dir = add(new THREE.DirectionalLight(0xffffff, 1.2), 'PentaDirLight');
  dir.position.set(12, 24, 8);

  return {
    setDronePose(pos, headingDeg) {
      drone.position.set(pos.x, pos.y, pos.z);
      drone.rotation.y = (-headingDeg * Math.PI) / 180;
    },
    setTrainingView(view) {
      if (!view) {
        for (const s of segLines) {
          s.mat.color.setHex(TRAIN_DIM);
          s.mat.opacity = 0.3;
        }
        for (const m of reachedMeshes) m.visible = false;
        devLine.visible = false;
        return;
      }
      const highlight = view.entry ? 0 : view.legIndex !== null ? view.legIndex + 1 : null;
      segLines.forEach((s, i) => {
        const on = i === highlight;
        s.mat.color.setHex(on ? TRAIN_HIGHLIGHT : TRAIN_DIM);
        s.mat.opacity = on ? 1 : 0.3;
      });
      route.waypoints.forEach((_, i) => {
        reachedMeshes[i].visible = view.reachedWaypoints.includes(i);
      });
      if (view.deviationFrom && view.deviationTo) {
        const pos = devGeo.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, view.deviationFrom.x, view.deviationFrom.y, view.deviationFrom.z);
        pos.setXYZ(1, view.deviationTo.x, view.deviationTo.y, view.deviationTo.z);
        pos.needsUpdate = true;
        devLine.visible = true;
      } else {
        devLine.visible = false;
      }
    },
    dispose() {
      for (const o of objects) scene.remove(o);
      for (const d of disposables) d.dispose();
    },
  };
}
