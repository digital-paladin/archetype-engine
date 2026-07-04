import { Injectable } from '@angular/core';
import { Color } from 'rot-js';

type RGB = [number, number, number];

/**
 * Smooth, continuous bar colors using rot.js Color interpolation.
 *
 * Replaces hardcoded CSS class step-thresholds (e.g. eso-bar-health,
 * eso-bar-willpower-high/med/low/depleted) with hex strings that shift
 * continuously as values change — no jarring color jumps.
 *
 * Uses interpolateHSL so transitions arc through natural hue space
 * (green → yellow → orange → red) rather than muddy RGB midpoints.
 */
@Injectable({ providedIn: 'root' })
export class RotColorService {

  /**
   * Vitality bar color: 0–100
   * 100 = green (Peak Condition)
   *  75 = ESO gold (Good)
   *  50 = orange (Fair)
   *  25 = deep orange-red (Low)
   *   0 = dark red (Critical)
   */
  vitalityColor(value: number): string {
    const stops: [number, RGB][] = [
      [100, [111, 207, 151]],  // #6fcf97 — green
      [75,  [242, 201, 106]],  // #f2c96a — ESO gold
      [50,  [230, 115,  60]],  // #e6733c — orange
      [25,  [210,  65,  35]],  // #d24123 — deep orange-red
      [0,   [183,  28,  28]],  // #b71c1c — dark red
    ];
    return Color.toHex(this.multiStop(value, 100, stops));
  }

  /**
   * Willpower bar color: 0–100
   * 100 = deep purple (Iron Will)
   *  60 = ESO gold (Focused)
   *  20 = amber-red (Wavering)
   *   0 = dark crimson (Depleted)
   */
  willpowerColor(value: number): string {
    const stops: [number, RGB][] = [
      [100, [130, 100, 210]],  // #8264d2 — purple
      [60,  [201, 168,  76]],  // #c9a84c — ESO gold
      [20,  [200,  80,  40]],  // #c85028 — amber-red
      [0,   [120,  25,  20]],  // #781914 — dark crimson
    ];
    return Color.toHex(this.multiStop(value, 100, stops));
  }

  /**
   * Generic XP / progress bar color.
   * Dims toward baseRgb * 0.4 at pct=0, brightens to baseRgb at pct=1.
   * Use for per-skill-tree XP fills.
   *
   * @param baseRgb  Full-brightness color as RGB 0–255 tuple
   * @param pct      Progress fraction 0–1
   */
  xpBarColor(baseRgb: RGB, pct: number): string {
    const clamped = Math.min(1, Math.max(0, pct));
    const dim: RGB = [
      Math.round(baseRgb[0] * 0.35),
      Math.round(baseRgb[1] * 0.35),
      Math.round(baseRgb[2] * 0.35),
    ];
    return Color.toHex(Color.interpolateHSL(dim, baseRgb, clamped));
  }

  /**
   * Multi-stop HSL interpolation.
   * Finds the two stops surrounding `value` and lerps between them.
   */
  private multiStop(value: number, max: number, stops: [number, RGB][]): RGB {
    const pct = Math.min(max, Math.max(0, value));
    for (let i = 0; i < stops.length - 1; i++) {
      const [hi, hiColor] = stops[i];
      const [lo, loColor] = stops[i + 1];
      if (pct >= lo) {
        const f = hi === lo ? 1 : (pct - lo) / (hi - lo);
        return Color.interpolateHSL(loColor, hiColor, f);
      }
    }
    return stops[stops.length - 1][1];
  }
}
