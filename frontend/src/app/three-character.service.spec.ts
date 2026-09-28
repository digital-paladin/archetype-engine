// three-character.service.spec.ts
// Unit tests for the bone-projection overlay pieces (BODY_PART_BONE_MAP,
// getBoneScreenPosition, getBodyPartScreenPosition, onFrame/offFrame).
// initScene()/animate() need a real WebGL context and are not covered here —
// these tests exercise the pure Vector3.project() math against a hand-built
// bone hierarchy + camera, bypassing initScene() by setting the private
// character/camera fields directly.

import * as THREE from 'three';
import { ThreeCharacterService, BODY_PART_BONE_MAP } from './three-character.service';
import { BodyPart } from './body-status.interface';

function makeCameraLookingAtOrigin(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 1.5, 3);
  camera.lookAt(0, 1.2, 0);
  camera.updateMatrixWorld();
  return camera;
}

/** Minimal fake skeleton: a character Group with a few named child bones at known positions. */
function makeFakeCharacter(bones: Record<string, THREE.Vector3>): THREE.Group {
  const character = new THREE.Group();
  for (const [name, pos] of Object.entries(bones)) {
    const bone = new THREE.Object3D();
    bone.name = name;
    bone.position.copy(pos);
    character.add(bone);
  }
  character.updateMatrixWorld(true);
  return character;
}

function makeService(character: THREE.Group, camera: THREE.PerspectiveCamera): ThreeCharacterService {
  const svc = new ThreeCharacterService();
  (svc as any).character = character;
  (svc as any).camera = camera;
  return svc;
}

describe('BODY_PART_BONE_MAP', () => {
  const ALL_BODY_PARTS: BodyPart[] = [
    'head', 'neck', 'chest', 'abdomen',
    'left-shoulder', 'right-shoulder',
    'left-upper-arm', 'right-upper-arm',
    'left-forearm', 'right-forearm',
    'left-hand', 'right-hand',
    'left-hip', 'right-hip',
    'left-thigh', 'right-thigh',
    'left-knee', 'right-knee',
    'left-calf', 'right-calf',
    'left-ankle', 'right-ankle',
    'left-foot', 'right-foot',
    'back-upper', 'back-lower',
  ];

  it('covers all 26 BodyPart values', () => {
    for (const part of ALL_BODY_PARTS) {
      expect(BODY_PART_BONE_MAP[part]).toBeDefined();
      expect(BODY_PART_BONE_MAP[part].bone.length).toBeGreaterThan(0);
    }
    expect(Object.keys(BODY_PART_BONE_MAP)).toHaveLength(ALL_BODY_PARTS.length);
  });

  it('every midpointToParent entry declares a secondaryBone', () => {
    for (const mapping of Object.values(BODY_PART_BONE_MAP)) {
      if (mapping.anchor === 'midpointToParent') {
        expect(mapping.secondaryBone).toBeTruthy();
      }
    }
  });
});

