import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface ActivityAnimation {
  type: 'prayer' | 'workout' | 'coding' | 'redteam' | 'artist' | 'fasting' | 'hydration' | 'protein' | 'levelup';
  animationName: string;
  xpGain: number;
  loop: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ThreeCharacterService {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private character!: THREE.Group;
  private mixer!: THREE.AnimationMixer;
  private animations: Map<string, THREE.AnimationAction> = new Map();
  private currentAnimation: THREE.AnimationAction | null = null;
  private clock = new THREE.Clock();
  private animationFrameId: number | null = null;

  constructor() {}

  initScene(canvas: HTMLCanvasElement): void {
    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = null; // Transparent — ESO panel background shows through

    // DEBUG: Canvas dimensions

    // If canvas has zero size, renderer will be invisible — force minimum
    const width  = canvas.clientWidth  || 240;
    const height = canvas.clientHeight || 400;

    // Camera (upper-body shot, slightly angled)
    this.camera = new THREE.PerspectiveCamera(
      45,
      width / height,
      0.1,
      1000
    );
    this.camera.position.set(0, 1.5, 3); // Eye level, slight distance
    this.camera.lookAt(0, 1.2, 0); // Focus on upper chest/head

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ 
      canvas, 
      antialias: true,
      alpha: true 
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;

    // DEBUG: Add a bright test cube so we know the renderer works regardless of model
    const testGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const testMat = new THREE.MeshBasicMaterial({ color: 0xc9a84c, wireframe: false });
    const testCube = new THREE.Mesh(testGeo, testMat);
    testCube.position.set(0, 1.2, 0);
    testCube.name = 'DEBUG_CUBE';
    this.scene.add(testCube);

    // Lighting (3-point lighting for character)
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(2, 3, 3);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-2, 1, 1);
    this.scene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
    backLight.position.set(0, 2, -2);
    this.scene.add(backLight);

    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    // Ground plane (optional, for shadow)
    const groundGeometry = new THREE.PlaneGeometry(10, 10);
    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.3 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Render one frame immediately so test cube appears before model loads
    this.renderer.render(this.scene, this.camera);
  }

  async loadCharacter(modelPath: string): Promise<void> {
    const loader = new GLTFLoader();

    return new Promise((resolve, reject) => {
      loader.load(
        modelPath,
        async (gltf) => {

          this.character = gltf.scene;
          this.character.position.set(0, 0, 0);

          // Auto-scale: normalize model height to 1.8 units
          const box = new THREE.Box3().setFromObject(this.character);
          const size = box.getSize(new THREE.Vector3());
          if (size.y > 0.01) {
            const scale = 1.8 / size.y;
            this.character.scale.setScalar(scale);
          }

          // Remove debug cube
          const debugCube = this.scene.getObjectByName('DEBUG_CUBE');
          if (debugCube) this.scene.remove(debugCube);

          this.character.traverse((node) => {
            if ((node as THREE.Mesh).isMesh) node.castShadow = true;
          });

          this.scene.add(this.character);

          // Setup mixer
          this.mixer = new THREE.AnimationMixer(this.character);

          // Load embedded animations — log track count to diagnose
          gltf.animations.forEach((clip) => {
            const key = clip.name || 'embedded-0';
            console.log('[3D ANIM] Embedded:', key, '— tracks:', clip.tracks.length, '— duration:', clip.duration.toFixed(2));
            this.animations.set(key, this.mixer.clipAction(clip));
          });

          // Load external animation files
          await this.loadExternalAnimations();

          // Pick animation with most tracks; tie-break by longest duration (avoids bind-pose clips)
          let bestKey = '';
          let bestTrackCount = 0;
          let bestDuration = 0;
          this.animations.forEach((action, name) => {
            const clip = action.getClip();
            const tracks = clip.tracks.length;
            const duration = clip.duration;
            console.log('[3D ANIM] Candidate:', name, '— tracks:', tracks, '— duration:', duration.toFixed(2) + 's');
            if (tracks > bestTrackCount || (tracks === bestTrackCount && duration > bestDuration)) {
              bestTrackCount = tracks;
              bestDuration = duration;
              bestKey = name;
            }
          });

          const bestAction = bestKey ? this.animations.get(bestKey) : null;
          if (bestAction) {
            bestAction.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
            this.currentAnimation = bestAction;
            console.log('[3D] Playing', bestKey, 'with', bestTrackCount, 'tracks,', bestDuration.toFixed(2) + 's');
          } else {
            console.warn('[3D] No animations found at all.');
          }

          resolve();
        },
        undefined,
        (error) => {
          console.error('GLTFLoader ERROR for path:', modelPath);
          console.error('Error details:', error);
          reject(error);
        }
      );
    });
  }

  private async loadExternalAnimations(): Promise<void> {
    const loader = new GLTFLoader();
    const animFiles: Array<{ name: string; path: string }> = [
      { name: 'idle',       path: 'assets/animations/idle.glb' },
      { name: 'Praying',    path: 'assets/animations/prayer.glb' },
      { name: 'sword-idle', path: 'assets/animations/sword-idle.glb' },
    ];

    // Collect ALL named nodes (not just isBone — GLTF loader may produce Object3D joints)
    const charBones: string[] = [];
    this.character.traverse(n => { if (n.name && n.name.length > 0) charBones.push(n.name); });
    console.log('[3D ANIM] Character bones (first 8):', charBones.slice(0, 8));
    console.log('[3D ANIM] Total named nodes in character:', charBones.length);

    for (const entry of animFiles) {
      try {
        const gltf = await new Promise<any>((res, rej) =>
          loader.load(entry.path, res, undefined, rej)
        );
        if (gltf.animations.length > 0) {
          const clip = gltf.animations[0];
          // Log raw track names so we can diagnose bone name format
          const rawTracks = clip.tracks.slice(0, 3).map((t: THREE.KeyframeTrack) => t.name);
          console.log('[3D ANIM] Raw track names for', entry.name, ':', rawTracks);

          // Remap bone names: AnyConv FBX→GLB uses bare names like "Hips"
          // Mixamo GLB uses "mixamorigHips" — remap to match character skeleton
          const remappedClip = this.remapMixamoBoneNames(clip, charBones);

          remappedClip.name = entry.name;
          const action = this.mixer.clipAction(remappedClip);
          this.animations.set(entry.name, action);
          console.log('[3D ANIM] Loaded animation:', entry.name, '— duration:', remappedClip.duration.toFixed(2), 's, tracks:', remappedClip.tracks.length);

          // Post-remap verification: check how many tracks actually resolve against character
          const unresolvedTracks = remappedClip.tracks.filter(t => {
            const dot = t.name.indexOf('.');
            const bn = dot > -1 ? t.name.substring(0, dot) : t.name;
            return !this.character.getObjectByName(bn);
          });
          if (unresolvedTracks.length === 0) {
            console.log(`[3D ANIM] ✅ All ${remappedClip.tracks.length} tracks resolved for "${entry.name}"`);
          } else {
            console.warn(`[3D ANIM] ⚠️ ${unresolvedTracks.length}/${remappedClip.tracks.length} UNRESOLVED tracks in "${entry.name}" — sample:`,
              unresolvedTracks.slice(0, 4).map(t => t.name));
          }
        } else {
          console.warn('[3D ANIM] No animation clips in:', entry.path);
        }
      } catch (e) {
        console.warn('[3D ANIM] Could not load animation:', entry.path, e);
      }
    }
  }

  private remapMixamoBoneNames(clip: THREE.AnimationClip, charBones: string[]): THREE.AnimationClip {
    const cloned = clip.clone();
    const charBoneSet = new Set(charBones);

    cloned.tracks.forEach((track: THREE.KeyframeTrack) => {
      // track.name format: "BoneName.property"
      const dot = track.name.indexOf('.');
      const boneName = dot > -1 ? track.name.substring(0, dot) : track.name;
      const prop = dot > -1 ? track.name.substring(dot) : '';

      if (charBoneSet.has(boneName)) return; // already matches — no remap needed

      // Case 1: bare name → add mixamorig prefix
      // e.g. "Hips" → "mixamorigHips" (character uses prefixed names)
      const withPrefix = 'mixamorig' + boneName.charAt(0).toUpperCase() + boneName.slice(1);
      if (charBoneSet.has(withPrefix)) {
        track.name = withPrefix + prop;
        return;
      }

      // Case 2: prefixed → strip to bare
      // e.g. "mixamorigHips" → "Hips" (character uses bare names)
      if (boneName.startsWith('mixamorig')) {
        const bare = boneName.slice(9); // strip 'mixamorig' (9 chars)
        if (charBoneSet.has(bare)) {
          track.name = bare + prop;
          return;
        }
      }

      // Case 3: strip "mixamo:" namespace prefix (Maya FBX export format)
      // e.g. "mixamo:Hips" → "mixamorigHips"
      if (boneName.startsWith('mixamo:')) {
        const afterColon = boneName.slice(7);
        const prefixed = 'mixamorig' + afterColon.charAt(0).toUpperCase() + afterColon.slice(1);
        if (charBoneSet.has(prefixed)) { track.name = prefixed + prop; return; }
        if (charBoneSet.has(afterColon)) { track.name = afterColon + prop; return; }
      }

      // Case 4: any other "Namespace:BoneName" format
      const colonIdx = boneName.indexOf(':');
      if (colonIdx > -1) {
        const bare = boneName.slice(colonIdx + 1);
        const prefixed = 'mixamorig' + bare.charAt(0).toUpperCase() + bare.slice(1);
        if (charBoneSet.has(prefixed)) { track.name = prefixed + prop; return; }
        if (charBoneSet.has(bare)) { track.name = bare + prop; return; }
      }
    });

    return cloned;
  }

  triggerLevelUp(): void {
    console.log('[3D] Level-up celebration triggered');

    // ESO-style level-up: camera orbit + sparkle burst + play best celebration anim
    const celebAnim = this.animations.get('Cheering')
      ?? this.animations.get('Victory')
      ?? this.animations.get('idle-2');  // fallback to alternate idle pose

    if (celebAnim) {
      if (this.currentAnimation && this.currentAnimation !== celebAnim) {
        this.currentAnimation.fadeOut(0.3);
      }
      celebAnim.reset().setLoop(THREE.LoopOnce, 1);
      celebAnim.clampWhenFinished = true;
      celebAnim.fadeIn(0.3).play();
      this.currentAnimation = celebAnim;

      // Return to idle after celebration
      const returnToIdle = (e: any) => {
        if (e.action === celebAnim) {
          this.mixer.removeEventListener('finished', returnToIdle);
          const idle = this.animations.get('idle');
          if (idle) {
            celebAnim.fadeOut(0.5);
            idle.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.5).play();
            this.currentAnimation = idle;
          }
        }
      };
      this.mixer.addEventListener('finished', returnToIdle);
    }

    // Visual effects: golden sparkle burst + camera orbit
    const pos = new THREE.Vector3(0, 1.2, 0);
    this.createSparkles(80, pos, 0xc9a84c, true);
    this.createEnergyRings(pos, 3);
    this.createFloatingText('LEVEL UP!', pos, 'legendary');
    this.cameraOrbit(4000);
  }

  playAnimation(name: string, loop: boolean = false): void {
    // Normalize idle aliases → the embedded long-duration idle clip
    const idleAliases = new Set(['idle', 'Idle', 'Standing Idle', 'Happy Idle']);
    const resolvedName = idleAliases.has(name)
      ? (this.animations.has('mixamo.com.001') ? 'mixamo.com.001' : (this.animations.has('mixamo.com') ? 'mixamo.com' : name))
      : name;

    // Try exact name, then lowercase
    const action = this.animations.get(resolvedName) || this.animations.get(resolvedName.toLowerCase());
    
    if (!action) {
      console.warn(`[Three.js] Animation "${name}" not found. Available:`, Array.from(this.animations.keys()));
      return;
    }

    // Skip if this animation is already running (prevents reset-to-T-pose on every tab switch)
    if (this.currentAnimation === action && action.isRunning()) {
      return;
    }

    // Fade out current animation
    if (this.currentAnimation && this.currentAnimation !== action) {
      this.currentAnimation.fadeOut(0.5);
    }

    // Fade in new animation
    action.reset();
    action.fadeIn(0.5);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    
    if (!loop) {
      // Return to idle after one-shot animation
      action.clampWhenFinished = true;
      const finishedHandler = (e: any) => {
        if (e.action === action) {
          this.playAnimation('Idle', true);
          this.mixer.removeEventListener('finished', finishedHandler);
        }
      };
      this.mixer.addEventListener('finished', finishedHandler);
    }

    action.play();
    this.currentAnimation = action;
    console.log('[Three.js] Playing animation:', name, 'Loop:', loop);
  }

  // XP Gain Effect Methods
  triggerXPGain(amount: number, position: THREE.Vector3 = new THREE.Vector3(0, 1.5, 0)): void {
    console.log('[Three.js] Triggering XP gain:', amount);
    
    if (amount <= 10) {
      this.smallXPEffect(amount, position);
    } else if (amount <= 50) {
      this.mediumXPEffect(amount, position);
    } else if (amount <= 200) {
      this.largeXPEffect(amount, position);
    } else {
      this.legendaryXPEffect(amount, position);
    }
  }

  private smallXPEffect(amount: number, position: THREE.Vector3): void {
    // Subtle glow + sparkles
    this.createSparkles(5, position, 0x00ff00);
    this.createFloatingText(`+${amount} XP`, position, 'small');
    
    // Character glow pulse (emissive material)
    if (this.character) {
      this.character.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          const mesh = node as THREE.Mesh;
          const material = mesh.material as THREE.MeshStandardMaterial;
          if (material.emissive) {
            const originalIntensity = material.emissiveIntensity || 0;
            let intensity = 0;
            const pulseInterval = setInterval(() => {
              intensity += 0.1;
              material.emissiveIntensity = intensity;
              if (intensity >= 0.3) {
                clearInterval(pulseInterval);
                setTimeout(() => {
                  material.emissiveIntensity = originalIntensity;
                }, 500);
              }
            }, 50);
          }
        }
      });
    }
  }

  private mediumXPEffect(amount: number, position: THREE.Vector3): void {
    // Bright burst + more sparkles
    this.createSparkles(20, position, 0x00aaff, true);
    this.createFloatingText(`+${amount} XP`, position, 'medium');
    
    // Play short animation (if available)
    if (this.animations.has('Happy') || this.animations.has('Cheering')) {
      this.playAnimation('Happy', false);
    }
  }

  private largeXPEffect(amount: number, position: THREE.Vector3): void {
    // Dramatic energy burst
    this.createSparkles(50, position, 0xffaa00, true);
    this.createEnergyRings(position);
    this.createFloatingText(`+${amount} XP`, position, 'large');
    
    // Play victory animation
    this.playAnimation('Victory', false);
    
    // Camera shake (subtle)
    this.cameraShake(0.5, 0.05);
  }

  private legendaryXPEffect(amount: number, position: THREE.Vector3): void {
    // Epic transformation
    this.createSparkles(100, position, 0xffd700, true);
    this.createEnergyRings(position, 3);
    this.createFloatingText(`+${amount} XP`, position, 'legendary');
    
    // Play celebration animation
    if (this.animations.has('Cheering')) {
      this.playAnimation('Cheering', false);
    } else {
      this.playAnimation('Victory', false);
    }
    
    // Camera orbit
    this.cameraOrbit(5000);
  }

  private createSparkles(count: number, position: THREE.Vector3, color: number, radial: boolean = false): void {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const velocities: number[] = [];

    for (let i = 0; i < count; i++) {
      positions.push(
        position.x + (Math.random() - 0.5) * 0.5,
        position.y + (Math.random() - 0.5) * 0.5,
        position.z + (Math.random() - 0.5) * 0.5
      );

      if (radial) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 2 + 1;
        velocities.push(
          Math.cos(angle) * speed,
          Math.random() * 2,
          Math.sin(angle) * speed
        );
      } else {
        velocities.push(0, Math.random() * 2 + 1, 0);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color,
      size: 0.1,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);

    // Animate particles
    let life = 1.5;
    const animateParticles = () => {
      life -= 0.016;
      if (life <= 0) {
        this.scene.remove(particles);
        geometry.dispose();
        material.dispose();
        return;
      }

      const posArray = geometry.attributes['position'].array as Float32Array;
      for (let i = 0; i < count; i++) {
        posArray[i * 3] += velocities[i * 3] * 0.016;
        posArray[i * 3 + 1] += velocities[i * 3 + 1] * 0.016;
        posArray[i * 3 + 2] += velocities[i * 3 + 2] * 0.016;
      }
      geometry.attributes['position'].needsUpdate = true;
      material.opacity = life / 1.5;

      requestAnimationFrame(animateParticles);
    };
    animateParticles();
  }

  private createEnergyRings(position: THREE.Vector3, count: number = 1): void {
    for (let i = 0; i < count; i++) {
      const geometry = new THREE.RingGeometry(0.1, 0.15, 32);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.position.copy(position);
      ring.rotation.x = Math.PI / 2;
      this.scene.add(ring);

      // Animate ring expansion
      let scale = 1;
      const expandRing = () => {
        scale += 0.05;
        ring.scale.set(scale, scale, 1);
        material.opacity = 0.8 - (scale - 1) / 5;

        if (scale >= 6) {
          this.scene.remove(ring);
          geometry.dispose();
          material.dispose();
          return;
        }

        requestAnimationFrame(expandRing);
      };
      setTimeout(() => expandRing(), i * 200);
    }
  }

  private createFloatingText(text: string, position: THREE.Vector3, size: string): void {
    // This will be created as HTML overlay in component
    const event = new CustomEvent('xp-text', { 
      detail: { text, position, size } 
    });
    window.dispatchEvent(event);
  }

  private cameraShake(duration: number, intensity: number): void {
    const originalPosition = this.camera.position.clone();
    const startTime = Date.now();

    const shake = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration * 1000) {
        this.camera.position.copy(originalPosition);
        return;
      }

      this.camera.position.x = originalPosition.x + (Math.random() - 0.5) * intensity;
      this.camera.position.y = originalPosition.y + (Math.random() - 0.5) * intensity;

      requestAnimationFrame(shake);
    };
    shake();
  }

  private cameraOrbit(duration: number): void {
    const startPosition = this.camera.position.clone();
    const startTime = Date.now();

    const orbit = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= duration) {
        this.camera.position.copy(startPosition);
        return;
      }

      const progress = elapsed / duration;
      const angle = progress * Math.PI * 2;
      const radius = 3;
      this.camera.position.x = Math.sin(angle) * radius;
      this.camera.position.z = Math.cos(angle) * radius;
      this.camera.lookAt(0, 1.2, 0);

      requestAnimationFrame(orbit);
    };
    orbit();
  }

  animate(): void {
    this.animationFrameId = requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    if (this.mixer) {
      this.mixer.update(delta);
    }

    this.renderer.render(this.scene, this.camera);
  }

  onWindowResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.renderer.dispose();
    this.scene.clear();
    console.log('[Three.js] Service disposed');
  }

  // Helper method to trigger activity-specific animations
  triggerActivityAnimation(activity: ActivityAnimation): void {
    console.log('[Three.js] Activity triggered:', activity);
    this.playAnimation(activity.animationName, activity.loop);
    this.triggerXPGain(activity.xpGain);
  }
}
