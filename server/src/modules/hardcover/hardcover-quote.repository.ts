import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, lt, ne, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { HardcoverQuoteState, NewHardcoverQuoteState } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface PendingQuotePush {
  annotationId: number;
  text: string;
  version: number;
  hardcoverReadingJournalId: number | null;
}

export interface PendingQuoteDelete {
  annotationId: number;
  hardcoverReadingJournalId: number;
}

@Injectable()
export class HardcoverQuoteRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findQuoteState(userId: number, annotationId: number): Promise<HardcoverQuoteState | undefined> {
    return this.db.query.hardcoverQuoteState.findFirst({
      where: and(eq(schema.hardcoverQuoteState.userId, userId), eq(schema.hardcoverQuoteState.annotationId, annotationId)),
    });
  }

  async upsertQuoteState(data: NewHardcoverQuoteState): Promise<HardcoverQuoteState> {
    const [row] = await this.db
      .insert(schema.hardcoverQuoteState)
      .values(data)
      .onConflictDoUpdate({
        target: schema.hardcoverQuoteState.annotationId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteQuoteState(userId: number, annotationId: number): Promise<void> {
    await this.db
      .delete(schema.hardcoverQuoteState)
      .where(and(eq(schema.hardcoverQuoteState.userId, userId), eq(schema.hardcoverQuoteState.annotationId, annotationId)));
  }

  async findAnnotationsPendingPush(userId: number, bookId: number, limit: number): Promise<PendingQuotePush[]> {
    const rows = await this.db
      .select({
        annotationId: schema.annotations.id,
        text: schema.annotations.text,
        version: schema.annotations.version,
        hardcoverReadingJournalId: schema.hardcoverQuoteState.hardcoverReadingJournalId,
      })
      .from(schema.annotations)
      .leftJoin(schema.hardcoverQuoteState, eq(schema.hardcoverQuoteState.annotationId, schema.annotations.id))
      .where(
        and(
          eq(schema.annotations.userId, userId),
          eq(schema.annotations.bookId, bookId),
          isNull(schema.annotations.deletedAt),
          ne(schema.annotations.text, ''),
          or(
            isNull(schema.hardcoverQuoteState.id),
            isNull(schema.hardcoverQuoteState.lastSyncedVersion),
            lt(schema.hardcoverQuoteState.lastSyncedVersion, schema.annotations.version),
            isNotNull(schema.hardcoverQuoteState.syncError),
          ),
        ),
      )
      .orderBy(schema.annotations.id)
      .limit(limit);

    return rows;
  }

  async findAnnotationsPendingDelete(userId: number, bookId: number, limit: number): Promise<PendingQuoteDelete[]> {
    const rows = await this.db
      .select({
        annotationId: schema.annotations.id,
        hardcoverReadingJournalId: schema.hardcoverQuoteState.hardcoverReadingJournalId,
      })
      .from(schema.annotations)
      .innerJoin(schema.hardcoverQuoteState, eq(schema.hardcoverQuoteState.annotationId, schema.annotations.id))
      .where(
        and(
          eq(schema.annotations.userId, userId),
          eq(schema.annotations.bookId, bookId),
          isNotNull(schema.annotations.deletedAt),
          isNotNull(schema.hardcoverQuoteState.hardcoverReadingJournalId),
        ),
      )
      .orderBy(schema.annotations.id)
      .limit(limit);

    return rows as PendingQuoteDelete[];
  }
}
