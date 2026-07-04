// crafting-station.component.spec.ts
// Unit tests for CraftingStationComponent — recipe catalog, forge/complete/abandon,
// localStorage persistence, and Phase 8 auto-complete on init.

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CraftingStationComponent } from './crafting-station.component';

const STORAGE_KEY = 'cs_craft_entries_v1';

describe('CraftingStationComponent', () => {
  let fixture: ComponentFixture<CraftingStationComponent>;
  let component: CraftingStationComponent;

  beforeEach(async () => {
    localStorage.clear();

    await TestBed.configureTestingModule({
      imports: [CraftingStationComponent],
    }).compileComponents();

    fixture   = TestBed.createComponent(CraftingStationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges(); // triggers ngOnInit
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ── Recipe catalog ─────────────────────────────────────────────────────────

  describe('recipe catalog', () => {
    it('loads all 28 recipes into the global RECIPES array', () => {
      // Switch through all stations and sub-tabs to count
      const wilderness = countRecipesForStation('wilderness');
      const enterprise        = countRecipesForSub('enterprise');
      const charProg   = countRecipesForSub('char-prog');
      const qc         = countRecipesForSub('quantconnect');
      const rt         = countRecipesForSub('redteam');

      expect(wilderness + enterprise + charProg + qc + rt).toBe(28);
    });

    it('has 8 wilderness recipes', () => {
      expect(countRecipesForStation('wilderness')).toBe(8);
    });

    it('has 5 Enterprise dev recipes', () => {
      expect(countRecipesForSub('enterprise')).toBe(5);
    });

    it('has 5 char-prog recipes', () => {
      expect(countRecipesForSub('char-prog')).toBe(5);
    });

    it('has 5 quantconnect recipes', () => {
      expect(countRecipesForSub('quantconnect')).toBe(5);
    });

    it('has 5 redteam recipes', () => {
      expect(countRecipesForSub('redteam')).toBe(5);
    });
  });

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('defaults to wilderness station', () => {
      expect(component.activeStation()).toBe('wilderness');
    });

    it('defaults to enterprise dev sub', () => {
      expect(component.activeDevSub()).toBe('enterprise');
    });

    it('selectedRecipe starts as null', () => {
      expect(component.selectedRecipe()).toBeNull();
    });

    it('all wilderness recipes start as available with empty localStorage', () => {
      // cp-body-status is the only recipe auto-completed on init (char-prog, not wilderness)
      const status = component.getStatus('w-fire');
      expect(status).toBe('available');
    });
  });

  // ── Phase 8 auto-complete ──────────────────────────────────────────────────

  describe('Phase 8 auto-complete on ngOnInit', () => {
    it('marks cp-body-status as completed on first init', () => {
      expect(component.getStatus('cp-body-status')).toBe('completed');
    });

    it('persists cp-body-status completed state to localStorage', () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const entries = JSON.parse(raw!);
      const entry = entries.find((e: any) => e.recipeId === 'cp-body-status');
      expect(entry).toBeDefined();
      expect(entry.status).toBe('completed');
    });

    it('does NOT add cp-body-status twice when it already exists', async () => {
      // Destroy and recreate component — should not duplicate
      fixture.destroy();
      localStorage.clear();

      // Pre-populate storage with existing entry
      localStorage.setItem(STORAGE_KEY, JSON.stringify([
        { recipeId: 'cp-body-status', status: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString() }
      ]));

      const newFixture = TestBed.createComponent(CraftingStationComponent);
      newFixture.detectChanges();
      const newComp = newFixture.componentInstance;

      const raw    = localStorage.getItem(STORAGE_KEY)!;
      const entries = JSON.parse(raw);
      const count  = entries.filter((e: any) => e.recipeId === 'cp-body-status').length;
      expect(count).toBe(1);
      newFixture.destroy();
    });
  });

  // ── startCraft ─────────────────────────────────────────────────────────────

  describe('startCraft()', () => {
    it('changes status from available to in-progress', () => {
      const recipe = getRecipeById('w-fire')!;
      component.startCraft(recipe);
      expect(component.getStatus('w-fire')).toBe('in-progress');
    });

    it('persists the in-progress entry to localStorage', () => {
      const recipe = getRecipeById('w-fire')!;
      component.startCraft(recipe);
      const entries = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      const entry   = entries.find((e: any) => e.recipeId === 'w-fire');
      expect(entry.status).toBe('in-progress');
      expect(entry.startedAt).toBeTruthy();
    });

    it('sets getStatusIcon to ⚒ for in-progress', () => {
      component.startCraft(getRecipeById('w-fire')!);
      expect(component.getStatusIcon('w-fire')).toBe('⚒');
    });
  });

  // ── completeCraft ──────────────────────────────────────────────────────────

  describe('completeCraft()', () => {
    it('changes status to completed', () => {
      const recipe = getRecipeById('w-cordage')!;
      component.completeCraft(recipe);
      expect(component.getStatus('w-cordage')).toBe('completed');
    });

    it('sets completedAt on the entry', () => {
      const recipe = getRecipeById('w-cordage')!;
      component.completeCraft(recipe);
      const entries = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      const entry   = entries.find((e: any) => e.recipeId === 'w-cordage');
      expect(entry.completedAt).toBeTruthy();
    });

    it('sets getStatusIcon to ✓ for completed', () => {
      component.completeCraft(getRecipeById('w-cordage')!);
      expect(component.getStatusIcon('w-cordage')).toBe('✓');
    });

    it('preserves startedAt when completing an in-progress recipe', () => {
      const recipe = getRecipeById('w-shelter')!;
      component.startCraft(recipe);
      const entriesAfterStart = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      const startedAt = entriesAfterStart.find((e: any) => e.recipeId === 'w-shelter').startedAt;

      component.completeCraft(recipe);
      const entries = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      const entry   = entries.find((e: any) => e.recipeId === 'w-shelter');
      expect(entry.startedAt).toBe(startedAt);
    });
  });

  // ── abandonCraft ──────────────────────────────────────────────────────────

  describe('abandonCraft()', () => {
    it('removes the entry and status returns to available', () => {
      const recipe = getRecipeById('w-water')!;
      component.startCraft(recipe);
      expect(component.getStatus('w-water')).toBe('in-progress');

      component.abandonCraft(recipe);
      expect(component.getStatus('w-water')).toBe('available');
    });

    it('removes the entry from localStorage', () => {
      const recipe = getRecipeById('w-water')!;
      component.startCraft(recipe);
      component.abandonCraft(recipe);
      const entries = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(entries.find((e: any) => e.recipeId === 'w-water')).toBeUndefined();
    });
  });

  // ── getStatus ──────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns "available" for a recipe with no entry', () => {
      expect(component.getStatus('w-forage')).toBe('available');
    });

    it('returns "in-progress" for a started recipe', () => {
      component.startCraft(getRecipeById('w-forage')!);
      expect(component.getStatus('w-forage')).toBe('in-progress');
    });

    it('returns "completed" for a completed recipe', () => {
      component.completeCraft(getRecipeById('w-forage')!);
      expect(component.getStatus('w-forage')).toBe('completed');
    });
  });

  // ── localStorage persistence ───────────────────────────────────────────────

  describe('localStorage persistence', () => {
    it('survives component re-creation', async () => {
      component.startCraft(getRecipeById('w-signal')!);
      fixture.destroy();

      const newFixture = TestBed.createComponent(CraftingStationComponent);
      newFixture.detectChanges();
      const newComp = newFixture.componentInstance;

      expect(newComp.getStatus('w-signal')).toBe('in-progress');
      newFixture.destroy();
    });

    it('handles corrupted localStorage gracefully', async () => {
      localStorage.setItem(STORAGE_KEY, 'invalid json{{{');
      fixture.destroy();

      const newFixture = TestBed.createComponent(CraftingStationComponent);
      newFixture.detectChanges();
      const newComp = newFixture.componentInstance;

      // Component should initialise without throwing, auto-completing phase 8
      expect(newComp.getStatus('cp-body-status')).toBe('completed');
      newFixture.destroy();
    });
  });

  // ── Station / sub navigation ───────────────────────────────────────────────

  describe('station navigation', () => {
    it('setStation() changes activeStation and clears selectedRecipe', () => {
      component.selectedRecipe.set(getRecipeById('w-fire'));
      component.setStation('dev');
      expect(component.activeStation()).toBe('dev');
      expect(component.selectedRecipe()).toBeNull();
    });

    it('setDevSub() changes activeDevSub and clears selectedRecipe', () => {
      component.setStation('dev');
      component.selectedRecipe.set(getRecipeById('enterprise-va-visibility'));
      component.setDevSub('redteam');
      expect(component.activeDevSub()).toBe('redteam');
      expect(component.selectedRecipe()).toBeNull();
    });

    it('getSubCount() returns correct count for each sub', () => {
      expect(component.getSubCount('enterprise')).toBe(5);
      expect(component.getSubCount('char-prog')).toBe(5);
      expect(component.getSubCount('quantconnect')).toBe(5);
      expect(component.getSubCount('redteam')).toBe(5);
    });
  });

  // ── filteredRecipes ────────────────────────────────────────────────────────

  describe('filteredRecipes()', () => {
    it('shows only wilderness recipes when activeStation is wilderness', () => {
      component.setStation('wilderness');
      expect(component.filteredRecipes().every(r => r.category === 'wilderness')).toBe(true);
    });

    it('shows only enterprise dev recipes when station=dev and sub=enterprise', () => {
      component.setStation('dev');
      component.setDevSub('enterprise');
      const recipes = component.filteredRecipes();
      expect(recipes.length).toBeGreaterThan(0);
      expect(recipes.every(r => r.category === 'dev' && r.sub === 'enterprise')).toBe(true);
    });

    it('filters recipes by search query', () => {
      component.setStation('wilderness');
      component.searchQuery.set('fire');
      // Manually trigger computed signal re-evaluation
      fixture.detectChanges();
      const results = component.filteredRecipes();
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.id === 'w-fire')).toBe(true);
    });

    it('returns empty array when search yields no matches', () => {
      component.setStation('wilderness');
      component.searchQuery.set('xyznonexistent');
      fixture.detectChanges();
      expect(component.filteredRecipes()).toHaveLength(0);
    });
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function countRecipesForStation(station: string): number {
    component.setStation(station as any);
    return component.filteredRecipes().length;
  }

  function countRecipesForSub(sub: string): number {
    component.setStation('dev');
    component.setDevSub(sub as any);
    return component.filteredRecipes().length;
  }

  function getRecipeById(id: string) {
    // Switch to the correct view so filteredRecipes resolves
    return (['w-fire','w-cordage','w-shelter','w-water','w-forage','w-ifak','w-nav','w-signal'].includes(id))
      ? (component.setStation('wilderness'), component.filteredRecipes().find(r => r.id === id)!)
      : (['enterprise-va-visibility','enterprise-resale-refresh','enterprise-cam-routing','enterprise-delegates','enterprise-jpa-spec'].includes(id))
        ? (component.setStation('dev'), component.setDevSub('enterprise'), component.filteredRecipes().find(r => r.id === id)!)
        : (component.setStation('dev'), component.setDevSub('char-prog'), component.filteredRecipes().find(r => r.id === id)!);
  }
});
