// ── ProposalsModule ───────────────────────────────────────────────────────
//
// NestJS feature module for inbound brand→creator proposals.
//
// Owns the held-proposal queue lifecycle:
//   - Dispatch with cap enforcement (deliver vs hold)
//   - Release on upgrade / period reset
//   - 90-day auto-decline (via HeldProposalSweeper in SubscriptionsModule)
//
// Imports SubscriptionsModule for SubscriptionsFacade and CapEnforcerService.
// Imports NotificationsModule for in-app notification scheduling.
//
// Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8, 5.10

import { Module } from '@nestjs/common';
import { ProposalsService } from './proposals.service';
import { ProposalsFacade } from './proposals.facade';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [SubscriptionsModule, NotificationsModule],
  providers: [ProposalsService, ProposalsFacade],
  exports: [ProposalsService, ProposalsFacade],
})
export class ProposalsModule {}
