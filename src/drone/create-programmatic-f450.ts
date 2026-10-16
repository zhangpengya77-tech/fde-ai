import * as THREE from 'three';

import type { FlightSnapshot } from '../flight/types';

export interface F450Entity {
  group: THREE.Group;
  source: 'programmatic' | 'glb';
  update(snapshot: FlightSnapshot, deltaSeconds: number): void;
  dispose(): void;
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  castShadow = true,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.castShadow = castShadow;
  result.receiveShadow = true;
  return result;
}

export function createProgrammaticF450(): F450Entity {
  const group = new THREE.Group();
  group.name = 'F450_Programmatic';

  const dark = new THREE.MeshStandardMaterial({ color: 0x242927, metalness: 0.42, roughness: 0.42 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x151918, metalness: 0.22, roughness: 0.52 });
  const red = new THREE.MeshStandardMaterial({ color: 0xd8493f, roughness: 0.48 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8ece7, roughness: 0.45 });
  const motorMaterial = new THREE.MeshStandardMaterial({ color: 0x858e88, metalness: 0.75, roughness: 0.28 });
  const propMaterial = new THREE.MeshStandardMaterial({ color: 0x202522, metalness: 0.18, roughness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: 0x69d696, emissive: 0x123321, roughness: 0.4 });
  const cameraMaterial = new THREE.MeshStandardMaterial({ color: 0x353b38, metalness: 0.35, roughness: 0.42 });
  const sharedMaterials = [dark, carbon, red, white, motorMaterial, propMaterial, accent, cameraMaterial];

  const lowerPlate = mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.14, 12), carbon);
  lowerPlate.position.y = 0.18;
  group.add(lowerPlate);

  const upperPlate = mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.12, 12), dark);
  upperPlate.position.y = 0.45;
  group.add(upperPlate);

  const battery = mesh(new THREE.BoxGeometry(0.82, 0.28, 0.48), dark);
  battery.position.set(0, 0.66, 0.05);
  group.add(battery);

  const pixhawk = mesh(new THREE.BoxGeometry(0.48, 0.18, 0.38), accent);
  pixhawk.position.set(0, 0.86, -0.02);
  group.add(pixhawk);

  const gpsMast = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.62, 8), motorMaterial);
  gpsMast.position.set(0, 0.98, 0.28);
  group.add(gpsMast);
  const gps = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 12), white);
  gps.position.set(0, 1.3, 0.28);
  group.add(gps);

  const gimbalYaw = new THREE.Group();
  gimbalYaw.position.set(0, -0.05, -0.45);
  const gimbalPitch = new THREE.Group();
  gimbalYaw.add(gimbalPitch);
  const gimbalMount = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 12), motorMaterial);
  gimbalPitch.add(gimbalMount);
  const camera = mesh(new THREE.BoxGeometry(0.38, 0.26, 0.3), cameraMaterial);
  camera.position.z = -0.2;
  gimbalPitch.add(camera);
  const lens = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.08, 16), dark);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, -0.39);
  gimbalPitch.add(lens);
  group.add(gimbalYaw);

  const rotors: THREE.Group[] = [];
  const arms: Array<{ angle: number; material: THREE.Material }> = [
    { angle: Math.PI / 4, material: red },
    { angle: Math.PI * 3 / 4, material: white },
    { angle: Math.PI * 5 / 4, material: white },
    { angle: Math.PI * 7 / 4, material: red },
  ];

  for (const { angle, material } of arms) {
    const arm = mesh(new THREE.BoxGeometry(2.35, 0.16, 0.24), material);
    arm.position.set(Math.cos(angle) * 1.15, 0.34, Math.sin(angle) * 1.15);
    arm.rotation.y = -angle;
    group.add(arm);

    const motorX = Math.cos(angle) * 2.25;
    const motorZ = Math.sin(angle) * 2.25;
    const motor = mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.35, 16), motorMaterial);
    motor.position.set(motorX, 0.56, motorZ);
    group.add(motor);

    const rotor = new THREE.Group();
    rotor.position.set(motorX, 0.78, motorZ);
    const blade = mesh(new THREE.BoxGeometry(1.65, 0.035, 0.16), propMaterial);
    blade.geometry.translate(0, 0, 0);
    rotor.add(blade);
    const hub = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 12), dark);
    hub.position.y = 0.04;
    rotor.add(hub);
    group.add(rotor);
    rotors.push(rotor);
  }

  for (const x of [-0.48, 0.48]) {
    const leg = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8), dark);
    leg.position.set(x, -0.24, 0);
    group.add(leg);
  }
  for (const z of [-0.35, 0.35]) {
    const skid = mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.45, 8), dark);
    skid.rotation.z = Math.PI / 2;
    skid.position.set(0, -0.61, z);
    group.add(skid);
  }

  group.scale.setScalar(0.72);
  group.position.y = 0.5;

  return {
    group,
    source: 'programmatic',
    update(snapshot: FlightSnapshot, deltaSeconds: number): void {
      group.position.set(snapshot.position.x, snapshot.position.y + 0.5, snapshot.position.z);
      group.rotation.order = 'YXZ';
      group.rotation.y = THREE.MathUtils.degToRad(-snapshot.headingDeg);
      group.rotation.x = THREE.MathUtils.degToRad(snapshot.pitchDeg);
      group.rotation.z = THREE.MathUtils.degToRad(-snapshot.rollDeg);
      gimbalYaw.rotation.y = THREE.MathUtils.degToRad(0);
      gimbalPitch.rotation.x = THREE.MathUtils.degToRad(-25);

      const rotorSpeed = snapshot.state === 'disarmed' || snapshot.state === 'emergency' ? 0 : 22;
      rotors.forEach((rotor, index) => {
        rotor.rotation.y += rotorSpeed * deltaSeconds * (index % 2 === 0 ? 1 : -1);
      });
    },
    dispose(): void {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      sharedMaterials.forEach((material) => material.dispose());
      group.removeFromParent();
    },
  };
}
