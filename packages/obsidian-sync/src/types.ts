/**
 * Shared API types come from @bookorbit/types (the workspace source of truth).
 * Only client-auth credential shapes are local: the shared package models the
 * web login flow, while this tool uses native client mode where tokens are
 * returned in the response body.
 */

export type {
  AnnotationHubItem,
  AnnotationHubResponse,
  AnnotationHubStats,
  BookCard,
  BooksAddedDataPoint,
  CurrentlyReadingWidgetData,
  DashboardScrollerResponse,
  FormatDistributionItem,
  GenreDistributionItem,
  HighlightOfTheDayWidgetData,
  LibraryOverviewWidgetData,
  MonthlyChallengeWidgetData,
  ReadingGoalWidgetData,
  ReadingStreakWidgetData,
  StatisticsResult,
  StatisticsSummary,
  TopAuthorItem,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserGenreReadingTimeItem,
  UserSessionTimeline,
  UserSessionTimelineItem,
  UserStatisticsSummary,
  YearProjectionWidgetData,
} from '@bookorbit/types';

/** Full credentials returned by native-mode login/refresh (tokens in the body). */
export interface TokenCredentials {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: number | null;
}

export interface LoginResponse extends TokenCredentials {
  user: unknown;
}
