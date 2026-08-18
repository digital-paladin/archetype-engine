import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { syncSleepDebtFromJournal } from '../services/sleepDebt.service';

async function main() {
  const userId = process.env.OWNER_USER_ID?.trim();
  if (!userId) throw new Error('OWNER_USER_ID not set');
  const result = await syncSleepDebtFromJournal(userId);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error('[SYNC] Fatal:', e);
  process.exit(1);
});
