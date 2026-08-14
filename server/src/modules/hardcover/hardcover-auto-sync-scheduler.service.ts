import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { HardcoverQuoteSyncService } from './hardcover-quote-sync.service';
import { HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

export const HARDCOVER_AUTO_SYNC_DEBOUNCE_MS = 1000;

export type HardcoverAutoSyncReason = 'status' | 'progress' | 'rating' | 'quotes';

type HardcoverSettingsSnapshot = Awaited<ReturnType<HardcoverSettingsService['getSettings']>>;

interface AutoSyncRequest {
  userId: number;
  bookId: number;
  reason: HardcoverAutoSyncReason;
}

interface AutoSyncBookFileRequest {
  userId: number;
  bookFileId: number;
  reason: Extract<HardcoverAutoSyncReason, 'progress'>;
}

interface AutoSyncState {
  key: string;
  userId: number;
  bookId: number;
  reasons: Set<HardcoverAutoSyncReason>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
}

const AUTO_SYNC_EVENT = 'hardcover.auto_sync';
const REASON_ORDER: HardcoverAutoSyncReason[] = ['status', 'progress', 'rating', 'quotes'];

@Injectable()
export class HardcoverAutoSyncSchedulerService {
  private readonly logger = new Logger(HardcoverAutoSyncSchedulerService.name);
  private readonly states = new Map<string, AutoSyncState>();
  private readonly userSyncQueues = new Map<number, Promise<void>>();

  constructor(
    private readonly settingsService: HardcoverSettingsService,
    private readonly syncService: HardcoverSyncService,
    private readonly quoteSyncService: HardcoverQuoteSyncService,
    private readonly repository: HardcoverRepository,
  ) {}

  requestSync(request: AutoSyncRequest): void {
    const state = this.getOrCreateState(request.userId, request.bookId);
    state.reasons.add(request.reason);

    if (state.inFlight) return;

    this.schedule(state);
  }

  requestSyncForBookFile(request: AutoSyncBookFileRequest): void {
    void this.resolveBookFileAndRequestSync(request);
  }

  private getOrCreateState(userId: number, bookId: number): AutoSyncState {
    const key = `${userId}:${bookId}`;
    const existing = this.states.get(key);
    if (existing) return existing;

    const state: AutoSyncState = {
      key,
      userId,
      bookId,
      reasons: new Set(),
      timer: null,
      inFlight: false,
    };
    this.states.set(key, state);
    return state;
  }

  private schedule(state: AutoSyncState): void {
    if (state.timer) clearTimeout(state.timer);

    state.timer = setTimeout(() => {
      state.timer = null;
      void this.runDueSync(state.key);
    }, HARDCOVER_AUTO_SYNC_DEBOUNCE_MS);
  }

  private async runDueSync(key: string): Promise<void> {
    const state = this.states.get(key);
    if (!state || state.inFlight || state.reasons.size === 0) return;

    const reasons = new Set(state.reasons);
    state.reasons.clear();
    state.inFlight = true;

    try {
      await this.runSync(state.userId, state.bookId, reasons);
    } finally {
      state.inFlight = false;
      if (state.reasons.size > 0) {
        this.schedule(state);
      } else {
        this.states.delete(key);
      }
    }
  }

  private async runSync(userId: number, bookId: number, reasons: Set<HardcoverAutoSyncReason>): Promise<void> {
    const startedAt = Date.now();
    const formattedReasons = this.formatReasons(reasons);

    await this.enqueueUserSync(userId, async () => {
      try {
        if (!(await this.isAutoSyncEnabled(userId, reasons))) return;

        await this.syncService.syncBook(userId, bookId);
        if (reasons.has('quotes')) {
          await this.quoteSyncService.syncBookQuotes(userId, bookId);
        }
      } catch (err) {
        this.logFailure({ userId, bookId, reasons: formattedReasons, startedAt, err });
      }
    });
  }

  private async resolveBookFileAndRequestSync(request: AutoSyncBookFileRequest): Promise<void> {
    const startedAt = Date.now();
    const reasons = new Set<HardcoverAutoSyncReason>([request.reason]);
    const formattedReasons = this.formatReasons(reasons);

    try {
      if (!(await this.isAutoSyncEnabled(request.userId, reasons))) return;

      const bookId = await this.repository.findBookIdByFileId(request.bookFileId);
      if (!bookId) return;

      this.requestSync({ userId: request.userId, bookId, reason: request.reason });
    } catch (err) {
      this.logFailure({ userId: request.userId, bookFileId: request.bookFileId, reasons: formattedReasons, startedAt, err });
    }
  }

  private enqueueUserSync(userId: number, task: () => Promise<void>): Promise<void> {
    const previous = this.userSyncQueues.get(userId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.userSyncQueues.set(userId, current);
    current
      .finally(() => {
        if (this.userSyncQueues.get(userId) === current) {
          this.userSyncQueues.delete(userId);
        }
      })
      .catch(() => undefined);
    return current;
  }

  private async isAutoSyncEnabled(userId: number, reasons: Set<HardcoverAutoSyncReason>): Promise<boolean> {
    const settings = await this.settingsService.getSettings(userId);
    return settings.effectiveEnabled && this.hasEnabledReason(settings, reasons);
  }

  private hasEnabledReason(settings: HardcoverSettingsSnapshot, reasons: Set<HardcoverAutoSyncReason>): boolean {
    if (reasons.has('status') && settings.autoSyncOnStatusChange) return true;
    if (reasons.has('progress') && settings.autoSyncOnProgressUpdate) return true;
    if (reasons.has('rating') && settings.autoSyncOnRatingChange) return true;
    if (reasons.has('quotes') && settings.syncQuotes) return true;
    return false;
  }

  private formatReasons(reasons: Set<HardcoverAutoSyncReason>): string {
    return REASON_ORDER.filter((reason) => reasons.has(reason)).join(',');
  }

  private logFailure(input: { userId: number; bookId?: number; bookFileId?: number; reasons: string; startedAt: number; err: unknown }): void {
    const errorClass = input.err instanceof Error ? input.err.constructor.name : 'Error';
    const error = sanitizeLogValue(input.err instanceof Error ? input.err.message : String(input.err));
    const bookField = input.bookId !== undefined ? `bookId=${input.bookId}` : `bookFileId=${input.bookFileId}`;
    this.logger.warn(
      `[${AUTO_SYNC_EVENT}] [fail] userId=${input.userId} ${bookField} reasons=${input.reasons} durationMs=${Date.now() - input.startedAt} errorClass=${errorClass} error="${error}" - auto-sync failed`,
    );
  }
}
