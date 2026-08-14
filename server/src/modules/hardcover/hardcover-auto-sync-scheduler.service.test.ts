import { Logger } from '@nestjs/common';
import type { HardcoverSettings } from '@bookorbit/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HardcoverAutoSyncSchedulerService,
  HARDCOVER_AUTO_SYNC_DEBOUNCE_MS,
  type HardcoverAutoSyncReason,
} from './hardcover-auto-sync-scheduler.service';
import { HardcoverQuoteSyncService } from './hardcover-quote-sync.service';
import { HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

const mockSettingsService = {
  getSettings: vi.fn(),
};

const mockSyncService = {
  syncBook: vi.fn(),
};

const mockQuoteSyncService = {
  syncBookQuotes: vi.fn(),
};

const mockRepository = {
  findBookIdByFileId: vi.fn(),
};

const enabledSettings: HardcoverSettings = {
  tokenConfigured: true,
  enabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  syncQuotes: true,
  privacySettingId: 3,
  lastSyncedAt: null,
};

function makeDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function advanceDebounce(ms = HARDCOVER_AUTO_SYNC_DEBOUNCE_MS) {
  await vi.advanceTimersByTimeAsync(ms);
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('HardcoverAutoSyncSchedulerService', () => {
  let service: HardcoverAutoSyncSchedulerService;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
    mockSyncService.syncBook.mockResolvedValue(undefined);
    mockQuoteSyncService.syncBookQuotes.mockResolvedValue(undefined);
    mockRepository.findBookIdByFileId.mockResolvedValue(42);
    warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new HardcoverAutoSyncSchedulerService(
      mockSettingsService as unknown as HardcoverSettingsService,
      mockSyncService as unknown as HardcoverSyncService,
      mockQuoteSyncService as unknown as HardcoverQuoteSyncService,
      mockRepository as unknown as HardcoverRepository,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces status and progress events for the same user-book into one sync', async () => {
    service.requestSync({ userId: 1, bookId: 10, reason: 'status' });
    await vi.advanceTimersByTimeAsync(500);
    service.requestSync({ userId: 1, bookId: 10, reason: 'progress' });

    await vi.advanceTimersByTimeAsync(HARDCOVER_AUTO_SYNC_DEBOUNCE_MS - 1);
    expect(mockSyncService.syncBook).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(mockSettingsService.getSettings).toHaveBeenCalledTimes(1);
    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);
    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 10);
  });

  it.each([
    ['status', 'autoSyncOnStatusChange'],
    ['progress', 'autoSyncOnProgressUpdate'],
    ['rating', 'autoSyncOnRatingChange'],
    ['quotes', 'syncQuotes'],
  ] as Array<[HardcoverAutoSyncReason, keyof typeof enabledSettings]>)(
    'skips %s sync when the matching toggle is disabled',
    async (reason, settingKey) => {
      mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, [settingKey]: false });

      service.requestSync({ userId: 1, bookId: 10, reason });
      await advanceDebounce();

      expect(mockSyncService.syncBook).not.toHaveBeenCalled();
      expect(mockQuoteSyncService.syncBookQuotes).not.toHaveBeenCalled();
    },
  );

  it('calls quoteSyncService.syncBookQuotes alongside syncService.syncBook when quotes reason is enabled', async () => {
    service.requestSync({ userId: 1, bookId: 10, reason: 'quotes' });
    await advanceDebounce();

    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 10);
    expect(mockQuoteSyncService.syncBookQuotes).toHaveBeenCalledWith(1, 10);
  });

  it('does not call quoteSyncService.syncBookQuotes when quotes is not among the coalesced reasons', async () => {
    service.requestSync({ userId: 1, bookId: 10, reason: 'status' });
    await advanceDebounce();

    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 10);
    expect(mockQuoteSyncService.syncBookQuotes).not.toHaveBeenCalled();
  });

  it('syncs when at least one coalesced reason has an enabled toggle', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, autoSyncOnProgressUpdate: false });

    service.requestSync({ userId: 1, bookId: 10, reason: 'progress' });
    service.requestSync({ userId: 1, bookId: 10, reason: 'status' });
    await advanceDebounce();

    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);
    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 10);
  });

  it('does not resolve reading-session book files when progress auto-sync is disabled', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, autoSyncOnProgressUpdate: false });

    service.requestSyncForBookFile({ userId: 1, bookFileId: 5, reason: 'progress' });
    await flushPromises();

    expect(mockRepository.findBookIdByFileId).not.toHaveBeenCalled();
    expect(mockSyncService.syncBook).not.toHaveBeenCalled();
  });

  it('resolves reading-session book files after settings pass and schedules progress sync', async () => {
    service.requestSyncForBookFile({ userId: 1, bookFileId: 5, reason: 'progress' });
    await flushPromises();

    expect(mockRepository.findBookIdByFileId).toHaveBeenCalledWith(5);

    await advanceDebounce();

    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);
    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 42);
  });

  it.each([
    ['permission denied', { effectiveEnabled: false, disabledReason: 'permission_denied' }],
    ['token missing', { tokenConfigured: false, effectiveEnabled: false, disabledReason: 'missing_token' }],
    ['integration disabled', { enabled: false, effectiveEnabled: false, disabledReason: 'user_disabled' }],
  ] as Array<[string, Partial<typeof enabledSettings>]>)('skips when %s', async (_name, settingsPatch) => {
    mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, ...settingsPatch });

    service.requestSync({ userId: 1, bookId: 10, reason: 'progress' });
    await advanceDebounce();

    expect(mockSyncService.syncBook).not.toHaveBeenCalled();
  });

  it('schedules one follow-up sync when a request arrives while the same user-book is in flight', async () => {
    const firstSync = makeDeferred<void>();
    mockSyncService.syncBook.mockReturnValueOnce(firstSync.promise).mockResolvedValueOnce(undefined);

    service.requestSync({ userId: 1, bookId: 10, reason: 'progress' });
    await advanceDebounce();
    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);

    service.requestSync({ userId: 1, bookId: 10, reason: 'status' });
    await advanceDebounce();
    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);

    firstSync.resolve();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(HARDCOVER_AUTO_SYNC_DEBOUNCE_MS - 1);
    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(2);
    expect(mockSyncService.syncBook).toHaveBeenNthCalledWith(2, 1, 10);
  });

  it('serializes syncs for different books belonging to the same user', async () => {
    const firstSync = makeDeferred<void>();
    mockSyncService.syncBook.mockReturnValueOnce(firstSync.promise).mockResolvedValueOnce(undefined);

    service.requestSync({ userId: 1, bookId: 10, reason: 'rating' });
    service.requestSync({ userId: 1, bookId: 11, reason: 'rating' });
    await advanceDebounce();

    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(1);
    expect(mockSyncService.syncBook).toHaveBeenCalledWith(1, 10);

    firstSync.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(2);
    expect(mockSyncService.syncBook).toHaveBeenNthCalledWith(2, 1, 11);
  });

  it('allows different users to sync independently', async () => {
    const firstSync = makeDeferred<void>();
    mockSyncService.syncBook.mockReturnValueOnce(firstSync.promise).mockResolvedValueOnce(undefined);

    service.requestSync({ userId: 1, bookId: 10, reason: 'rating' });
    service.requestSync({ userId: 2, bookId: 20, reason: 'rating' });
    await advanceDebounce();

    expect(mockSyncService.syncBook).toHaveBeenCalledTimes(2);
    expect(mockSyncService.syncBook).toHaveBeenNthCalledWith(1, 1, 10);
    expect(mockSyncService.syncBook).toHaveBeenNthCalledWith(2, 2, 20);

    firstSync.resolve();
  });

  it('swallows sync failures and logs a sanitized warning', async () => {
    mockSyncService.syncBook.mockRejectedValue(new Error('API "bad"\nline'));

    service.requestSync({ userId: 1, bookId: 10, reason: 'progress' });
    await advanceDebounce();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[hardcover.auto_sync] [fail] userId=1 bookId=10 reasons=progress'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('errorClass=Error error="API \\"bad\\" line"'));
  });
});
