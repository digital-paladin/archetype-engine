/**
 * Character Routes Integration Tests
 * Tests API endpoints for character data retrieval
 */

import request from 'supertest';
import express, { Express } from 'express';
import { characterRouter } from './character.routes';
import { CharacterParser } from '../parser/characterParser';

// Mock the parser module
jest.mock('../parser/characterParser');

describe('Character Routes', () => {
  let app: Express;
  const mockCharacterData = {
    name: 'DigitalPaladin',
    phase: {
      current: 1,
      name: 'Foundation',
      startDate: new Date('2025-11-23'),
      endDate: new Date('2026-05-31'),
      daysRemaining: 165,
      focus: 'Build strength base',
      targets: [],
      weeklyVolume: '9.5 hrs',
      monthlyBudget: '$0'
    },
    vitality: {
      current: 79.8,
      max: 100,
      percentage: 80,
      status: 'Normal' as const,
      trend: 'down' as const,
      changeFromYesterday: 0,
      recoveryFactors: [
        { name: 'Total Recovery', modifier: 7, description: '7 vitality recovered' }
      ]
    },
    sleepDebt: {
      currentDebt: 11.73,
      trend: 'decreasing' as const,
      changeFromYesterday: -0.5,
      targetDate: new Date('2026-01-01'),
      targetDebt: 5,
      onTrackForTarget: true,
      effectOnVitality: 79.8,
      effectOnConsolidation: 85
    },
    skillTrees: [
      {
        id: 'developer',
        name: 'Developer',
        icon: '💚',
        level: 20,
        currentXP: 2293,
        xpToNextLevel: 8944,
        totalCareerXP: 132293,
        percentToNext: 25.6,
        tier: 'Advanced',
        activeBuffs: [],
        weeklyActivity: '5 days/week, ~30 hrs/week',
        weeklyXPRate: 151,
        estimatedWeeksToLevel: 44,
        rustStatus: 'sharp' as const
      },
      {
        id: 'sage',
        name: 'Sage',
        icon: '📖',
        level: 26,
        currentXP: 4823,
        xpToNextLevel: 13238,
        totalCareerXP: 148823,
        percentToNext: 36.4,
        tier: 'Master',
        activeBuffs: [],
        weeklyActivity: '7 days/week, 14 hrs/week',
        weeklyXPRate: 281,
        estimatedWeeksToLevel: 30,
        rustStatus: 'sharp' as const
      }
    ],
    titles: {
      active: [
        {
          id: 'faithful-dawn-warrior',
          name: 'Faithful Dawn Warrior',
          icon: '🌅',
          rarity: 'Legendary' as const,
          requirement: 'Maintain 4:15am First Thing With God for 23 months',
          effect: '+20% Sage XP at 4:15am sessions',
          earnedDate: new Date('2024-01-02'),
          equipped: false
        }
      ],
      locked: [
        {
          id: 'debt-crusher',
          name: 'Debt Crusher',
          icon: '💀',
          rarity: 'Epic' as const,
          requirement: 'Reduce sleep debt to <5 hrs',
          effect: '+10% XP consolidation permanently',
          progress: 44.1,
          estimatedUnlock: new Date('2025-12-23')
        }
      ],
      totalTitles: 2,
      highestRarity: 'Legendary' as const
    },
    gritScore: {
      current: 7,
      percentage: 87.5,
      checklistItems: [],
      streak: 14,
      tier: 'Elite' as const
    },
    gitGudLog: [],
    lastUpdated: new Date('2025-12-19')
  };

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/character', characterRouter);

    // Mock parser instance
    const mockParser = {
      parse: jest.fn().mockResolvedValue(mockCharacterData)
    };
    (CharacterParser as jest.Mock).mockImplementation(() => mockParser);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/character', () => {
    it('should return 200 with full character data', async () => {
      const response = await request(app).get('/api/character');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'DigitalPaladin',
        phase: expect.objectContaining({
          current: 1,
          name: 'Foundation'
        }),
        vitality: expect.objectContaining({
          current: 79.8,
          max: 100
        }),
        sleepDebt: expect.objectContaining({
          currentDebt: 11.73
        }),
        skillTrees: expect.arrayContaining([
          expect.objectContaining({
            name: 'Developer',
            level: 20
          })
        ])
      });
    });

    it('should include vitality data', async () => {
      const response = await request(app).get('/api/character');

      expect(response.body.vitality).toBeDefined();
      expect(response.body.vitality.current).toBe(79.8);
      expect(response.body.vitality.status).toBe('Normal');
      expect(response.body.vitality.trend).toBe('down');
    });

    it('should include sleep debt data', async () => {
      const response = await request(app).get('/api/character');

      expect(response.body.sleepDebt).toBeDefined();
      expect(response.body.sleepDebt.currentDebt).toBe(11.73);
      expect(response.body.sleepDebt.trend).toBe('decreasing');
      expect(response.body.sleepDebt.effectOnVitality).toBe(79.8);
    });

    it('should include rust status in skill trees', async () => {
      const response = await request(app).get('/api/character');

      expect(response.body.skillTrees).toBeDefined();
      response.body.skillTrees.forEach((tree: any) => {
        expect(tree.rustStatus).toBeDefined();
        expect(['sharp', 'rusty', 'very-rusty', 'n/a']).toContain(tree.rustStatus);
      });
    });

    it('should return 500 when parser throws error', async () => {
      const mockParser = {
        parse: jest.fn().mockRejectedValue(new Error('File not found'))
      };
      (CharacterParser as jest.Mock).mockImplementation(() => mockParser);

      const response = await request(app).get('/api/character');

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Failed to fetch character data');
    });

    it('should include error message in development mode', async () => {
      const mockParser = {
        parse: jest.fn().mockRejectedValue(new Error('Parse failed'))
      };
      (CharacterParser as jest.Mock).mockImplementation(() => mockParser);

      const response = await request(app).get('/api/character');

      expect(response.body.message).toBe('Parse failed');
    });
  });

  describe('GET /api/character/skill-trees', () => {
    it('should return 200 with skill trees array', async () => {
      const response = await request(app).get('/api/character/skill-trees');

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
    });

    it('should include rust status in each tree', async () => {
      const response = await request(app).get('/api/character/skill-trees');

      response.body.forEach((tree: any) => {
        expect(tree.rustStatus).toBeDefined();
        expect(tree.rustStatus).toBe('sharp');
      });
    });

    it('should include all tree properties', async () => {
      const response = await request(app).get('/api/character/skill-trees');

      const tree = response.body[0];
      expect(tree).toHaveProperty('id');
      expect(tree).toHaveProperty('name');
      expect(tree).toHaveProperty('level');
      expect(tree).toHaveProperty('currentXP');
      expect(tree).toHaveProperty('xpToNextLevel');
      expect(tree).toHaveProperty('tier');
      expect(tree).toHaveProperty('rustStatus');
    });

    it('should return 500 on parser error', async () => {
      const mockParser = {
        parse: jest.fn().mockRejectedValue(new Error('Parser failed'))
      };
      (CharacterParser as jest.Mock).mockImplementation(() => mockParser);

      const response = await request(app).get('/api/character/skill-trees');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch skill trees');
    });
  });

  describe('GET /api/character/stats', () => {
    it('should return 200 with vitality, sleep debt, and phase', async () => {
      const response = await request(app).get('/api/character/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('vitality');
      expect(response.body).toHaveProperty('sleepDebt');
      expect(response.body).toHaveProperty('phase');
    });

    it('should include complete vitality data', async () => {
      const response = await request(app).get('/api/character/stats');

      expect(response.body.vitality).toMatchObject({
        current: 79.8,
        max: 100,
        percentage: 80,
        status: 'Normal',
        trend: 'down'
      });
    });

    it('should include complete sleep debt data', async () => {
      const response = await request(app).get('/api/character/stats');

      expect(response.body.sleepDebt).toMatchObject({
        currentDebt: 11.73,
        trend: 'decreasing',
        changeFromYesterday: -0.5,
        targetDebt: 5,
        onTrackForTarget: true,
        effectOnVitality: 79.8,
        effectOnConsolidation: 85
      });
    });

    it('should include phase information', async () => {
      const response = await request(app).get('/api/character/stats');

      expect(response.body.phase).toMatchObject({
        current: 1,
        name: 'Foundation',
        daysRemaining: 165
      });
    });

    it('should return 500 on parser error', async () => {
      const mockParser = {
        parse: jest.fn().mockRejectedValue(new Error('Stats fetch failed'))
      };
      (CharacterParser as jest.Mock).mockImplementation(() => mockParser);

      const response = await request(app).get('/api/character/stats');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch stats');
    });
  });

  describe('GET /api/character/history', () => {
    it('should return 200 with not implemented message', async () => {
      const response = await request(app).get('/api/character/history');

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('not yet implemented');
      expect(response.body.data).toEqual([]);
    });

    it('should accept limit and offset query parameters', async () => {
      const response = await request(app)
        .get('/api/character/history')
        .query({ limit: 20, offset: 10 });

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(20);
      expect(response.body.offset).toBe(10);
    });

    it('should use default limit and offset when not provided', async () => {
      const response = await request(app).get('/api/character/history');

      expect(response.body.limit).toBe(10);
      expect(response.body.offset).toBe(0);
    });
  });

  describe('POST /api/character/xp-update', () => {
    it('should return 200 with not implemented message', async () => {
      const xpData = {
        tree: 'developer',
        pendingXP: 25,
        breakdown: { base: 20, bonus: 5 }
      };

      const response = await request(app)
        .post('/api/character/xp-update')
        .send(xpData);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('not yet implemented');
      expect(response.body.receivedData).toMatchObject(xpData);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty response gracefully', async () => {
      const mockParser = {
        parse: jest.fn().mockResolvedValue(null)
      };
      (CharacterParser as jest.Mock).mockImplementation(() => mockParser);

      const response = await request(app).get('/api/character');

      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
    });

    it('should handle parser timeout', async () => {
      const mockParser = {
        parse: jest.fn().mockImplementation(() => 
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
        )
      };
      (CharacterParser as jest.Mock).mockImplementation(() => mockParser);

      const response = await request(app).get('/api/character');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch character data');
    });
  });
});
