// ── HeldProposalSweeper ───────────────────────────────────────────────────
//
// Runs daily and auto-declines proposals that have been in `held_for_upgrade`
// status for 90 or more cumulative days.
//
// The 90-day clock starts from the moment the proposal entered
// `held_for_upgrade` status (recorded as `held_at` on the inbound_proposals
// table, or `created_at` if `held_at` is absent). The count is cumulative
// across periods — a proposal that was held, partially released, and re-held
// accumulates time from its original hold timestamp.
//
// On auto-decline:
//   1. Update proposal status to `auto_declined`.
//   2. Notify the brand via the outbox (in-app + email).
//
// Requirements: 5.9

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, lte, sql } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../../database/database.module';
import { NotificationsService } from '../../notifications/notifications.service';

// ── Constants ─────────────────────────────────────────────────────────────

/** How often the sweeper runs (ms). Once per day. */
const CRON_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Number of cumulative days before a held proposal is auto-declined (Req 5.9). */
const HELD_DAYS_LIMIT = 90;

// ── Sweeper ───────────────────────────────────────────────────────────────

@Injectable()
export class HeldProposalSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HeldProposalSweeper.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      this.autoDeclineStaleProposals().catch((err: Error) => {
        this.logger.error(
          `autoDeclineStaleProposals top-level error: ${err.message}`,
          err.stack,
        );
      });
    }, CRON_INTERVAL_MS);

    this.logger.log(`HeldProposalSweeper started (interval: ${CRON_INTERVAL_MS}ms)`);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('HeldProposalSweeper stopped');
    }
  }

  // ── Main entry point ──────────────────────────────────────────────────

  /**
   * Find all proposals that have been in `held_for_upgrade` status for 90+
   * cumulative days and auto-decline them, notifying the brand for each.
   *
   * The cutoff date is `now − 90 days`. Any proposal whose `held_at`
   * (or `created_at` as fallback) is on or before the cutoff is stale.
   *
   * Each proposal is processed in its own transaction so a failure on one
   * does not block the others.
   *
   * Requirements: 5.9
   */
  async autoDeclineStaleProposals(now = new Date()): Promise<void> {
    const cutoffDate = new Date(now.getTime() - HELD_DAYS_LIMIT * 24 * 60 * 60 * 1000);

    // Query stale held proposals using raw SQL so this sweeper compiles
    // independently of the inbound_proposals table schema (which is created
    // in task 12.8). The table and column names match the schema that will
    // be introduced by that task.
    //
    // Expected schema (inbound_proposals):
    //   id          text PK
    //   brand_id    text NOT NULL
    //   creator_id  text NOT NULL
    //   status      text NOT NULL  -- 'held_for_upgrade' | 'delivered' | 'auto_declined' | …
    //   held_at     timestamp      -- when the proposal entered held_for_upgrade
    //   created_at  timestamp NOT NULL
    //
    // If the table does not yet exist (pre-task-12.8 environment), the query
    // will throw and the error is caught + logged without crashing the process.
    let staleProposals: Array<{
      id: string;
      brandId: string;
      creatorId: string;
      heldAt: Date;
    }>;

    try {
      staleProposals = await this.db.execute(
        sql`
          SELECT
            id,
            brand_id   AS "brandId",
            creator_id AS "creatorId",
            COALESCE(held_at, created_at) AS "heldAt"
          FROM inbound_proposals
          WHERE status = 'held_for_upgrade'
            AND COALESCE(held_at, created_at) <= ${cutoffDate}
        `,
      );
    } catch (err) {
      // Table may not exist yet (pre-migration environment). Log and exit
      // gracefully so the sweeper does not crash the process.
      this.logger.warn(
        `autoDeclineStaleProposals: could not query inbound_proposals — ` +
          `table may not exist yet. Error: ${(err as Error).message}`,
      );
      return;
    }

    if (!staleProposals || staleProposals.length === 0) {
      this.logger.debug('autoDeclineStaleProposals: no stale proposals found');
      return;
    }

    this.logger.log(
      `autoDeclineStaleProposals: found ${staleProposals.length} stale proposal(s) to auto-decline`,
    );

    let declined = 0;
    let failed = 0;

    for (const proposal of staleProposals) {
      try {
        await this.declineProposal(proposal, now);
        declined++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Failed to auto-decline proposal ${proposal.id}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    this.logger.log(
      `autoDeclineStaleProposals: declined=${declined}, failed=${failed}`,
    );
  }

  // ── Per-proposal processing ───────────────────────────────────────────

  /**
   * Auto-decline a single stale proposal in its own transaction.
   *
   * Steps (atomic):
   *   1. Update proposal status to `auto_declined`.
   *   2. Schedule brand notification via outbox (in-app + email).
   *
   * Requirements: 5.9
   */
  private async declineProposal(
    proposal: { id: string; brandId: string; creatorId: string; heldAt: Date },
    now: Date,
  ): Promise<void> {
    await this.db.transaction(async (tx: any) => {
      // 1. Update status to auto_declined.
      //    Use a WHERE clause to guard against concurrent updates — only
      //    transition if still in held_for_upgrade.
      const result = await tx.execute(
        sql`
          UPDATE inbound_proposals
          SET
            status     = 'auto_declined',
            updated_at = ${now}
          WHERE id     = ${proposal.id}
            AND status = 'held_for_upgrade'
          RETURNING id
        `,
      );

      // If no row was updated, another process already handled this proposal.
      if (!result || result.length === 0) {
        this.logger.debug(
          `Proposal ${proposal.id} was already processed by another instance — skipping`,
        );
        return;
      }

      // 2. Notify the brand via the outbox (in-app notification).
      await this.notificationsService.scheduleInTx(tx, {
        type: 'in_app',
        payload: {
          userId: proposal.brandId,
          type: 'proposal_auto_declined',
          proposalId: proposal.id,
          creatorId: proposal.creatorId,
          reason: 'held_90_days',
          declinedAt: now.toISOString(),
        },
        idempotencyKey: `proposal_auto_declined_inapp:${proposal.id}`,
      });

      // 3. Notify the brand via email.
      await this.notificationsService.scheduleInTx(tx, {
        type: 'email',
        payload: {
          userId: proposal.brandId,
          templateId: 'proposal_auto_declined',
          proposalId: proposal.id,
          creatorId: proposal.creatorId,
          heldAt: proposal.heldAt.toISOString(),
          declinedAt: now.toISOString(),
        },
        idempotencyKey: `proposal_auto_declined_email:${proposal.id}`,
      });
    });

    this.logger.log(
      `Proposal ${proposal.id} (brand ${proposal.brandId}, creator ${proposal.creatorId}): ` +
        `auto-declined after 90+ days in held_for_upgrade`,
    );
  }
}
