import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThreeCharacterService, ActivityAnimation } from './three-character.service';
import { ActionTrackerService, ActiveAction } from './action-tracker.service';
import { ActionTrackerComponent } from './action-tracker.component';

@Component({
  selector: 'app-character-display',
  standalone: true,
  imports: [CommonModule, ActionTrackerComponent],
  template: `
    <div class="character-container">
      <canvas #canvas class="character-canvas"></canvas>
      
      <!-- Action Tracker Overlay -->
      <app-action-tracker
        (actionCompleted)="handleActionCompleted($event)"
        (actionFailed)="handleActionFailed()"
        (actionCancelled)="handleActionCancelled()">
      </app-action-tracker>
      
      <div class="character-info">
        <h2>{{ characterName }}</h2>
        <div class="level-badge">Level {{ characterLevel }}</div>
        
        <div class="xp-bar-container">
          <div class="xp-bar">
            <div class="xp-fill" [style.width.%]="xpPercentage"></div>
          </div>
          <div class="xp-text">{{ currentXP }} / {{ maxXP }} XP ({{ xpPercentage }}%)</div>
        </div>
      </div>

      <!-- Floating XP Text -->
      <div class="floating-texts">
        <div 
          *ngFor="let textItem of floatingTexts"
          class="floating-text"
          [class.small]="textItem.size === 'small'"
          [class.medium]="textItem.size === 'medium'"
          [class.large]="textItem.size === 'large'"
          [class.legendary]="textItem.size === 'legendary'"
          [style.left.%]="textItem.x"
          [style.top.%]="textItem.y">
          {{ textItem.text }}
        </div>
      </div>

      <!-- Activity Start Buttons removed — logging via Quest Activities and ACL -->
    </div>
  `,
  styles: [`
    .character-container {
      position: relative;
      width: 100%;
      height: 500px;
      background: transparent;
      overflow: hidden;
    }

    .character-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .character-info {
      position: absolute;
      top: 16px;
      left: 16px;
      background: rgba(6, 4, 2, 0.85);
      padding: 14px 16px;
      border-radius: 2px;
      border: 1px solid var(--eso-border, rgba(155,115,38,0.50));
      backdrop-filter: blur(10px);
    }

    .character-info h2 {
      margin: 0 0 6px 0;
      font-size: 14px;
      color: var(--eso-gold-bright, #f2c96a);
      font-weight: 700;
      font-family: 'Cinzel', serif;
      letter-spacing: 1.5px;
    }

    .level-badge {
      display: inline-block;
      background: transparent;
      color: var(--eso-gold, #c9a84c);
      border: 1px solid var(--eso-gold-mid, #9a7830);
      padding: 3px 10px;
      border-radius: 2px;
      font-weight: 700;
      font-size: 10px;
      font-family: 'Cinzel', serif;
      letter-spacing: 1px;
      margin-bottom: 10px;
    }

    .xp-bar-container {
      width: 250px;
    }

    .xp-bar {
      height: 8px;
      background: rgba(0, 0, 0, 0.55);
      border-radius: 1px;
      overflow: hidden;
      border: 1px solid var(--eso-gold-dim, #6a5020);
    }

    .xp-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--eso-gold, #c9a84c) 0%, var(--eso-gold-mid, #9a7830) 100%);
      transition: width 0.5s ease-out;
      box-shadow: 0 0 6px rgba(201, 168, 76, 0.35);
    }

    .xp-text {
      margin-top: 5px;
      font-size: 10px;
      color: var(--eso-text-dim, #a08858);
      text-align: center;
      font-family: 'Cinzel', serif;
      letter-spacing: 0.5px;
    }

    .floating-texts {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .floating-text {
      position: absolute;
      font-weight: 700;
      animation: float-up 2s ease-out forwards;
      text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.8);
    }

    .floating-text.small {
      font-size: 20px;
      color: #00ff00;
    }

    .floating-text.medium {
      font-size: 28px;
      color: #00aaff;
    }

    .floating-text.large {
      font-size: 36px;
      color: #ffaa00;
      text-shadow: 3px 3px 6px rgba(255, 170, 0, 0.6);
    }

    .floating-text.legendary {
      font-size: 48px;
      background: linear-gradient(90deg, #ffd700 0%, #ff00ff 50%, #00ffff 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: float-up-legendary 5s ease-out forwards;
    }

    @keyframes float-up {
      0% {
        transform: translateY(0) scale(0.8);
        opacity: 1;
      }
      50% {
        transform: translateY(-50px) scale(1.2);
        opacity: 1;
      }
      100% {
        transform: translateY(-100px) scale(1);
        opacity: 0;
      }
    }

    @keyframes float-up-legendary {
      0% {
        transform: translateY(0) scale(0.5);
        opacity: 1;
      }
      30% {
        transform: translateY(-100px) scale(1.5);
        opacity: 1;
      }
      60% {
        transform: translateY(-150px) scale(1.3);
        opacity: 1;
      }
      100% {
        transform: translateY(-200px) scale(1);
        opacity: 0;
      }
    }

    .activity-controls {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      background: rgba(6, 4, 2, 0.88);
      padding: 8px 12px;
      border-radius: 2px;
      border: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      backdrop-filter: blur(10px);
    }

    .activity-btn {
      padding: 6px 14px;
      background: var(--eso-bg-panel-alt, #1a1408);
      color: var(--eso-text, #e2cfa8);
      border: 1px solid var(--eso-gold-dim, #6a5020);
      border-radius: 2px;
      cursor: pointer;
      font-size: 11px;
      font-family: 'Cinzel', serif;
      font-weight: 600;
      letter-spacing: 0.5px;
      transition: all 0.18s;
    }

    .activity-btn:hover {
      background: var(--eso-bg-hover, #221a09);
      border-color: var(--eso-gold, #c9a84c);
      color: var(--eso-gold-bright, #f2c96a);
      transform: translateY(-1px);
    }

    .activity-btn:active {
      transform: translateY(0);
    }
  `]
})
export class CharacterDisplayComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() characterLevel: number = 20;
  @Input() characterName: string = 'Digital Paladin';
  @Input() currentXP: number = 1850;
  @Input() maxXP: number = 2107;
  @Input() xpPercentage: number = 88;

  floatingTexts: Array<{ text: string; x: number; y: number; size: string; id: number }> = [];
  private textIdCounter = 0;
  private modelLoaded = false;
  private currentAnimation: string | null = null;
  private resizeObserver!: ResizeObserver;
  private boundHandleXPText!: EventListener;
  private boundHandlePlayAnimation!: EventListener;

  constructor(
    private threeService: ThreeCharacterService,
    private actionTracker: ActionTrackerService
  ) {}

  ngOnInit(): void {
    this.boundHandleXPText = this.handleXPText.bind(this) as EventListener;
    this.boundHandlePlayAnimation = this.handlePlayAnimation.bind(this) as EventListener;
    window.addEventListener('xp-text', this.boundHandleXPText);
    window.addEventListener('play-animation', this.boundHandlePlayAnimation);
  }

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    this.threeService.initScene(canvas);

    // ResizeObserver fires immediately on first observe (fixes init-time mismatch)
    // and on every subsequent container resize — no window.resize needed
    this.resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        this.threeService.onWindowResize(Math.round(width), Math.round(height));
      }
    });
    this.resizeObserver.observe(canvas);

    const modelPath = this.getModelPathForLevel(this.characterLevel);
    const loadModel = (path: string): Promise<void> =>
      this.threeService.loadCharacter(path).then(() => {
        this.modelLoaded = true;
        this.threeService.animate();
        this.threeService.playAnimation('idle', true); // ensure idle on every model load
      }).catch(() => {
        if (path !== 'assets/models/paladin-novice.glb') {
          console.warn(`Model not found: ${path} — falling back to paladin-novice.glb`);
          return loadModel('assets/models/paladin-novice.glb');
        }
        console.error('ALL model loads failed. Keeping test cube visible for diagnosis.');
        this.threeService.animate();
        return Promise.resolve();
      });
    loadModel(modelPath);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.threeService.dispose();
    window.removeEventListener('xp-text', this.boundHandleXPText);
    window.removeEventListener('play-animation', this.boundHandlePlayAnimation);
  }

  private getModelPathForLevel(level: number): string {
    // Only paladin-novice.glb exists — other tier models not yet deployed
    return 'assets/models/paladin-novice.glb';
  }

  private handlePlayAnimation(event: Event): void {
    if (!this.modelLoaded) return;
    const { name, loop } = (event as CustomEvent).detail;
    this.threeService.playAnimation(name, loop ?? false);
    if (loop) this.currentAnimation = name;
  }

  private handleXPText(event: Event): void {
    const customEvent = event as CustomEvent;
    const { text, size } = customEvent.detail;
    const id = this.textIdCounter++;
    
    this.floatingTexts.push({
      text,
      x: 50,
      y: 50,
      size,
      id
    });

    // Remove after animation completes
    setTimeout(() => {
      this.floatingTexts = this.floatingTexts.filter(t => t.id !== id);
    }, 2000);
  }

  // Action Tracking Methods - Start actions with looping animations
  startPrayer(): void {
    if (!this.modelLoaded) return;
    
    this.actionTracker.startAction(
      'prayer',
      'prayer',
      'Praying',
      'Complete daily devotional and prayer'
    );
    
    // Loop praying animation
    this.currentAnimation = 'Praying';
    this.threeService.playAnimation('Praying', true);
  }

  startWorkout(): void {
    if (!this.modelLoaded) return;
    
    this.actionTracker.startAction(
      'workout',
      'workout-strength',
      'Push Up',
      'Complete physical training session'
    );
    
    // Loop workout animation
    this.currentAnimation = 'Push Up';
    this.threeService.playAnimation('Push Up', true);
  }

  startCoding(): void {
    if (!this.modelLoaded) return;
    
    // Prompt user for quest (optional - can enhance later)
    const quest = prompt('Enter quest/story number (optional, e.g., IQ-8525):') || undefined;
    const target = prompt('What are you working on?') || 'Code development work';
    
    this.actionTracker.startAction(
      'coding',
      'coding-routine',
      'Typing',
      target,
      'routine',
      quest
    );
    
    // Loop coding animation
    this.currentAnimation = 'Typing';
    this.threeService.playAnimation('Typing', true);
  }

  startLab(): void {
    if (!this.modelLoaded) return;
    
    const quest = prompt('Enter quest/story number (optional):') || undefined;
    const target = prompt('Lab investigation target?') || 'Security lab investigation';
    
    this.actionTracker.startAction(
      'lab',
      'htb-medium',
      'Victory',
      target,
      'moderate',
      quest
    );
    
    // Loop lab animation (or Idle while investigating)
    this.currentAnimation = 'Thinking';
    this.threeService.playAnimation('Thinking', true);
  }

  startProtein(): void {
    if (!this.modelLoaded) return;
    
    this.actionTracker.startAction(
      'meal',
      'prayer',
      'Eating',
      'Consume trackable protein (0.64g/lb target)'
    );
    
    // Loop eating animation
    this.currentAnimation = 'Eating';
    this.threeService.playAnimation('Eating', true);
  }

  // Action Completion Handler
  handleActionCompleted(action: ActiveAction): void {
    console.log('[CharacterDisplay] Action completed:', action);

    // Stop looping animation
    this.stopLoopingAnimation();

    // Trigger XP gain effect
    const xpGained = action.xpCalculated?.pendingXP ?? 0;
    this.threeService.triggerXPGain(xpGained);

    // Update XP bar
    const prevXP = this.currentXP;
    this.currentXP += xpGained;
    this.xpPercentage = Math.round((this.currentXP / this.maxXP) * 100);

    // Level-up check — if XP crosses max, trigger ESO celebration
    if (prevXP < this.maxXP && this.currentXP >= this.maxXP) {
      this.characterLevel++;
      this.currentXP = this.currentXP - this.maxXP;
      this.maxXP = Math.round(this.maxXP * 1.15); // 15% XP increase per level
      this.xpPercentage = Math.round((this.currentXP / this.maxXP) * 100);
      this.threeService.triggerLevelUp();
    } else {
      this.threeService.playAnimation('idle', true);
    }
  }

  handleActionFailed(): void {
    console.log('[CharacterDisplay] Action failed');
    
    // Stop looping animation
    this.stopLoopingAnimation();
    
    // Play failure animation (or just return to idle)
    this.threeService.playAnimation('Defeated', false);
  }

  handleActionCancelled(): void {
    console.log('[CharacterDisplay] Action cancelled');
    
    // Stop looping animation
    this.stopLoopingAnimation();
  }

  private stopLoopingAnimation(): void {
    if (this.currentAnimation) {
      // Return to idle
      this.threeService.playAnimation('Idle', true);
      this.currentAnimation = null;
    }
  }

  // Legacy methods (for backward compatibility - can remove later)
  onLevelUp(): void {
    this.threeService.triggerLevelUp();
  }
}
