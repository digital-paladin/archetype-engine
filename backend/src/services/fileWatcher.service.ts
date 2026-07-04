import chokidar, { FSWatcher } from 'chokidar';
import { Server as SocketIOServer } from 'socket.io';
import { CharacterParser } from '../parser/characterParser';
import { XPProjectionService } from './xpProjection.service';
import { existsSync } from 'fs';
import { getSupabaseAdmin } from '../lib/supabase';

/**
 * FileWatcherService — dual-mode watcher:
 *   - Supabase Realtime: always active (emits character:updated on DB changes)
 *   - Chokidar: active only when CHARACTER_FILE_PATH exists locally (dev + local file edits)
 *
 * Both paths emit the same Socket.IO events so clients need no special handling.
 */
export class FileWatcherService {
  private watcher: FSWatcher | null = null;
  private parser: CharacterParser;
  private isWatching = false;
  private realtimeChannel: ReturnType<ReturnType<typeof getSupabaseAdmin>['channel']> | null = null;

  constructor(
    private filePath: string,
    private io: SocketIOServer
  ) {
    this.parser = new CharacterParser(filePath);
  }

  /**
   * Start watching: Supabase Realtime (always) + chokidar (local only if file exists)
   */
  start(): void {
    if (this.isWatching) {
      console.warn('⚠️  File watcher already running');
      return;
    }

    this.startSupabaseRealtime();

    // Chokidar: local dev mode — only when the file actually exists on disk
    if (existsSync(this.filePath)) {
      this.startChokidar();
    } else {
      console.log(`[WATCHER] ℹ️  Local file not found — chokidar skipped, Supabase Realtime only`);
    }

    this.isWatching = true;
  }

  /**
   * Stop both watchers
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      console.log('🛑 File watcher (chokidar) stopped');
    }
    if (this.realtimeChannel) {
      await getSupabaseAdmin().removeChannel(this.realtimeChannel);
      console.log('🛑 Supabase Realtime channel removed');
    }
    this.isWatching = false;
  }

  /**
   * Supabase Realtime: subscribe to character_stats + xp_history changes.
   * On any INSERT/UPDATE, emit character:updated so frontend re-fetches sub-endpoints.
   */
  private startSupabaseRealtime(): void {
    try {
      const supabase = getSupabaseAdmin();
      this.realtimeChannel = supabase
        .channel('character-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'character_stats' },
          () => this.handleDbChange('character_stats'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'xp_history' },
          () => this.handleDbChange('xp_history'))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'character_profile' },
          () => this.handleDbChange('character_profile'))
        .subscribe((status: string) => {
          console.log(`[SUPABASE WATCHER] 📡 Realtime status: ${status}`);
        });
      console.log('[SUPABASE WATCHER] ✅ Subscribed to character_stats, xp_history, character_profile');
    } catch (err) {
      console.warn('[SUPABASE WATCHER] ⚠️  Could not start Realtime subscription:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Chokidar: local file watcher for dev mode.
   * Parses the file and emits both character:updated and xp-projection-update.
   */
  private startChokidar(): void {
    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (p) => {
        console.log(`[WATCHER DEBUG] 📄 File detected: ${p}`);
        this.handleFileChange();
      })
      .on('change', (p) => {
        console.log(`[WATCHER DEBUG] 📝 File changed: ${p}`);
        this.handleFileChange();
      })
      .on('error', (error) => {
        console.error(`[WATCHER DEBUG] ❌ Watcher error: ${error}`);
      });

    console.log(`[WATCHER DEBUG] 👀 Watching file: ${this.filePath}`);
  }

  /** Supabase DB change → emit lightweight notification */
  private handleDbChange(table: string): void {
    console.log(`[SUPABASE WATCHER] 🔄 Change detected in ${table} — broadcasting character:updated`);
    this.io.emit('character:updated', {
      source: 'supabase',
      table,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Chokidar file change → full parse + broadcast (local dev)
   */
  private async handleFileChange(): Promise<void> {
    try {
      console.log('[WATCHER DEBUG] Parsing updated file...');
      const characterData = await this.parser.parse();

      this.io.emit('character:updated', {
        data: characterData,
        source: 'file',
        timestamp: new Date().toISOString()
      });
      console.log('[WATCHER DEBUG] Emitted character:updated (file)');

      const xpProjections = XPProjectionService.parseXPProjections(this.filePath);
      this.io.emit('xp-projection-update', {
        data: xpProjections,
        timestamp: new Date().toISOString()
      });
      console.log('[WATCHER DEBUG] Emitted xp-projection-update:', xpProjections);
      console.log(`[WATCHER DEBUG] ✅ Broadcast to ${this.io.sockets.sockets.size} client(s)`);
    } catch (error) {
      console.error('[WATCHER DEBUG] ❌ Error parsing file:', error);
      this.io.emit('character:error', {
        message: 'Failed to parse character file',
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Manually trigger a file parse and broadcast (local dev utility)
   */
  async triggerUpdate(): Promise<void> {
    if (existsSync(this.filePath)) {
      await this.handleFileChange();
    } else {
      this.handleDbChange('manual');
    }
  }
}

