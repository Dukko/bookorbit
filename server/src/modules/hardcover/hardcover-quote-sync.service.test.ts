import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverQuoteSyncService } from './hardcover-quote-sync.service';

const mockQuoteRepo = {
  findAnnotationsPendingPush: vi.fn(),
  findAnnotationsPendingDelete: vi.fn(),
  upsertQuoteState: vi.fn(),
  deleteQuoteState: vi.fn(),
};

const mockHardcoverRepo = {
  findBookSyncData: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

const mockMatchService = {
  matchBook: vi.fn(),
};

const mockSettingsService = {
  getSettings: vi.fn(),
  getTokenForUser: vi.fn(),
};

function makeService() {
  return new HardcoverQuoteSyncService(
    mockQuoteRepo as any,
    mockHardcoverRepo as any,
    mockClient as any,
    mockMatchService as any,
    mockSettingsService as any,
  );
}

const enabledSettings = {
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

const book = { bookId: 1, isbn13: null, isbn10: null, title: 'T', authorName: 'A', hardcoverMetadataId: null, status: 'reading' };
const match = { hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 100, matchMethod: 'isbn' as const };

describe('HardcoverQuoteSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue(enabledSettings);
    mockSettingsService.getTokenForUser.mockResolvedValue('tok');
    mockHardcoverRepo.findBookSyncData.mockResolvedValue(book);
    mockMatchService.matchBook.mockResolvedValue(match);
    mockQuoteRepo.findAnnotationsPendingDelete.mockResolvedValue([]);
    mockQuoteRepo.findAnnotationsPendingPush.mockResolvedValue([]);
    mockQuoteRepo.upsertQuoteState.mockResolvedValue({});
    mockQuoteRepo.deleteQuoteState.mockResolvedValue(undefined);
  });

  it('does nothing when syncQuotes is disabled', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ ...enabledSettings, syncQuotes: false });
    await makeService().syncBookQuotes(1, 1);
    expect(mockSettingsService.getTokenForUser).not.toHaveBeenCalled();
  });

  it('does nothing when there is no token', async () => {
    mockSettingsService.getTokenForUser.mockResolvedValue(null);
    await makeService().syncBookQuotes(1, 1);
    expect(mockHardcoverRepo.findBookSyncData).not.toHaveBeenCalled();
  });

  it('does nothing when the book has no sync data', async () => {
    mockHardcoverRepo.findBookSyncData.mockResolvedValue(null);
    await makeService().syncBookQuotes(1, 1);
    expect(mockMatchService.matchBook).not.toHaveBeenCalled();
  });

  it('does nothing when there is no Hardcover match', async () => {
    mockMatchService.matchBook.mockResolvedValue(null);
    await makeService().syncBookQuotes(1, 1);
    expect(mockQuoteRepo.findAnnotationsPendingPush).not.toHaveBeenCalled();
  });

  it('inserts a new annotation as a quote and records the returned journal id', async () => {
    mockQuoteRepo.findAnnotationsPendingPush.mockResolvedValueOnce([
      { annotationId: 5, text: 'a quote', version: 1, hardcoverReadingJournalId: null },
    ]);
    mockClient.query.mockResolvedValueOnce({ insert_reading_journal: { errors: null, reading_journal: { id: 900 } } });

    await makeService().syncBookQuotes(1, 1);

    expect(mockClient.query).toHaveBeenCalledWith(
      1,
      'tok',
      expect.stringContaining('insert_reading_journal'),
      expect.objectContaining({
        object: expect.objectContaining({ book_id: 10, event: 'quote', entry: 'a quote', edition_id: 20, privacy_setting_id: 3, tags: [] }),
      }),
    );
    expect(mockQuoteRepo.upsertQuoteState).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, bookId: 1, annotationId: 5, hardcoverReadingJournalId: 900, lastSyncedVersion: 1, syncError: null }),
    );
  });

  it('updates an existing quote when the annotation was already pushed', async () => {
    mockQuoteRepo.findAnnotationsPendingPush.mockResolvedValueOnce([{ annotationId: 5, text: 'edited', version: 2, hardcoverReadingJournalId: 900 }]);
    mockClient.query.mockResolvedValueOnce({ update_reading_journal: { errors: null, reading_journal: { id: 900 } } });

    await makeService().syncBookQuotes(1, 1);

    expect(mockClient.query).toHaveBeenCalledWith(
      1,
      'tok',
      expect.stringContaining('update_reading_journal'),
      expect.objectContaining({ id: 900, object: expect.objectContaining({ entry: 'edited' }) }),
    );
    const updateCallObject = mockClient.query.mock.calls[0]![3].object;
    expect(updateCallObject).not.toHaveProperty('book_id');
    expect(mockQuoteRepo.upsertQuoteState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedVersion: 2 }));
  });

  it('records a sync error and leaves lastSyncedVersion stale on push failure', async () => {
    mockQuoteRepo.findAnnotationsPendingPush.mockResolvedValueOnce([{ annotationId: 5, text: 'x', version: 1, hardcoverReadingJournalId: null }]);
    mockClient.query.mockRejectedValueOnce(new Error('boom'));

    await makeService().syncBookQuotes(1, 1);

    expect(mockQuoteRepo.upsertQuoteState).toHaveBeenCalledWith(
      expect.objectContaining({ annotationId: 5, hardcoverReadingJournalId: null, lastSyncedVersion: null, syncError: 'boom' }),
    );
  });

  it('deletes a quote for a soft-deleted annotation and clears its state', async () => {
    mockQuoteRepo.findAnnotationsPendingDelete.mockResolvedValueOnce([{ annotationId: 7, hardcoverReadingJournalId: 901 }]);
    mockClient.query.mockResolvedValueOnce({ delete_reading_journal: { id: 901 } });

    await makeService().syncBookQuotes(1, 1);

    expect(mockClient.query).toHaveBeenCalledWith(1, 'tok', expect.stringContaining('delete_reading_journal'), { id: 901 });
    expect(mockQuoteRepo.deleteQuoteState).toHaveBeenCalledWith(1, 7);
  });

  it('leaves quote state untouched when a delete fails', async () => {
    mockQuoteRepo.findAnnotationsPendingDelete.mockResolvedValueOnce([{ annotationId: 7, hardcoverReadingJournalId: 901 }]);
    mockClient.query.mockRejectedValueOnce(new Error('delete failed'));

    await makeService().syncBookQuotes(1, 1);

    expect(mockQuoteRepo.deleteQuoteState).not.toHaveBeenCalled();
  });

  it('drains multiple batches until a short page is returned', async () => {
    const fullBatch = Array.from({ length: 25 }, (_, i) => ({ annotationId: i, text: `t${i}`, version: 1, hardcoverReadingJournalId: null }));
    const lastBatch = [{ annotationId: 999, text: 'last', version: 1, hardcoverReadingJournalId: null }];
    mockQuoteRepo.findAnnotationsPendingPush.mockResolvedValueOnce(fullBatch).mockResolvedValueOnce(lastBatch).mockResolvedValueOnce([]);
    mockClient.query.mockResolvedValue({ insert_reading_journal: { errors: null, reading_journal: { id: 1 } } });

    await makeService().syncBookQuotes(1, 1);

    expect(mockQuoteRepo.findAnnotationsPendingPush).toHaveBeenCalledTimes(2);
    expect(mockClient.query).toHaveBeenCalledTimes(26);
  });
});
