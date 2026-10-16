import * as THREE from 'three';

import {
  buildTransmissionLayout,
  CROSS_ARM_Y,
  type ObstacleSpec,
  type TowerSpec,
  type TransmissionLayout,
  type WireSpec,
} from '../SceneDefinition';
import type { SafetyState, Vec3 } from '../../inspection/types';

export interface TransmissionSceneHandle {
  layout: TransmissionLayout;
  towerCount: number;
  wireCount: number;
  /** Recolour the inspection-zone ring/volume to reflect the live safety state. */
  setZoneHighlight(state: SafetyState): void;
  dispose(): void;
}

const STEEL = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.55, roughness: 0.5 });
const CONDUCTOR = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0x2c2f31, metalness: 0.7, roughness: 0.45 });
const PORCELAIN = (): THREE.MeshStandardMaterial =>
  new THREE.MeshStandardMaterial({ color: 0xd7cfc4, metalness: 0.1, roughness: 0.65 });

function strut(from: Vec3, to: Vec3, radius: number, material: THREE.Material): THREE.Mesh {
  const start = new THREE.Vector3(from.x, from.y, from.z);
  const end = new THREE.Vector3(to.x, to.y, to.z);
  const length = start.distanceTo(end);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), material);
  mesh.position.copy(start.clone().lerp(end, 0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  mesh.castShadow = true;
  return mesh;
}

/** A simplified lattice transmission tower with a cross arm at CROSS_ARM_Y. */
function createTower(tower: TowerSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = `Tower_${tower.id}`;
  group.userData.fdeKind = 'tower';

  const steel = STEEL();
  const cx = tower.base.x;
  const cz = tower.base.z;
  const height = tower.height;
  const baseHalf = 1.2;
  const topHalf = 0.4;
  const corners: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  // Four tapered legs from the base to the top.
  for (const [sx, sz] of corners) {
    const bottom: Vec3 = { x: cx + sx * baseHalf, y: 0, z: cz + sz * baseHalf };
    const top: Vec3 = { x: cx + sx * topHalf, y: height, z: cz + sz * topHalf };
    group.add(strut(bottom, top, 0.11, steel));
  }

  // Horizontal square braces at several heights.
  const levels = [0, 0.28, 0.56, 0.84, 1];
  for (const t of levels) {
    const y = height * t;
    const half = baseHalf + (topHalf - baseHalf) * t;
    const pts = [
      new THREE.Vector3(cx - half, y, cz - half),
      new THREE.Vector3(cx + half, y, cz - half),
      new THREE.Vector3(cx + half, y, cz + half),
      new THREE.Vector3(cx - half, y, cz + half),
    ];
    for (let i = 0; i < 4; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      group.add(strut({ x: a.x, y: a.y, z: a.z }, { x: b.x, y: b.y, z: b.z }, 0.045, steel));
    }
  }

  // Cross arm at the attachment height, reaching to the right of the tower.
  const armLength = 4.4;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(armLength, 0.18, 0.18), steel);
  arm.position.set(cx, CROSS_ARM_Y, cz);
  arm.castShadow = true;
  group.add(arm);
  // Short vertical mast above the cross arm.
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.0, 6), steel);
  mast.position.set(cx, height + 0.5, cz);
  mast.castShadow = true;
  group.add(mast);

  return group;
}

/** A sagging conductor rendered as a tube following the resolved poly-line. */
function createWire(wire: WireSpec, samples: Vec3[]): THREE.Mesh {
  const points = samples.map((sample) => new THREE.Vector3(sample.x, sample.y, sample.z));
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, Math.max(24, samples.length * 2), 0.045, 6, false);
  const mesh = new THREE.Mesh(geometry, CONDUCTOR());
  mesh.name = `Wire_${wire.id}`;
  mesh.userData.fdeKind = 'wire';
  mesh.castShadow = true;
  return mesh;
}

/**
 * The right-side insulator string of a tower. The teaching defect (a missing
 * disc) is modelled as a visible gap at `defectY` plus a red marker.
 */
function createInsulatorString(
  top: Vec3,
  bottomY: number,
  defectY: number,
  defective: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const porcelain = PORCELAIN();
  const link = STEEL();

  const step = 0.42;
  for (let y = top.y; y >= bottomY; y -= step) {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.14, 14), porcelain);
    disc.position.set(top.x, y, top.z);
    disc.castShadow = true;
    group.add(disc);
    if (y - step >= bottomY) {
      group.add(strut({ x: top.x, y: y - 0.07, z: top.z }, { x: top.x, y: y - step + 0.07, z: top.z }, 0.02, link));
    }
  }

  if (defective) {
    // Red marker at the gap where a disc is missing.
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0x5a0000, roughness: 0.4 }),
    );
    marker.position.set(top.x, defectY, top.z);
    group.add(marker);
  }

  return group;
}

function createObstacle(obstacle: ObstacleSpec): THREE.Group {
  const group = new THREE.Group();
  group.name = `Obstacle_${obstacle.id}`;
  group.userData.fdeKind = 'obstacle';

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8),
    new THREE.MeshStandardMaterial({ color: 0x5b3d22, roughness: 0.9 }),
  );
  trunk.position.set(obstacle.position.x, 1.1, obstacle.position.z);
  trunk.castShadow = true;
  group.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.SphereGeometry(obstacle.radius + 0.3, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x3f7d43, roughness: 0.85 }),
  );
  foliage.position.set(obstacle.position.x, 2.6, obstacle.position.z);
  foliage.castShadow = true;
  group.add(foliage);

  return group;
}

