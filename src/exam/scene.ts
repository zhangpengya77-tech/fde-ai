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
const FENCE_SETBACK_M = 2;
const FENCE_HEIGHT_M = 2;
const FENCE_TARGET_POST_SPACING_M = 4;

function circlePoints(center: { x: number; z: number }, radius: number, y: number, segments = 72): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(center.x + radius * Math.cos(a), y, center.z + radius * Math.sin(a)));
  }
  return pts;
}

/**
 * 教學視覺圍網。它由既有操作區大小推導，不是考試碰撞、邊界或評分的一部分。
 * 立柱使用 InstancedMesh，四片低成本半透明網面避免密集鐵絲網幾何與大量 draw calls。
 */
function createVisualFence(
  track: <T extends THREE.BufferGeometry | THREE.Material>(item: T) => T,
  field: ExamField,
): THREE.Group {
  const outerHalfWidth = field.operationArea.halfWidthM + FENCE_SETBACK_M;
  const outerHalfLength = field.operationArea.halfLengthM + FENCE_SETBACK_M;
  const outerWidth = outerHalfWidth * 2;
  const outerLength = outerHalfLength * 2;
  const longSegments = Math.ceil(outerLength / FENCE_TARGET_POST_SPACING_M);
  const shortSegments = Math.ceil(outerWidth / FENCE_TARGET_POST_SPACING_M);
  const postPositions: Array<{ x: number; z: number }> = [];

  for (let index = 0; index <= longSegments; index += 1) {
    const z = -outerHalfLength + (outerLength * index) / longSegments;
    postPositions.push({ x: -outerHalfWidth, z });
    postPositions.push({ x: outerHalfWidth, z });
  }
  for (let index = 1; index < shortSegments; index += 1) {
    const x = -outerHalfWidth + (outerWidth * index) / shortSegments;
    postPositions.push({ x, z: -outerHalfLength });
    postPositions.push({ x, z: outerHalfLength });
  }

  const group = new THREE.Group();
  group.name = 'ExamVisualFence';
  group.userData = {
    visualOnly: true,
    collisionEnabled: false,
    scoringEnabled: false,
    heightM: FENCE_HEIGHT_M,
    setbackM: FENCE_SETBACK_M,
    outerWidthM: outerWidth,
    outerLengthM: outerLength,
    targetPostSpacingM: FENCE_TARGET_POST_SPACING_M,
  };

  const postGeometry = track(new THREE.CylinderGeometry(0.035, 0.035, FENCE_HEIGHT_M, 8));
  const postMaterial = track(new THREE.MeshStandardMaterial({ color: 0x4a5150, roughness: 0.72, metalness: 0.15 }));
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postPositions.length);
  posts.name = 'FencePosts';
  const matrix = new THREE.Matrix4();
  postPositions.forEach((position, index) => {
    matrix.makeTranslation(position.x, FENCE_HEIGHT_M / 2, position.z);
    posts.setMatrixAt(index, matrix);
  });
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  const meshMaterial = track(new THREE.MeshBasicMaterial({
    color: 0x7b8380,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  const northSouthGeometry = track(new THREE.PlaneGeometry(outerWidth, FENCE_HEIGHT_M));
  const eastWestGeometry = track(new THREE.PlaneGeometry(outerLength, FENCE_HEIGHT_M));
  for (const z of [-outerHalfLength, outerHalfLength]) {
    const mesh = new THREE.Mesh(northSouthGeometry, meshMaterial);
    mesh.position.set(0, FENCE_HEIGHT_M / 2, z);
    mesh.name = 'FenceMeshNorthSouth';
    group.add(mesh);
  }
  for (const x of [-outerHalfWidth, outerHalfWidth]) {
    const mesh = new THREE.Mesh(eastWestGeometry, meshMaterial);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x, FENCE_HEIGHT_M / 2, 0);
    mesh.name = 'FenceMeshEastWest';
    group.add(mesh);
  }

  const railPositions: THREE.Vector3[] = [];
  for (const y of [0.12, FENCE_HEIGHT_M]) {
    railPositions.push(
      new THREE.Vector3(-outerHalfWidth, y, -outerHalfLength), new THREE.Vector3(outerHalfWidth, y, -outerHalfLength),
      new THREE.Vector3(outerHalfWidth, y, -outerHalfLength), new THREE.Vector3(outerHalfWidth, y, outerHalfLength),
      new THREE.Vector3(outerHalfWidth, y, outerHalfLength), new THREE.Vector3(-outerHalfWidth, y, outerHalfLength),
      new THREE.Vector3(-outerHalfWidth, y, outerHalfLength), new THREE.Vector3(-outerHalfWidth, y, -outerHalfLength),
    );
  }
  const rails = new THREE.LineSegments(
    track(new THREE.BufferGeometry().setFromPoints(railPositions)),
    track(new THREE.LineBasicMaterial({ color: 0x555d5b, transparent: true, opacity: 0.72 })),
  );
  rails.name = 'FenceRails';
  group.add(rails);
  return group;
}

/**
 * 考試機四軸模型（程序化，無外部 GLB 依賴）。
 *
 * 依「機身／四臂／四馬達／四槳／機頭」組成，馬達對角 1.00m（附件十二級別 I
 * 樣機軸距 90–110cm）。最低點（起落架）在 y=0，故 setDronePose 直接把飛控
 * 高度寫入 group.position.y，地面待命時機體落在起降點上、不會埋入地面。
 *
 * 顏色刻意提高對比：深灰機身＋白頂蓋＋紅色前臂（機頭方向）＋黃色機頭錐＋
 * 綠色槳轂，避免在綠色地面上只剩一個黑點。
 */
function createExamQuad(
  track: <T extends THREE.BufferGeometry | THREE.Material>(item: T) => T,
): { group: THREE.Group; rotors: THREE.Group[] } {
  const group = new THREE.Group();
  group.name = 'ExamDrone';

  const graphite = track(new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.25 }));
  const white = track(new THREE.MeshStandardMaterial({ color: 0xe8ece7, roughness: 0.45 }));
  const red = track(new THREE.MeshStandardMaterial({ color: 0xd8493f, roughness: 0.45 }));
  const metal = track(new THREE.MeshStandardMaterial({ color: 0x9aa39d, metalness: 0.75, roughness: 0.3 }));
  const prop = track(new THREE.MeshStandardMaterial({ color: 0x1b1f1d, roughness: 0.55 }));
  const accent = track(new THREE.MeshStandardMaterial({ color: 0x69d696, emissive: 0x123321, roughness: 0.4 }));
  const noseMat = track(new THREE.MeshStandardMaterial({ color: 0xd8493f, emissive: 0x45100c }));

  const bodyGeo = track(new THREE.BoxGeometry(0.34, 0.12, 0.34));
  const body = new THREE.Mesh(bodyGeo, graphite);
  body.position.y = 0.11;
  body.castShadow = true;
  group.add(body);

  const canopyGeo = track(new THREE.BoxGeometry(0.24, 0.05, 0.26));
  const canopy = new THREE.Mesh(canopyGeo, white);
  canopy.position.y = 0.19;
  group.add(canopy);

  const stripGeo = track(new THREE.BoxGeometry(0.2, 0.02, 0.04));
  const strip = new THREE.Mesh(stripGeo, accent);
  strip.position.set(0, 0.22, 0.02);
  group.add(strip);

  // 四臂：前兩支紅色（機頭方向 −Z），後兩支白色；馬達對角 1.00m。
  const armGeo = track(new THREE.BoxGeometry(0.74, 0.05, 0.07));
  const motorGeo = track(new THREE.CylinderGeometry(0.055, 0.065, 0.1, 12));
  const propGeo = track(new THREE.BoxGeometry(0.32, 0.008, 0.04));
  const hubGeo = track(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10));
  const rotors: THREE.Group[] = [];
  const armAngles: Array<{ angle: number; material: THREE.Material; motorName: string }> = [
    { angle: Math.PI * 0.75, material: white, motorName: 'MotorRearLeft' },
    { angle: Math.PI * 1.25, material: red, motorName: 'MotorFrontLeft' },
    { angle: Math.PI * 0.25, material: white, motorName: 'MotorRearRight' },
    { angle: Math.PI * 1.75, material: red, motorName: 'MotorFrontRight' },
  ];
  for (const { angle, material, motorName } of armAngles) {
    const mx = Math.cos(angle) * 0.5;
    const mz = Math.sin(angle) * 0.5;
    const arm = new THREE.Mesh(armGeo, material);
    arm.position.set(mx / 2, 0.11, mz / 2);
    arm.rotation.y = -angle;
    group.add(arm);

    const motor = new THREE.Mesh(motorGeo, metal);
    motor.name = motorName;
    motor.position.set(mx, 0.16, mz);
    group.add(motor);

    const rotor = new THREE.Group();
    rotor.position.set(mx, 0.22, mz);
    const blade = new THREE.Mesh(propGeo, prop);
    blade.castShadow = true;
    rotor.add(blade);
    const hub = new THREE.Mesh(hubGeo, accent);
    rotor.add(hub);
    group.add(rotor);
    rotors.push(rotor);
  }

  // 機頭／機尾方向標記：紅色小錐朝 −Z，白色小錐朝 +Z；僅視覺辨識，不改航向或飛控。
  const noseGeo = track(new THREE.ConeGeometry(0.06, 0.18, 10));
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.name = 'DroneNoseMarker';
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.12, -0.26);
  group.add(nose);
  const tail = new THREE.Mesh(noseGeo, white);
  tail.name = 'DroneTailMarker';
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.12, 0.26);
  group.add(tail);

  // 起落架：兩支橫桿，最低點 y≈0（地面待命時貼地）。
  const skidGeo = track(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 6));
  for (const x of [-0.12, 0.12]) {
    const skid = new THREE.Mesh(skidGeo, graphite);
    skid.rotation.z = Math.PI / 2;
    skid.position.set(x, 0.02, 0.02);
    group.add(skid);
  }

  return { group, rotors };
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
    track(new THREE.MeshStandardMaterial({ color: 0x6c8258, roughness: 0.96 })),
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

  // 純教學視覺圍網：由操作區推導，沒有碰撞、飛行邊界或成績判定語意。
  scene.add(createVisualFence(track, field));

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
  hOuter.name = 'LandingPointH';
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

  // 機體：可辨識的四軸模型（機身＋四臂＋四馬達＋四槳＋機頭指示）。
  // 尺寸對照附件十二級別 I 樣機軸距 90–110cm（馬達對角 1.00m）；顏色提高
  // 對比（深灰機身＋白頂蓋＋前臂紅色＋機頭黃錐），確保在考生視角與全景下
  // 都可辨識。此模型即考試模式實際渲染的機體，由同一飛控 setDronePose 驅動，
  // 不存在「展示用假飛機」。
  const drone = createExamQuad(track);
  scene.add(drone.group);

  // 航跡線（動態）。
  const trajGeo = track(new THREE.BufferGeometry());
  const trajPositions: number[] = [];
  const trajectory = new THREE.Line(
    trajGeo,
    track(new THREE.LineBasicMaterial({ color: TRAJECTORY_COLOR })),
  );
  scene.add(trajectory);

  let lastDroneUpdateMs = performance.now();

  // 風向箭頭（動態）。
  const windArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.1, 0), 3, 0x4fa3ff, 0.8, 0.5);
  scene.add(windArrow);

  return {
    field,
    setDronePose(position, headingDeg) {
      drone.group.position.set(position.x, position.y, position.z);
      drone.group.rotation.y = -(headingDeg * Math.PI) / 180;
      // 槳葉旋轉（純視覺，不影響飛控與科目判定）：待命慢轉、離地快轉。
      const now = performance.now();
      const dt = Math.min(Math.max((now - lastDroneUpdateMs) / 1000, 0), 0.1);
      lastDroneUpdateMs = now;
      const spin = position.y > 0.02 ? 30 : 5;
      drone.rotors.forEach((rotor, i) => {
        rotor.rotation.y += spin * dt * (i % 2 === 0 ? 1 : -1);
      });
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
