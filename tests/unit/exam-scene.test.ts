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
});