describe('getBoneScreenPosition', () => {
  it('returns null when the bone cannot be resolved at all', () => {
    const character = makeFakeCharacter({ Head: new THREE.Vector3(0, 1.6, 0) });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    expect(svc.getBoneScreenPosition('NoSuchBone')).toBeNull();
  });

  it('resolves a bare bone name directly when it exists on the character', () => {
    const character = makeFakeCharacter({ Head: new THREE.Vector3(0, 1.2, 0) });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    const result = svc.getBoneScreenPosition('Head');
    expect(result).not.toBeNull();
    // Camera looks directly at (0, 1.2, 0) — should project near dead-center.
    expect(result!.xPct).toBeCloseTo(50, 0);
    expect(result!.yPct).toBeCloseTo(50, 0);
  });

  it('resolves a bare name to its mixamorig-prefixed equivalent on the skeleton', () => {
    const character = makeFakeCharacter({ mixamorigHead: new THREE.Vector3(0, 1.2, 0) });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    const result = svc.getBoneScreenPosition('Head');
    expect(result).not.toBeNull();
  });

  it('resolves a mixamorig-prefixed name to its bare equivalent on the skeleton', () => {
    const character = makeFakeCharacter({ Head: new THREE.Vector3(0, 1.2, 0) });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    const result = svc.getBoneScreenPosition('mixamorigHead');
    expect(result).not.toBeNull();
  });

  it('computes the midpoint when a secondaryBoneName is provided', () => {
    const character = makeFakeCharacter({
      LeftArm:     new THREE.Vector3(-0.5, 1.4, 0),
      LeftForeArm: new THREE.Vector3(-0.5, 1.0, 0),
    });
    const svc = makeService(character, makeCameraLookingAtOrigin());

    const midpoint = svc.getBoneScreenPosition('LeftArm', 'LeftForeArm');
    const jointOnly = svc.getBoneScreenPosition('LeftArm');

    expect(midpoint).not.toBeNull();
    expect(jointOnly).not.toBeNull();
    // Midpoint sits lower (higher yPct) than the upper joint alone, given the camera framing.
    expect(midpoint!.yPct).not.toBeCloseTo(jointOnly!.yPct, 3);
  });

  it('falls back to the primary bone alone when the secondary bone does not resolve', () => {
    const character = makeFakeCharacter({ LeftArm: new THREE.Vector3(-0.5, 1.4, 0) });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    const result = svc.getBoneScreenPosition('LeftArm', 'NoSuchBone');
    expect(result).not.toBeNull();
  });

  it('returns null when there is no camera set', () => {
    const character = makeFakeCharacter({ Head: new THREE.Vector3(0, 1.2, 0) });
    const svc = new ThreeCharacterService();
    (svc as any).character = character;
    expect(svc.getBoneScreenPosition('Head')).toBeNull();
  });

  it('differentiates left/right screen position for offset bones', () => {
    const character = makeFakeCharacter({
      LeftHand:  new THREE.Vector3(-0.6, 1.2, 0),
      RightHand: new THREE.Vector3(0.6, 1.2, 0),
    });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    const left = svc.getBoneScreenPosition('LeftHand');
    const right = svc.getBoneScreenPosition('RightHand');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left!.xPct).toBeLessThan(right!.xPct);
  });
});

describe('getBodyPartScreenPosition', () => {
  it('delegates to the mapped bone for a joint-anchor body part', () => {
    const character = makeFakeCharacter({ Head: new THREE.Vector3(0, 1.7, 0) });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    expect(svc.getBodyPartScreenPosition('head')).not.toBeNull();
  });

  it('delegates to the bone pair for a midpointToParent-anchor body part', () => {
    const character = makeFakeCharacter({
      LeftLeg:  new THREE.Vector3(-0.2, 0.5, 0),
      LeftFoot: new THREE.Vector3(-0.2, 0.05, 0),
    });
    const svc = makeService(character, makeCameraLookingAtOrigin());
    expect(svc.getBodyPartScreenPosition('left-calf')).not.toBeNull();
  });

  it('returns null when the mapped bone is absent from this skeleton', () => {
    const character = makeFakeCharacter({}); // empty skeleton
    const svc = makeService(character, makeCameraLookingAtOrigin());
    expect(svc.getBodyPartScreenPosition('head')).toBeNull();
  });
});

describe('onFrame / offFrame', () => {
  it('registers a callback that can later be removed', () => {
    const svc = new ThreeCharacterService();
    let calls = 0;
    const cb = () => { calls++; };

    svc.onFrame(cb);
    expect((svc as any).frameCallbacks).toContain(cb);

    svc.offFrame(cb);
    expect((svc as any).frameCallbacks).not.toContain(cb);
    expect(calls).toBe(0); // never manually invoked in this test — just registration bookkeeping
  });

  it('dispose() clears any registered frame callbacks', () => {
    const svc = new ThreeCharacterService();
    (svc as any).renderer = { dispose: () => {} };
    (svc as any).scene = { clear: () => {} };
    svc.onFrame(() => {});
    svc.dispose();
    expect((svc as any).frameCallbacks).toHaveLength(0);
  });
});
