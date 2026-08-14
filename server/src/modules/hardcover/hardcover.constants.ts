export const HARDCOVER_GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
export const HARDCOVER_MIN_INTERVAL_MS = 1100;
export const HARDCOVER_MAX_RETRIES = 3;

export const HARDCOVER_STATUS = {
  WANT_TO_READ: 1,
  CURRENTLY_READING: 2,
  READ: 3,
  PAUSED: 4,
  DNF: 5,
  IGNORED: 6,
} as const;

export const HARDCOVER_PRIVACY = {
  PUBLIC: 1,
  FOLLOWS: 2,
  PRIVATE: 3,
} as const;

export const HARDCOVER_EVENT = {
  RATING_CHANGED: 'hardcover.rating_changed',
} as const;

export const HARDCOVER_QUOTE_JOURNAL_EVENT = 'quote';
// How many highlights to push per syncBookQuotes drain iteration.
export const HARDCOVER_QUOTE_BATCH_SIZE = 25;
// Hardcover's reading_journal.entry has no documented cap; keep it well under Postgres's
// text limits and Hardcover's own UI truncation for quotes.
export const HARDCOVER_QUOTE_MAX_TEXT_LENGTH = 8191;
