import { Injectable, Logger } from '@nestjs/common';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { HardcoverBookMatchService } from './hardcover-book-match.service';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverQuoteRepository, type PendingQuoteDelete, type PendingQuotePush } from './hardcover-quote.repository';
import { HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HARDCOVER_QUOTE_BATCH_SIZE, HARDCOVER_QUOTE_JOURNAL_EVENT, HARDCOVER_QUOTE_MAX_TEXT_LENGTH } from './hardcover.constants';

const SYNC_EVENT = 'hardcover.sync_quotes';

const INSERT_READING_JOURNAL_MUTATION = `
mutation InsertReadingJournalEntry($object: ReadingJournalCreateType!) {
  insert_reading_journal(object: $object) {
    errors
    reading_journal {
      id
    }
  }
}`;

const UPDATE_READING_JOURNAL_MUTATION = `
mutation UpdateReadingJournalEntry($id: Int!, $object: ReadingJournalUpdateType!) {
  update_reading_journal(id: $id, object: $object) {
    errors
    reading_journal {
      id
    }
  }
}`;

const DELETE_READING_JOURNAL_MUTATION = `
mutation DeleteReadingJournalEntry($id: Int!) {
  delete_reading_journal(id: $id) {
    id
  }
}`;

type InsertReadingJournalResult = { insert_reading_journal: { errors: string[] | null; reading_journal: { id: number } | null } };
type UpdateReadingJournalResult = { update_reading_journal: { errors: string[] | null; reading_journal: { id: number } | null } };
type DeleteReadingJournalResult = { delete_reading_journal: { id: number } | null };

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

@Injectable()
export class HardcoverQuoteSyncService {
  private readonly logger = new Logger(HardcoverQuoteSyncService.name);

  constructor(
    private readonly quoteRepo: HardcoverQuoteRepository,
    private readonly hardcoverRepo: HardcoverRepository,
    private readonly client: HardcoverClientService,
    private readonly matchService: HardcoverBookMatchService,
    private readonly settingsService: HardcoverSettingsService,
  ) {}

  async syncBookQuotes(userId: number, bookId: number): Promise<void> {
    const startedAt = Date.now();
    const settings = await this.settingsService.getSettings(userId);
    if (!settings.effectiveEnabled || !settings.syncQuotes) return;

    const token = await this.settingsService.getTokenForUser(userId);
    if (!token) return;

    const book = await this.hardcoverRepo.findBookSyncData(userId, bookId);
    if (!book) return;

    const match = await this.matchService.matchBook(userId, token, book);
    if (!match) return;

    let pushed = 0;
    let deleted = 0;
    let failed = 0;

    try {
      for (;;) {
        const rows = await this.quoteRepo.findAnnotationsPendingDelete(userId, bookId, HARDCOVER_QUOTE_BATCH_SIZE);
        if (rows.length === 0) break;
        for (const row of rows) {
          const ok = await this.pushDelete(userId, token, row);
          if (ok) deleted++;
          else failed++;
        }
        if (rows.length < HARDCOVER_QUOTE_BATCH_SIZE) break;
      }

      for (;;) {
        const rows = await this.quoteRepo.findAnnotationsPendingPush(userId, bookId, HARDCOVER_QUOTE_BATCH_SIZE);
        if (rows.length === 0) break;
        for (const row of rows) {
          const ok = await this.pushUpsert(userId, bookId, token, match.hardcoverBookId, match.hardcoverEditionId, settings.privacySettingId, row);
          if (ok) pushed++;
          else failed++;
        }
        if (rows.length < HARDCOVER_QUOTE_BATCH_SIZE) break;
      }
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[${SYNC_EVENT}] [fail] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - quote sync crashed`,
      );
      return;
    }

    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${userId} bookId=${bookId} durationMs=${Date.now() - startedAt} pushed=${pushed} deleted=${deleted} failed=${failed} - quote sync completed`,
    );
  }

  private async pushUpsert(
    userId: number,
    bookId: number,
    token: string,
    hardcoverBookId: number,
    hardcoverEditionId: number | null,
    privacySettingId: number,
    row: PendingQuotePush,
  ): Promise<boolean> {
    const entry = truncate(row.text, HARDCOVER_QUOTE_MAX_TEXT_LENGTH);

    try {
      // ReadingJournalCreateType requires book_id and tags (tags is a non-null list, so it
      // must be present even when empty); ReadingJournalUpdateType has neither field (the
      // entry's book can't change after creation, and omitted tags leave them untouched), so
      // the two mutations need distinct object shapes rather than one shared payload.
      const journalId =
        row.hardcoverReadingJournalId == null
          ? await this.insertJournalEntry(userId, token, {
              book_id: hardcoverBookId,
              event: HARDCOVER_QUOTE_JOURNAL_EVENT,
              entry,
              ...(hardcoverEditionId != null && { edition_id: hardcoverEditionId }),
              privacy_setting_id: privacySettingId,
              tags: [],
            })
          : await this.updateJournalEntry(userId, token, row.hardcoverReadingJournalId, {
              entry,
              ...(hardcoverEditionId != null && { edition_id: hardcoverEditionId }),
              privacy_setting_id: privacySettingId,
            });

      await this.quoteRepo.upsertQuoteState({
        userId,
        bookId,
        annotationId: row.annotationId,
        hardcoverReadingJournalId: journalId,
        lastSyncedVersion: row.version,
        lastSyncedAt: new Date(),
        syncError: null,
      });
      return true;
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${SYNC_EVENT}] [fail] userId=${userId} bookId=${bookId} annotationId=${row.annotationId} error="${error}" - quote push failed`,
      );
      await this.quoteRepo.upsertQuoteState({
        userId,
        bookId,
        annotationId: row.annotationId,
        hardcoverReadingJournalId: row.hardcoverReadingJournalId,
        lastSyncedVersion: null,
        syncError: error,
      });
      return false;
    }
  }

  private async pushDelete(userId: number, token: string, row: PendingQuoteDelete): Promise<boolean> {
    try {
      await this.client.query<DeleteReadingJournalResult>(userId, token, DELETE_READING_JOURNAL_MUTATION, { id: row.hardcoverReadingJournalId });
      await this.quoteRepo.deleteQuoteState(userId, row.annotationId);
      return true;
    } catch (err) {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${SYNC_EVENT}] [fail] userId=${userId} annotationId=${row.annotationId} hardcoverReadingJournalId=${row.hardcoverReadingJournalId} error="${error}" - quote delete failed`,
      );
      return false;
    }
  }

  private async insertJournalEntry(userId: number, token: string, object: Record<string, unknown>): Promise<number> {
    const result = await this.client.query<InsertReadingJournalResult>(userId, token, INSERT_READING_JOURNAL_MUTATION, { object });
    if (result.insert_reading_journal.errors?.length) {
      throw new Error(result.insert_reading_journal.errors.join(', '));
    }
    const id = result.insert_reading_journal.reading_journal?.id;
    if (id == null) throw new Error('insert_reading_journal returned no id');
    return id;
  }

  private async updateJournalEntry(userId: number, token: string, id: number, object: Record<string, unknown>): Promise<number> {
    const result = await this.client.query<UpdateReadingJournalResult>(userId, token, UPDATE_READING_JOURNAL_MUTATION, { id, object });
    if (result.update_reading_journal.errors?.length) {
      throw new Error(result.update_reading_journal.errors.join(', '));
    }
    return result.update_reading_journal.reading_journal?.id ?? id;
  }
}
