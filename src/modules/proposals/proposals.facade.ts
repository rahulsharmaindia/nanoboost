// ── ProposalsFacade ───────────────────────────────────────────────────────
//
// Read/write API surface exported by ProposalsModule for consumption by
// other modules (SubscriptionsModule schedulers, etc.).
//
// Other modules MUST NOT read inbound_proposals directly — they go through
// this facade so proposal lifecycle evolution stays local to ProposalsModule.
//
// Requirements: 5.7, 5.8, design §Module boundary rules

import { Injectable } from '@nestjs/common';
import { ProposalsService } from './proposals.service';

@Injectable()
export class ProposalsFacade {
  constructor(private readonly proposalsService: ProposalsService) {}

  /**
   * Release all `held_for_upgrade` proposals for a creator to `delivered`
   * status after a studio upgrade. Oldest first.
   *
   * Must be called within a DB transaction (pass the tx handle).
   *
   * Requirements: 5.7
   */
  async releaseAllHeldProposals(tx: any, creatorUserId: string): Promise<number> {
    return this.proposalsService.releaseAllHeldProposals(tx, creatorUserId);
  }

  /**
   * Release up to 3 oldest `held_for_upgrade` proposals to `delivered`
   * at period end (counter reset). Called by PeriodAdvanceScheduler.
   *
   * Must be called within a DB transaction (pass the tx handle).
   *
   * Requirements: 5.8
   */
  async releaseHeldProposalsOnLapse(tx: any, creatorUserId: string): Promise<number> {
    return this.proposalsService.releaseHeldProposalsOnPeriodReset(tx, creatorUserId);
  }
}
