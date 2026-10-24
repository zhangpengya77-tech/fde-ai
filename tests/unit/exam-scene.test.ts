import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildExamField } from '../../src/exam/field';
import { loadExamConfig } from '../../src/exam/config';
import { createExamScene } from '../../src/exam/scene';

const config = loadExamConfig();
const field = buildExamField(config);

function newScene(): THREE.Scene {
  return new THREE.Scene();
}

describe('考場場景 — 機體', () => {
  it('初始化後場景內存在 ExamDrone 機體（同一場景、非展示用假飛機）', () => {
    const scene = newScene();
    createExamScene(scene, field);
    const drone = scene.getObjectByName('ExamDrone');
    expect(drone).toBeTruthy();
  });

  it('機體包含機身、四臂、四馬達、四槳與機頭（可辨識的四軸）', () => {
    const scene = newScene();
    createExamScene(scene, field);
    const drone = scene.getObjectByName('ExamDrone') as THREE.Group;
    // 直接子物件：機身、頂蓋、飾條、4 臂、4 馬達、4 槳組、機頭錐、2 起落架 = 17。
    expect(drone.children.length).toBeGreaterThanOrEqual(16);
    const rotorGroups = drone.children.filter((c) => c instanceof THREE.Group);
    expect(rotorGroups.length).toBe(4);
    for (const rotor of rotorGroups) {
      expect(rotor.children.length).toBe(2); // 槳葉 + 槳轂
    }
  });

  it('機體尺寸合理：整體跨距 0.9–1.3m（附件十二級別 I 樣機 90–110cm 量級）', () => {
    const scene = newScene();
    createExamScene(scene, field);
    const drone = scene.getObjectByName('ExamDrone') as THREE.Group;
    const box = new THREE.Box3().setFromObject(drone);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeGreaterThan(0.9);
    expect(size.x).toBeLessThan(1.3);
    expect(size.z).toBeGreaterThan(0.9);
    expect(size.z).toBeLessThan(1.3);
  });

  it('地面待命（y=0）時機體不埋入地面：最低點 ≥ 0', () => {
    const scene = newScene();
    const handle = createExamScene(scene, field);
    handle.setDronePose({ x: 0, y: 0, z: 0 }, 0);
    const drone = scene.getObjectByName('ExamDrone') as THREE.Group;
    const box = new THREE.Box3().setFromObject(drone);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
  });

  it('setDronePose 同步位置與航向（heading 90 → rotation.y = −π/2）', () => {
    const scene = newScene();
    const handle = createExamScene(scene, field);
    handle.setDronePose({ x: 1, y: 1.5, z: -2 }, 90);
    const drone = scene.getObjectByName('ExamDrone') as THREE.Group;
    expect(drone.position.x).toBeCloseTo(1, 5);
    expect(drone.position.y).toBeCloseTo(1.5, 5);
    expect(drone.position.z).toBeCloseTo(-2, 5);
    expect(drone.rotation.y).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('以紅色機頭與獨立白色機尾標記固定本地 −Z/+Z 前後軸，不改變 1.00m 對角馬達距', () => {
    const scene = newScene();
    const handle = createExamScene(scene, field);
    const drone = scene.getObjectByName('ExamDrone') as THREE.Group;
    const nose = drone.getObjectByName('DroneNoseMarker') as THREE.Mesh | undefined;
    const tail = drone.getObjectByName('DroneTailMarker') as THREE.Mesh | undefined;

    expect(nose).toBeTruthy();
    expect(tail).toBeTruthy();
    if (!nose || !tail) throw new Error('expected directional markers to exist');
    expect(nose.position.z).toBeLessThan(0);
    expect(tail.position.z).toBeGreaterThan(0);
    expect((nose.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xd8493f);
    expect((tail.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xe8ece7);

    const motorFrontLeft = drone.getObjectByName('MotorFrontLeft') as THREE.Mesh | undefined;
    const motorRearRight = drone.getObjectByName('MotorRearRight') as THREE.Mesh | undefined;
    expect(motorFrontLeft).toBeTruthy();
    expect(motorRearRight).toBeTruthy();
    if (!motorFrontLeft || !motorRearRight) throw new Error('expected named motors to exist');
    expect(motorFrontLeft.position.distanceTo(motorRearRight.position)).toBeCloseTo(1, 5);

    handle.setDronePose({ x: 3, y: 1, z: -2 }, 90);
    drone.updateMatrixWorld(true);
    const noseWorld = nose.getWorldPosition(new THREE.Vector3());
    const tailWorld = tail.getWorldPosition(new THREE.Vector3());
    expect(noseWorld.x).toBeGreaterThan(3);
    expect(tailWorld.x).toBeLessThan(3);
    expect(noseWorld.z).toBeCloseTo(-2, 5);
    expect(tailWorld.z).toBeCloseTo(-2, 5);
  });
});

describe('考場場景 — P0-D 純視覺圍網', () => {
  it('由既有操作區邊界推導 2m 退縮、2m 高的視覺圍網，不碰撞也不改變考試幾何', () => {
    const scene = newScene();
    createExamScene(scene, field);
    const fence = scene.getObjectByName('ExamVisualFence') as THREE.Group | undefined;

    expect(fence).toBeTruthy();
    if (!fence) throw new Error('expected the visual fence to exist');
    expect(fence.userData.visualOnly).toBe(true);
    expect(fence.userData.collisionEnabled).toBe(false);
    expect(fence.userData.scoringEnabled).toBe(false);
    expect(fence.userData.heightM).toBe(2);
    expect(fence.userData.setbackM).toBe(2);
    expect(fence.userData.outerWidthM).toBe(field.operationArea.widthM + 4);
    expect(fence.userData.outerLengthM).toBe(field.operationArea.lengthM + 4);

    const h = scene.getObjectByName('LandingPointH') as THREE.Object3D;
    const p4 = scene.getObjectByName('Cone_P4') as THREE.Object3D;
    expect(h.position.x).toBeCloseTo(field.landingPointH.position.x, 5);
    expect(h.position.z).toBeCloseTo(field.landingPointH.position.z, 5);
    expect(p4.position.x).toBeCloseTo(field.figure8.cones.P4.x, 5);
    expect(p4.position.z).toBeCloseTo(field.figure8.cones.P4.z, 5);
  });
});
