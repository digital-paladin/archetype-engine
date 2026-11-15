import fs from 'fs';
import path from 'path';
import { INVENTORY_DEFAULTS } from './inventoryDefaults';

describe('inventory catalog seed', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '../../../supabase/migrations/014_acquisition_quests_and_inventory.sql'),
    'utf8',
  );

  it('keeps every frontend catalog slug and name in migration 014', () => {
    expect(INVENTORY_DEFAULTS.length).toBe(43);
    for (const item of INVENTORY_DEFAULTS) {
      expect(sql).toContain(`'${item.id}'`);
      expect(sql).toContain(item.name.replace(/'/g, "''"));
    }
    expect(sql).toContain("'burpsuite-pro'");
    expect(sql).toContain("'oscp-cert'");
    expect(sql).toContain("'bs-tent'");
    expect(sql).toContain('kind IN (\'daily\', \'emergency\', \'hidden\', \'penalty\', \'acquisition\')');
    expect(sql).toContain('Never an XP input');
  });
});
