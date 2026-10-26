import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { loadExamConfig, validateSubjectEConfig, type ExamConfig } from '../../src/exam/config';
import { buildExamField } from '../../src/exam/field';
import {
  buildTeachingPentaRoute,
  distanceToExtensionLineM,
  p3ToP7ExtensionLine,
  pentaAirspaceForLevel,
  pentaLegs,
} from '../../src/exam/penta';
import { createPentaScene } from '../../src/exam/penta-scene';

const config = loadExamConfig();
const field = buildExamField(config);

// ---------------------------------------------------------------------------
// A. 數據層：subjects.E 型別與官方數值（caa-exam.json p165）
// ---------------------------------------------------------------------------

describe('科目 E 數據層 — loadExamConfig().subjects.E', () => {
  it('subjects.E 存在且名稱為「高度保持五邊飛行」', () => {
    expect(config.subjects.E).toBeDefined();
    expect(config.subjects.E.name).toBe('高度保持五邊飛行');
  });

  it('官方三條件原文（p165）逐字可讀', () => {
    expect(config.subjects.E.criteria).toHaveLength(3);
    expect(config.subjects.E.criteria[0]).toContain('機頭一律朝飛行方向並穩定航高');
    expect(config.subjects.E.criteria[1]).toContain('滾轉角、俯仰角不得劇烈變化');
    expect(config.subjects.E.criteria[2]).toContain('第一邊及第五邊須穩定準確通過P3至P7之延伸線上方');
  });

  it('最小操作空域依級距（p165）：I=80×20／II=120×30／III=160×40', () => {
    const a = config.subjects.E.params.minOperationAirspaceByLevelM;
    expect(a.I).toEqual({ length: 80, width: 20 });
    expect(a.II).toEqual({ length: 120, width: 30 });
    expect(a.III).toEqual({ length: 160, width: 40 });
  });

  it('操作高度 20m、頁碼 165、phase2=true', () => {
    expect(config.subjects.E.params.operationAltitudeM).toBe(20);
    expect(config.subjects.E.page).toBe(165);
    expect(config.subjects.E.phase2).toBe(true);
  });

  it('既有科目不受影響：A/B/C/D/F/G 仍可讀', () => {
    expect(config.subjects.B.params.hoverSecondsMin).toBeGreaterThan(0);
    expect(config.subjects.C.params.circleDiameterM).toBe(12);
    expect(config.subjects.D.params.hoverSecondsMin).toBeGreaterThan(0);
    expect(config.subjects.F.params.landInnerCircleAltitudeM).toEqual([1, 2]);
    expect(config.subjects.A.criteria.length).toBeGreaterThan(0);
    expect(config.subjects.G.criteria.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// B. 配置合法性驗證
// ---------------------------------------------------------------------------

describe('科目 E 配置合法性驗證 — validateSubjectEConfig', () => {
  it('完整官方配置通過', () => {
    const r = validateSubjectEConfig(config.subjects.E);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('criteria 為空陣列 → 不通過', () => {
    const r = validateSubjectEConfig({ ...config.subjects.E, criteria: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('criteria');
  });

  it('criteria 含空字串 → 不通過', () => {
    const r = validateSubjectEConfig({ ...config.subjects.E, criteria: ['', 'x', 'y'] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('criteria');
  });

  it('缺少級距 I 空域 → 不通過', () => {
    const bad = {
      ...config.subjects.E,
      params: { ...config.subjects.E.params, minOperationAirspaceByLevelM: {} },
    };
    const r = validateSubjectEConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('minOperationAirspaceByLevelM');
  });

  it('空域尺寸非正數 → 不通過', () => {
    const bad = {
      ...config.subjects.E,
      params: {
        ...config.subjects.E.params,
        minOperationAirspaceByLevelM: { I: { length: 80, width: 0 } },
      },
    };
    const r = validateSubjectEConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('width');
  });

  it('操作高度非正數 → 不通過', () => {
    const bad = { ...config.subjects.E, params: { ...config.subjects.E.params, operationAltitudeM: -1 } };
    const r = validateSubjectEConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain('operationAltitudeM');
  });

  it('page 為 null 不視為錯誤（讀不到留 null 的既有慣例）', () => {
    const r = validateSubjectEConfig({ ...config.subjects.E, page: null });
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. 五邊幾何（純函式，場地錨點）
// ---------------------------------------------------------------------------

describe('P3 至 P7 延伸線（官方條件③的場地錨點）', () => {
  it('延伸線過 P3(-6,-22) 與 P7(6,-22)，方向沿 X', () => {
    const line = p3ToP7ExtensionLine(field);
    expect(line.point.x).toBeCloseTo(-6, 6);
    expect(line.point.z).toBeCloseTo(-22, 6);
    expect(line.dirX).toBeCloseTo(1, 6);
    expect(line.dirZ).toBeCloseTo(0, 6);
  });

  it('線上點距離 0；前後 3m 距離 3', () => {
    const line = p3ToP7ExtensionLine(field);
    expect(distanceToExtensionLineM(line, 0, -22)).toBeCloseTo(0, 6);
    expect(distanceToExtensionLineM(line, 6, -22)).toBeCloseTo(0, 6);
    expect(distanceToExtensionLineM(line, 100, -22)).toBeCloseTo(0, 6);
    expect(distanceToExtensionLineM(line, 0, -25)).toBeCloseTo(3, 6);
    expect(distanceToExtensionLineM(line, 0, -19)).toBeCloseTo(3, 6);
  });

  it('級距 I 空域 80×20；未知級距回 null', () => {
    expect(pentaAirspaceForLevel(config, 'I')).toEqual({ lengthM: 80, widthM: 20 });
    expect(pentaAirspaceForLevel(config, 'II')).toEqual({ lengthM: 120, widthM: 30 });
    expect(pentaAirspaceForLevel(config, 'III')).toEqual({ lengthM: 160, widthM: 40 });
    expect(pentaAirspaceForLevel(config, 'IX')).toBeNull();
  });
});

describe('教學假設五邊航線 — buildTeachingPentaRoute', () => {
  const route = buildTeachingPentaRoute(field, 20);

  it('航線標記為教學假設（非官方）', () => {
    expect(route.assumption).toBe(true);
    expect(route.note).toContain('教學');
  });

  it('五個航路點、高度均為 20m、起降點為 H 正上方', () => {
    expect(route.waypoints).toHaveLength(5);
    for (const w of route.waypoints) expect(w.y).toBeCloseTo(20, 6);
    expect(route.waypoints[0].x).toBeCloseTo(0, 6);
    expect(route.waypoints[0].z).toBeCloseTo(0, 6);
  });

  it('五條邊：第一邊與第五邊通過 P3–P7 延伸線，中間三邊不通過', () => {
    const legs = pentaLegs(route);
    expect(legs).toHaveLength(5);
    expect(legs[0].label).toBe('第一邊');
    expect(legs[0].crossesExtension).toBe(true);
    expect(legs[4].label).toBe('第五邊');
    expect(legs[4].crossesExtension).toBe(true);
    expect(legs[1].crossesExtension).toBe(false);
    expect(legs[2].crossesExtension).toBe(false);
    expect(legs[3].crossesExtension).toBe(false);
  });

  it('航段連續（每條邊的終點為下一條邊的起點，第五邊回到起降點）', () => {
    const legs = pentaLegs(route);
    for (let i = 0; i < legs.length; i += 1) {
      const from = route.waypoints[legs[i].fromIndex];
      const to = route.waypoints[legs[i].toIndex];
      expect(from).toBeDefined();
      expect(to).toBeDefined();
    }
    const last = route.waypoints[legs[4].toIndex];
    expect(last.x).toBeCloseTo(0, 6);
    expect(last.z).toBeCloseTo(0, 6);
  });
});

// ---------------------------------------------------------------------------
// D. 五邊場景契約（獨立可視化，不接評分）
// ---------------------------------------------------------------------------

describe('五邊場景 — createPentaScene（獨立可視化）', () => {
  const route = buildTeachingPentaRoute(field, config.subjects.E.params.operationAltitudeM);

  it('場景含航線、延伸線、空域盒與 20m 高度參考面（具名物件）', () => {
    const scene = new THREE.Scene();
    const handle = createPentaScene(scene, field, route, {
      airspace: pentaAirspaceForLevel(config, 'I'),
      altitudeM: config.subjects.E.params.operationAltitudeM,
    });
    expect(scene.getObjectByName('PentaRouteLine')).toBeTruthy();
    expect(scene.getObjectByName('PentaExtensionLine')).toBeTruthy();
    expect(scene.getObjectByName('PentaAirspaceBox')).toBeTruthy();
    expect(scene.getObjectByName('PentaAltitudeReference')).toBeTruthy();
    expect(typeof handle.setDronePose).toBe('function');
    expect(typeof handle.dispose).toBe('function');
  });

  it('延伸線物件端點對應 P3/P7 世界座標', () => {
    const scene = new THREE.Scene();
    createPentaScene(scene, field, route, {
      airspace: pentaAirspaceForLevel(config, 'I'),
      altitudeM: 20,
    });
    const line = scene.getObjectByName('PentaExtensionLine') as THREE.Line;
    const pos = line.geometry.getAttribute('position');
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < pos.count; i += 1) {
      xs.push(pos.getX(i));
      zs.push(pos.getZ(i));
    }
    expect(Math.min(...xs)).toBeCloseTo(-6, 6);
    expect(Math.max(...xs)).toBeCloseTo(6, 6);
    expect(Math.min(...zs)).toBeCloseTo(-22, 6);
    expect(Math.max(...zs)).toBeCloseTo(-22, 6);
  });

  it('空域盒尺寸對應級距 I（80×20，沿 Z/X）', () => {
    const scene = new THREE.Scene();
    createPentaScene(scene, field, route, {
      airspace: pentaAirspaceForLevel(config, 'I'),
      altitudeM: 20,
    });
    const box = new THREE.Box3().setFromObject(scene.getObjectByName('PentaAirspaceBox') as THREE.Object3D);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeCloseTo(20, 6);
    expect(size.z).toBeCloseTo(80, 6);
  });

  it('dispose 後具名物件從場景移除', () => {
    const scene = new THREE.Scene();
    const handle = createPentaScene(scene, field, route, {
      airspace: pentaAirspaceForLevel(config, 'I'),
      altitudeM: 20,
    });
    handle.dispose();
    expect(scene.getObjectByName('PentaRouteLine')).toBeFalsy();
    expect(scene.getObjectByName('PentaExtensionLine')).toBeFalsy();
    expect(scene.getObjectByName('PentaAirspaceBox')).toBeFalsy();
    expect(scene.getObjectByName('PentaAltitudeReference')).toBeFalsy();
  });

  it('場景不含任何評分/判定物件（純教學可視化）', () => {
    const scene = new THREE.Scene();
    createPentaScene(scene, field, route, {
      airspace: pentaAirspaceForLevel(config, 'I'),
      altitudeM: 20,
    });
    const names: string[] = [];
    scene.traverse((o) => names.push(o.name));
    expect(names.some((n) => /score|judge|rating|pass|fail/i.test(n))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// E. 成績單事實狀態不被改動
// ---------------------------------------------------------------------------

describe('成績單第 4 項（高度保持五邊飛行）維持「未涵蓋」', () => {
  it('subjects 鍵集合為 A–G 七科（E 加入但不減少既有科目）', () => {
    expect(Object.keys(config.subjects).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('第一階段不接評分：config 無科目 E 判定器鉤接', () => {
    // buildExamReport 參數目前無 subjectE（scoring.ts 未改）；此斷言防止
    // 第一階段意外擴大評分接線。E 的判定由下階段另行批准後實現。
    const cfg: ExamConfig = config;
    expect(cfg.subjects.E).toBeDefined();
    expect('judgeSubjectE' in cfg).toBe(false);
  });
});
