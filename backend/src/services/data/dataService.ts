/**
 * dataService.ts
 *
 * Singleton provider for SupabaseDataService.
 * Import getDataService() in any route that needs DB access.
 */
import { SupabaseDataService } from './SupabaseDataService';

let _instance: SupabaseDataService | null = null;

export function getDataService(): SupabaseDataService {
  if (!_instance) _instance = new SupabaseDataService();
  return _instance;
}
