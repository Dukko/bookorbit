import { Module } from '@nestjs/common';

import { AchievementModule } from '../achievement/achievement.module';
import { BookModule } from '../book/book.module';
import { LibraryModule } from '../library/library.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { HardcoverAutoSyncSchedulerService } from './hardcover-auto-sync-scheduler.service';
import { HardcoverBookMatchService } from './hardcover-book-match.service';
import { HardcoverClientService } from './hardcover-client.service';
import { HardcoverController } from './hardcover.controller';
import { HardcoverEventListener } from './hardcover-event-listener.service';
import { HardcoverImportService } from './hardcover-import.service';
import { HardcoverQueueService } from './hardcover-queue.service';
import { HardcoverQuoteRepository } from './hardcover-quote.repository';
import { HardcoverQuoteSyncService } from './hardcover-quote-sync.service';
import { HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import { HardcoverSyncService } from './hardcover-sync.service';

@Module({
  imports: [AchievementModule, BookModule, LibraryModule, UserBookStatusModule],
  controllers: [HardcoverController],
  providers: [
    HardcoverQueueService,
    HardcoverClientService,
    HardcoverRepository,
    HardcoverQuoteRepository,
    HardcoverSettingsService,
    HardcoverBookMatchService,
    HardcoverSyncService,
    HardcoverQuoteSyncService,
    HardcoverImportService,
    HardcoverAutoSyncSchedulerService,
    HardcoverEventListener,
  ],
  exports: [HardcoverSyncService, HardcoverSettingsService],
})
export class HardcoverModule {}
