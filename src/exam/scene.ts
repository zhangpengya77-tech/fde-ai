/**
 * 考場 3D 場景渲染（CAA 專業基本級術科考場模擬，附錄6 圖11）。
 *
 * 遵循 src/scenes/transmission/create-transmission-scene.ts 的慣例：
 *  - 用 track() 收集所有 geometry/material，dispose() 一次釋放；
 *  - 場景元素以 THREE.Group 分組；不持有外部場景生命週期。
 *
 * 渲染內容：地面 + 網格、操作區邊界（80×30）、八字雙圓（Ø12/R6）、角錐
 * P1–P7、H 起降點（外標 1.8m / 內靶 0.5m）、監評站位，以及每幀更新的機體
 * 標記與航跡線。方向約定與全專案一致（forward = −Z、right = +X，
 * group.rotation.y = −headingRadians）。
 */

import * as THREE from 'three';
import type { ExamField } from './field';
import { FIGURE8_DIAMETER_M } from './field';

export interface ExamSceneHandle {
  field: ExamField;
  /** 每幀更新機體位置（世界座標）與航向角（度）。 */
  setDronePose(position: { x: number; y: number; z: number }, headingDeg: number): void;
  /** 追加一筆航跡點（場平面 X/Z）。 */
  appendTrajectory(x: number, z: number): void;
  /** 清空航跡（新科目 / 新一次測驗）。 */
  clearTrajectory(): void;
  /** 設定風向箭頭（世界 XZ 方向，長度依風速）。 */
  setWindArrow(vector: { x: number; y: number; z: number }): void;
  /** 高亮當前飛行科目對應的圓（subjectC 引導用；不影響判定）。 */
  setActiveCircle(active: 'left' | 'right' | null): void;
  dispose(): void;
}

const CONE_COLOR = 0xff8c42;
const H_OUTER_COLOR = 0xf4ca68;
const H_INNER_COLOR = 0xff4d4d;
const FIGURE8_COLOR = 0x6fd0ff;
const BOUNDARY_COLOR = 0x3bd18a;
const TRAJECTORY_COLOR = 0xffe066;

function circlePoints(center: { x: number; z: number }, radius: number, y: number, segments = 72): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(center.x + radius * Math.cos(a), y, center.z + radius * Math.sin(a)));
  }
  return pts;
}

