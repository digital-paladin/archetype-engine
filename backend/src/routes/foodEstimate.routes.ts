import { Router, Request, Response } from 'express';
import https from 'https';
import { getDataService } from '../services/data/dataService';

const router = Router();

// USDA FoodData Central — free API, DEMO_KEY covers low-volume use.
// Register at https://fdc.nal.usda.gov/api-guide.html for a personal key (1000 req/hr).
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const USDA_BASE    = 'api.nal.usda.gov';

interface FoodEstimate {
  query:      string;
  bestMatch:  string;
  fdcId:      number | null;
  calories:   number;
  protein:    number;
  carbs:      number;
  fat:        number;
  fiber:      number;
  confidence: 'high' | 'medium' | 'low';
  note:       string;
}

interface EstimateTotals {
  calories: number;
  protein:  number;
  carbs:    number;
  fat:      number;
  fiber:    number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse free-form food notes text into discrete food item queries.
 * Splits on newlines, commas, semicolons. Strips time/meal labels,
 * numeric quantities at start ("2x", "1 serving of"), and trivial fragments.
 */
function parseNoteItems(notes: string): string[] {
  const raw = notes
    .replace(/\b(breakfast|lunch|dinner|snack|morning|evening|today|yesterday)\b/gi, '')
    .split(/[\n,;]+/)
    .map(s => s.trim())
    // strip leading numeric quantities like "2x", "12oz", "1 cup of", "half a"
    .map(s => s.replace(/^[\d\.]+\s*(x|oz|fl oz|cups?|tbsp|tsp|servings?|pieces?|slices?)\s+(of\s+)?/i, ''))
    .map(s => s.replace(/^(a|an|the|half\s+a?|one|two|three)\s+/i, ''))
    .map(s => s.trim())
    .filter(s => s.length > 2);

  // Deduplicate while preserving order
  return [...new Set(raw)];
}

/**
 * Fetch top USDA food match for a query string.
 * Prefers 'Branded' and 'Foundation' data types which have restaurant items.
 */
function queryUSDA(query: string): Promise<FoodEstimate> {
  return new Promise((resolve) => {
    const path = `/fdc/v1/foods/search?query=${encodeURIComponent(query)}&dataType=Branded,Foundation,SR%20Legacy&pageSize=1&api_key=${USDA_API_KEY}`;

    const req = https.get({ hostname: USDA_BASE, path, headers: { 'Accept': 'application/json' } }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          const food = data?.foods?.[0];

          if (!food) {
            resolve(buildUnknown(query));
            return;
          }

          const nutrients = (food.foodNutrients ?? []) as Array<{ nutrientName: string; value: number }>;
          const get = (name: string) => nutrients.find(n => n.nutrientName?.toLowerCase().includes(name.toLowerCase()))?.value ?? 0;

          const cals    = get('Energy');
          const protein = get('Protein');
          const carbs   = get('Carbohydrate');
          const fat     = get('Total lipid');
          const fiber   = get('Fiber');

          // Confidence based on data type and score match
          const dataType  = (food.dataType ?? '').toLowerCase();
          const score     = food.score ?? 0;
          let confidence: FoodEstimate['confidence'] = 'low';
          if (dataType === 'branded' && score > 800) confidence = 'high';
          else if (score > 400)                       confidence = 'medium';

          resolve({
            query,
            bestMatch:  food.description ?? query,
            fdcId:      food.fdcId ?? null,
            calories:   Math.round(cals),
            protein:    Math.round(protein * 10) / 10,
            carbs:      Math.round(carbs   * 10) / 10,
            fat:        Math.round(fat     * 10) / 10,
            fiber:      Math.round(fiber   * 10) / 10,
            confidence,
            note: food.brandOwner ? `${food.brandOwner}` : `${food.dataType ?? 'USDA'}`
          });
        } catch {
          resolve(buildUnknown(query));
        }
      });
    });

    req.on('error', () => resolve(buildUnknown(query)));
    req.setTimeout(5000, () => { req.destroy(); resolve(buildUnknown(query)); });
  });
}

function buildUnknown(query: string): FoodEstimate {
  return {
    query,
    bestMatch:  `No match found: "${query}"`,
    fdcId:      null,
    calories:   0,
    protein:    0,
    carbs:      0,
    fat:        0,
    fiber:      0,
    confidence: 'low',
    note:       'Not found in USDA database — log manually'
  };
}

function sumTotals(items: FoodEstimate[]): EstimateTotals {
  return items.reduce(
    (acc, i) => ({
      calories: acc.calories + i.calories,
      protein:  acc.protein  + i.protein,
      carbs:    acc.carbs    + i.carbs,
      fat:      acc.fat      + i.fat,
      fiber:    acc.fiber    + i.fiber,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  );
}

// ---------------------------------------------------------------------------
// POST /api/food-estimate
// Body: { notes: string, fitbitTotals?: { calories, protein, carbs, fat, fiber } }
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const { notes, fitbitTotals } = req.body;

  if (!notes || typeof notes !== 'string' || !notes.trim()) {
    return res.status(400).json({ success: false, error: 'notes string is required' });
  }

  const items_raw = parseNoteItems(notes);

  if (items_raw.length === 0) {
    return res.json({ success: true, items: [], estimatedTotals: sumTotals([]), combinedTotals: fitbitTotals ?? null });
  }

  // Cap at 10 items to stay within DEMO_KEY rate limits
  const queries = items_raw.slice(0, 10);

  console.log(`[food-estimate] Querying USDA for ${queries.length} items:`, queries);

  try {
    // Sequential requests to be gentle on USDA rate limits
    const results: FoodEstimate[] = [];
    for (const q of queries) {
      const r = await queryUSDA(q);
      results.push(r);
    }

    const estimatedTotals = sumTotals(results);

    // Combine with Fitbit totals if provided
    const combinedTotals: EstimateTotals | null = fitbitTotals
      ? {
          calories: Math.round(fitbitTotals.calories + estimatedTotals.calories),
          protein:  Math.round((fitbitTotals.protein  + estimatedTotals.protein)  * 10) / 10,
          carbs:    Math.round((fitbitTotals.carbs    + estimatedTotals.carbs)    * 10) / 10,
          fat:      Math.round((fitbitTotals.fat      + estimatedTotals.fat)      * 10) / 10,
          fiber:    Math.round((fitbitTotals.fiber    + estimatedTotals.fiber)    * 10) / 10,
        }
      : null;

    res.json({ success: true, items: results, estimatedTotals, combinedTotals });

    // Write raw food notes text to today's journal entry (fire-and-forget after response)
    const userId  = (req as any).userId as string;
    const dateStr = (req.body.date as string | undefined) ?? new Date().toLocaleDateString('en-CA');
    if (userId) {
      getDataService()
        .upsertJournalEntry(userId, { entry_date: dateStr, notes })
        .catch(err => console.error('[food-estimate] DB write failed:', err));
    }

  } catch (err) {
    console.error('[food-estimate] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to estimate food macros' });
  }
});

export default router;
