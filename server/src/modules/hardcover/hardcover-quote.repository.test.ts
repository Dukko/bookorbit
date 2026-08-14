import { describe, expect, it, vi, beforeEach } from 'vitest';

import { HardcoverQuoteRepository } from './hardcover-quote.repository';

function makeReturningChain(row: unknown) {
  const chain = {
    values: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    returning: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.returning.mockResolvedValue([row]);
  return chain;
}

function makeSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function makeRepository(opts: { selectRows?: unknown[]; upsertRow?: unknown } = {}) {
  const quoteStateRow = opts.upsertRow ?? { id: 1, userId: 7, bookId: 42, annotationId: 99, hardcoverReadingJournalId: 500 };
  const findFirst = vi.fn().mockResolvedValue(quoteStateRow);
  const insertChain = makeReturningChain(quoteStateRow);
  const selectChain = makeSelectChain(opts.selectRows ?? []);
  const deleteWhere = vi.fn().mockResolvedValue(undefined);

  const db = {
    query: { hardcoverQuoteState: { findFirst } },
    insert: vi.fn().mockReturnValue(insertChain),
    select: vi.fn().mockReturnValue(selectChain),
    delete: vi.fn().mockReturnValue({ where: deleteWhere }),
  };

  return { repo: new HardcoverQuoteRepository(db as never), db, findFirst, insertChain, selectChain, deleteWhere };
}

describe('HardcoverQuoteRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findQuoteState delegates to db.query.hardcoverQuoteState.findFirst', async () => {
    const { repo, findFirst } = makeRepository();
    const result = await repo.findQuoteState(7, 99);
    expect(findFirst).toHaveBeenCalled();
    expect(result).toMatchObject({ annotationId: 99 });
  });

  it('upsertQuoteState inserts with onConflictDoUpdate on annotationId', async () => {
    const { repo, insertChain } = makeRepository();
    const data = { userId: 7, bookId: 42, annotationId: 99, hardcoverReadingJournalId: 500, lastSyncedVersion: 1 };
    const result = await repo.upsertQuoteState(data as never);
    expect(insertChain.values).toHaveBeenCalledWith(data);
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
    expect(result).toMatchObject({ annotationId: 99 });
  });

  it('deleteQuoteState issues a delete scoped to userId and annotationId', async () => {
    const { repo, db, deleteWhere } = makeRepository();
    await repo.deleteQuoteState(7, 99);
    expect(db.delete).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
  });

  it('findAnnotationsPendingPush returns rows from the select chain', async () => {
    const rows = [{ annotationId: 1, text: 'hello', version: 2, hardcoverReadingJournalId: null }];
    const { repo, selectChain } = makeRepository({ selectRows: rows });
    const result = await repo.findAnnotationsPendingPush(7, 42, 25);
    expect(selectChain.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual(rows);
  });

  it('findAnnotationsPendingDelete returns rows from the select chain', async () => {
    const rows = [{ annotationId: 2, hardcoverReadingJournalId: 501 }];
    const { repo, selectChain } = makeRepository({ selectRows: rows });
    const result = await repo.findAnnotationsPendingDelete(7, 42, 25);
    expect(selectChain.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual(rows);
  });
});