export function createExamScene(scene: THREE.Scene, field: ExamField): ExamSceneHandle {
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(item: T): T => {
    disposables.push(item);
    return item;
  };

  scene.background = new THREE.Color(0xbcd0c6);
  scene.fog = new THREE.Fog(0xbcd0c6, 60, 160);

  const hemisphere = new THREE.HemisphereLight(0xf5fff9, 0x4e5e4a, 2.1);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xfff1ce, 3.0);
  sun.position.set(20, 40, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 160;
  scene.add(sun);

  // 地面（大於操作區，便於觀察）。
  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(200, 200)),
    track(new THREE.MeshStandardMaterial({ color: 0x6f846b, roughness: 0.96 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(200, 100, 0x385845, 0x7e927b);
  grid.position.y = 0.015;
  scene.add(grid);

  // 操作區邊界（長 80 沿 Z、寬 30 沿 X）。
  const hw = field.operationArea.halfWidthM;
  const hl = field.operationArea.halfLengthM;
  const boundary = new THREE.LineLoop(
    track(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hw, 0.05, -hl),
        new THREE.Vector3(hw, 0.05, -hl),
        new THREE.Vector3(hw, 0.05, hl),
        new THREE.Vector3(-hw, 0.05, hl),
      ]),
    ),
    track(new THREE.LineBasicMaterial({ color: BOUNDARY_COLOR })),
  );
  scene.add(boundary);

  // 八字雙圓。
  const leftRingMaterial = track(new THREE.LineBasicMaterial({ color: FIGURE8_COLOR }));
  const rightRingMaterial = track(new THREE.LineBasicMaterial({ color: FIGURE8_COLOR }));
  const leftRing = new THREE.LineLoop(
    track(new THREE.BufferGeometry().setFromPoints(circlePoints(field.figure8.leftCircle.center, field.figure8.radiusM, 0.06))),
    leftRingMaterial,
  );
  const rightRing = new THREE.LineLoop(
    track(new THREE.BufferGeometry().setFromPoints(circlePoints(field.figure8.rightCircle.center, field.figure8.radiusM, 0.06))),
    rightRingMaterial,
  );
  scene.add(leftRing);
  scene.add(rightRing);

  // 直徑參考虛線（標註 Ø12m，教學用）。
  const diamMaterial = track(new THREE.LineDashedMaterial({ color: FIGURE8_COLOR, dashSize: 0.5, gapSize: 0.3 }));
  const leftDiam = new THREE.Line(
    track(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(field.figure8.leftCircle.center.x - field.figure8.radiusM, 0.07, field.figure8.leftCircle.center.z),
        new THREE.Vector3(field.figure8.leftCircle.center.x + field.figure8.radiusM, 0.07, field.figure8.leftCircle.center.z),
      ]),
    ),
    diamMaterial,
  );
  leftDiam.computeLineDistances();
  scene.add(leftDiam);

  // 角錐 P1–P7（真實錐體，橘色）。
  const coneGeo = track(new THREE.ConeGeometry(0.22, 0.7, 12));
  const coneMat = track(new THREE.MeshStandardMaterial({ color: CONE_COLOR, roughness: 0.6 }));
  for (const [id, p] of Object.entries(field.figure8.cones)) {
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(p.x, 0.35, p.z);
    cone.castShadow = true;
    cone.name = `Cone_${id}`;
    scene.add(cone);
    // 角錐底座小圓，便於自俯視辨識。
    const base = new THREE.Mesh(
      track(new THREE.CircleGeometry(0.3, 16)),
      track(new THREE.MeshBasicMaterial({ color: CONE_COLOR })),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(p.x, 0.02, p.z);
    scene.add(base);
  }

  // H 起降點：外標 1.8m + 內靶 0.5m。
  const hOuter = new THREE.Mesh(
    track(new THREE.RingGeometry(field.landingPointH.outerMarkingM - 0.12, field.landingPointH.outerMarkingM, 48)),
    track(new THREE.MeshBasicMaterial({ color: H_OUTER_COLOR, side: THREE.DoubleSide })),
  );
  hOuter.rotation.x = -Math.PI / 2;
  hOuter.position.set(field.landingPointH.position.x, 0.03, field.landingPointH.position.z);
  scene.add(hOuter);
  const hInner = new THREE.Mesh(
    track(new THREE.CircleGeometry(field.landingPointH.innerTargetM, 32)),
    track(new THREE.MeshBasicMaterial({ color: H_INNER_COLOR })),
  );
  hInner.rotation.x = -Math.PI / 2;
  hInner.position.set(field.landingPointH.position.x, 0.025, field.landingPointH.position.z);
  scene.add(hInner);

  // 監評站位標記。
  const examiner = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20)),
    track(new THREE.MeshStandardMaterial({ color: 0x8e7bd6, roughness: 0.7 })),
  );
  examiner.position.set(field.examinerPosition.position.x, 0.06, field.examinerPosition.position.z);
  scene.add(examiner);

  // 機體標記（小方塊 + 機頭指示）。
  const drone = new THREE.Group();
  drone.name = 'ExamDrone';
  const body = new THREE.Mesh(
    track(new THREE.BoxGeometry(0.5, 0.18, 0.5)),
    track(new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.5 })),
  );
  body.castShadow = true;
  drone.add(body);
  const nose = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.12, 0.5, 10)),
    track(new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x6b4f00 })),
  );
  // 機頭指示朝 −Z（heading 0 前方）。
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0, -0.35);
  drone.add(nose);
  scene.add(drone);

  // 航跡線（動態）。
  const trajGeo = track(new THREE.BufferGeometry());
  const trajPositions: number[] = [];
  const trajectory = new THREE.Line(
    trajGeo,
    track(new THREE.LineBasicMaterial({ color: TRAJECTORY_COLOR })),
  );
  scene.add(trajectory);

  // 風向箭頭（動態）。
  const windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.1, 0), 3, 0x4fa3ff, 0.8, 0.5);
  scene.add(windArrow);

  return {
    field,
    setDronePose(position, headingDeg) {
      drone.position.set(position.x, position.y, position.z);
      drone.rotation.y = -(headingDeg * Math.PI) / 180;
    },
    appendTrajectory(x, z) {
      trajPositions.push(x, 0.12, z);
      trajGeo.setAttribute('position', new THREE.Float32BufferAttribute(trajPositions, 3));
      trajGeo.setDrawRange(0, trajPositions.length / 3);
      trajGeo.computeBoundingSphere();
    },
    clearTrajectory() {
      trajPositions.length = 0;
      trajGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      trajGeo.setDrawRange(0, 0);
    },
    setWindArrow(vector) {
      const v = new THREE.Vector3(vector.x, 0, vector.z);
      const len = Math.hypot(vector.x, vector.z);
      if (len < 1e-3) {
        windArrow.visible = false;
        return;
      }
      windArrow.visible = true;
      windArrow.position.set(0, 0.1, 0);
      windArrow.setDirection(v.clone().normalize());
      windArrow.setLength(Math.min(len, 12), 0.8, 0.5);
    },
    setActiveCircle(active) {
      if (active === 'left') {
        leftRingMaterial.color.setHex(0xffe066);
        rightRingMaterial.color.setHex(FIGURE8_COLOR);
      } else if (active === 'right') {
        rightRingMaterial.color.setHex(0xffe066);
        leftRingMaterial.color.setHex(FIGURE8_COLOR);
      } else {
        leftRingMaterial.color.setHex(FIGURE8_COLOR);
        rightRingMaterial.color.setHex(FIGURE8_COLOR);
      }
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}

/** 八字直徑（供 UI 標註）。 */
export const EXAM_FIGURE8_DIAMETER_M = FIGURE8_DIAMETER_M;