const SAFETY_COLORS: Record<SafetyState, number> = {
  SAFE: 0x3bd18a,
  WARNING: 0xe3b84f,
  DANGER: 0xff8c42,
  COLLISION: 0xff4d4d,
};

export function createTransmissionScene(
  scene: THREE.Scene,
  layout: TransmissionLayout = buildTransmissionLayout(),
): TransmissionSceneHandle {
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(item: T): T => {
    disposables.push(item);
    return item;
  };

  scene.background = new THREE.Color(0xbcd0c6);
  scene.fog = new THREE.Fog(0xbcd0c6, 45, 130);

  const hemisphere = new THREE.HemisphereLight(0xf5fff9, 0x4e5e4a, 2.1);
  scene.add(hemisphere);
  const sun = new THREE.DirectionalLight(0xfff1ce, 3.0);
  sun.position.set(20, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  scene.add(sun);

  const ground = new THREE.Mesh(
    track(new THREE.PlaneGeometry(160, 160)),
    track(new THREE.MeshStandardMaterial({ color: 0x6f846b, roughness: 0.96 })),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(160, 80, 0x385845, 0x7e927b);
  grid.position.y = 0.015;
  scene.add(grid);

  // Service road running along x in front of the line.
  const road = new THREE.Mesh(
    track(new THREE.PlaneGeometry(150, 4)),
    track(new THREE.MeshStandardMaterial({ color: 0x2f3330, roughness: 0.95 })),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -3);
  road.receiveShadow = true;
  scene.add(road);
  for (let x = -70; x <= 70; x += 6) {
    const dash = new THREE.Mesh(
      track(new THREE.PlaneGeometry(2, 0.18)),
      track(new THREE.MeshStandardMaterial({ color: 0xc9c2ac, roughness: 0.8 })),
    );
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.03, -3);
    scene.add(dash);
  }

  const boundary = new THREE.LineLoop(
    track(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-30, 0.04, -16),
        new THREE.Vector3(30, 0.04, -16),
        new THREE.Vector3(30, 0.04, 16),
        new THREE.Vector3(-30, 0.04, 16),
      ]),
    ),
    track(new THREE.LineBasicMaterial({ color: 0x3bd18a })),
  );
  scene.add(boundary);

  // Towers.
  for (const tower of layout.towers) {
    scene.add(createTower(tower));
  }

  // Insulator strings: the first tower carries the teaching defect.
  layout.towers.forEach((tower, index) => {
    const defective = index === 0;
    const top: Vec3 = { x: tower.base.x + 1.6, y: CROSS_ARM_Y, z: tower.base.z };
    scene.add(createInsulatorString(top, CROSS_ARM_Y - 3.2, 8, defective));
  });

  // Sagging conductors.
  layout.wires.forEach((wire, index) => {
    scene.add(createWire(wire, layout.wireSamples[index]));
  });

  // Obstacles.
  for (const obstacle of layout.obstacles) {
    scene.add(createObstacle(obstacle));
  }

  // Inspection-zone ring + translucent volume around the target.
  const target = layout.target.position;
  const zoneRingMaterial = track(
    new THREE.MeshStandardMaterial({
      color: SAFETY_COLORS.SAFE,
      emissive: SAFETY_COLORS.SAFE,
      emissiveIntensity: 0.4,
      roughness: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  const ring = new THREE.Mesh(
    track(new THREE.RingGeometry(layout.inspectionZoneRadius - 0.25, layout.inspectionZoneRadius, 48)),
    zoneRingMaterial,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(target.x, 0.05, target.z);
  scene.add(ring);

  const zoneVolume = new THREE.Mesh(
    track(new THREE.CylinderGeometry(layout.inspectionZoneRadius, layout.inspectionZoneRadius, 12, 32, 1, true)),
    track(
      new THREE.MeshStandardMaterial({
        color: SAFETY_COLORS.SAFE,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  );
  zoneVolume.position.set(target.x, 6, target.z);
  scene.add(zoneVolume);

  // Target marker: a vertical guide beam + a marker sphere at the exact point.
  const targetMarker = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.22, 16, 16)),
    track(new THREE.MeshStandardMaterial({ color: 0xf4ca68, emissive: 0x6b4f00, roughness: 0.4 })),
  );
  targetMarker.position.set(target.x, target.y, target.z);
  targetMarker.userData.fdeKind = 'target';
  scene.add(targetMarker);

  const guide = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.04, 0.04, target.y, 8)),
    track(new THREE.MeshStandardMaterial({ color: 0xf4ca68, transparent: true, opacity: 0.35, depthWrite: false })),
  );
  guide.position.set(target.x, target.y / 2, target.z);
  scene.add(guide);

  return {
    layout,
    towerCount: layout.towers.length,
    wireCount: layout.wires.length,
    setZoneHighlight(state: SafetyState): void {
      zoneRingMaterial.color.setHex(SAFETY_COLORS[state]);
      zoneRingMaterial.emissive.setHex(SAFETY_COLORS[state]);
      (zoneVolume.material as THREE.MeshStandardMaterial).color.setHex(SAFETY_COLORS[state]);
    },
    dispose(): void {
      for (const item of disposables) item.dispose();
    },
  };
}
