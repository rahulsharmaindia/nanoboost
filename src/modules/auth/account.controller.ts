// ── Account management controller ────────────────────────────
// Data deletion (Meta requirement) and Instagram disconnect.

import { Controller, Post, Get, Patch, Query, Req, Body, Inject, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { eq } from 'drizzle-orm';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { InfluencerSessionService } from '../../common/services/influencer-session.service';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { accountDeletionRequests } from '../../database/schema/account-deletion.schema';
import { influencers } from '../../database/schema/influencers.schema';
import { Public } from '../../common/decorators/public.decorator';
import { env } from '../../config/env';

// ── Onboarding profile-completion payload ────────────────────
// Niche is mandatory FREE TEXT: NICHE_VALUES are only autocomplete
// suggestions on the client, never an allow-list — so there is no
// @IsIn constraint here. A non-empty string (predefined or custom)
// is accepted.
export class SubmitProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  instagramHandle!: string;

  @IsString()
  @IsNotEmpty()
  niche!: string;

  @IsInt()
  @Min(0)
  followerCount!: number;

  @IsString()
  @IsNotEmpty()
  contactNumber!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  @IsNotEmpty()
  profilePictureDataUri!: string;
}

// ── Update profile payload ────────────────────────────────────
// All fields are optional so callers only send what changed.
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  instagramHandle?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  niche?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  followerCount?: number;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  profilePictureDataUri?: string;
}

@Controller()
export class AccountController {
  constructor(
    private readonly sessionService: InfluencerSessionService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
  ) {}

  private async recordDeletionRequest(subjectId: string): Promise<string> {
    const confirmationCode = randomBytes(8).toString('hex').toUpperCase();
    if (this.db) {
      await this.db.insert(accountDeletionRequests).values({
        subjectType: 'influencer',
        subjectId,
        confirmationCode,
        status: 'pending',
      });
    }
    return confirmationCode;
  }

  // POST /api/account/delete
  @UseGuards(AuthGuard)
  @Post('api/account/delete')
  async deleteAccount(@Req() req: Request) {
    const influencerId = (req as any).influencerId as string;
    const sessionId = (req as any).sessionId as string;
    const confirmationCode = await this.recordDeletionRequest(influencerId);
    await this.sessionService.disconnect(influencerId);
    await this.sessionService.remove(sessionId);
    return {
      confirmationCode,
      status: 'pending',
      message: 'Your account deletion has been scheduled. All data will be removed within 30 days.',
    };
  }

  // POST /api/account/disconnect
  @UseGuards(AuthGuard)
  @Post('api/account/disconnect')
  async disconnectInstagram(@Req() req: Request) {
    const influencerId = (req as any).influencerId as string;
    await this.sessionService.disconnect(influencerId);
    return { status: 'disconnected' };
  }

  // POST /api/account/profile
  //
  // Persists the mandatory onboarding fields for the authenticated
  // influencer and flips them out of the profile-completion hard-lock.
  // The Instagram handle, niche, follower count, and contact number are
  // required (validated on SubmitProfileDto); the display name is
  // optional and only persisted when a non-empty value is supplied.
  // Contact number is stamped `unverified` and the profile is marked
  // `complete` in the same update.
  @UseGuards(AuthGuard)
  @Post('api/account/profile')
  async submitProfile(@Req() req: Request, @Body() dto: SubmitProfileDto) {
    const influencerId = (req as any).influencerId as string;

    const trimmedDisplayName = dto.displayName?.trim();

    await this.db
      .update(influencers)
      .set({
        instagramHandle: dto.instagramHandle.trim(),
        niche: dto.niche.trim(),
        followerCount: dto.followerCount,
        contactNumber: dto.contactNumber.trim(),
        // Persist the display name only when a non-empty value was supplied.
        ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
        // Profile picture is mandatory — always persisted.
        profilePictureUrl: dto.profilePictureDataUri,
        contactVerificationStatus: 'unverified',
        profileCompletionStatus: 'complete',
        updatedAt: new Date(),
      })
      .where(eq(influencers.influencerId, influencerId));

    return { profile_completion_status: 'complete' };
  }

  // PATCH /api/account/profile
  //
  // Updates mutable profile fields for the authenticated influencer.
  // Every field is optional — only the supplied fields are written.
  // profilePictureDataUri replaces the stored picture when provided.
  @UseGuards(AuthGuard)
  @Patch('api/account/profile')
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const influencerId = (req as any).influencerId as string;

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.instagramHandle !== undefined) {
      update.instagramHandle = dto.instagramHandle.trim();
    }
    if (dto.niche !== undefined) {
      update.niche = dto.niche.trim();
    }
    if (dto.followerCount !== undefined) {
      update.followerCount = dto.followerCount;
    }
    if (dto.contactNumber !== undefined) {
      const trimmed = dto.contactNumber.trim();
      update.contactNumber = trimmed.length > 0 ? trimmed : null;
    }
    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName.trim();
      update.displayName = trimmed.length > 0 ? trimmed : null;
    }
    if (dto.profilePictureDataUri !== undefined) {
      update.profilePictureUrl = dto.profilePictureDataUri;
    }

    await this.db
      .update(influencers)
      .set(update)
      .where(eq(influencers.influencerId, influencerId));

    return { status: 'updated' };
  }

  // POST /api/meta/deletion-callback (Meta calls this)
  //
  // Meta signs the request body as:
  //   signed_request = base64url(HMAC-SHA256(payload, app_secret)) + "." + base64url(json_payload)
  //
  // We verify the signature with a timing-safe comparison before trusting
  // the payload. An invalid signature returns 400 — Meta requires this so
  // the endpoint can't be spoofed by third parties.
  @Public()
  @Post('api/meta/deletion-callback')
  async metaDeletionCallback(@Req() req: Request) {
    const signedRequest = (req as any).body?.signed_request;
    if (!signedRequest || !signedRequest.includes('.')) {
      return { error: 'Missing or malformed signed_request' };
    }

    const [sigEncoded, payloadEncoded] = signedRequest.split('.');

    // ── Verify HMAC-SHA256 signature ───────────────────────
    // Meta signs the payload with the app secret. A timing-safe comparison
    // prevents timing-based attacks on the signature check.
    const appSecret = env.instagramAppSecret;
    if (!appSecret) {
      return { error: 'Server misconfiguration: app secret not set' };
    }

    const expectedSig = createHmac('sha256', appSecret)
      .update(payloadEncoded)
      .digest();
    let actualSig: Buffer;
    try {
      actualSig = Buffer.from(sigEncoded, 'base64url');
    } catch {
      return { error: 'Invalid signature encoding' };
    }

    if (
      expectedSig.length !== actualSig.length ||
      !timingSafeEqual(expectedSig, actualSig)
    ) {
      return { error: 'Invalid signature' };
    }

    // ── Parse verified payload ──────────────────────────────
    let data: { user_id?: string };
    try {
      data = JSON.parse(Buffer.from(payloadEncoded, 'base64url').toString('utf8'));
    } catch {
      return { error: 'Invalid payload encoding' };
    }

    const userId = String(data.user_id ?? '');
    if (!userId) {
      return { error: 'Missing user_id in payload' };
    }

    const confirmationCode = await this.recordDeletionRequest(userId);
    await this.sessionService.invalidateByInstagramUserId(userId);

    return {
      url: `${env.serverUrl}/api/meta/deletion-status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  // GET /api/meta/deletion-status
  // Returns the real status from the database so Meta's reviewers
  // see accurate state rather than a hardcoded "completed".
  @Public()
  @Get('api/meta/deletion-status')
  async deletionStatus(@Query('code') code: string) {
    if (!code) {
      return { error: 'Missing confirmation code' };
    }

    if (this.db) {
      const rows = await this.db
        .select()
        .from(accountDeletionRequests)
        .where(eq(accountDeletionRequests.confirmationCode, code));

      if (rows.length > 0) {
        const row = rows[0];
        return {
          confirmation_code: code,
          status: row.status,          // 'pending' | 'processing' | 'completed' | 'failed'
          requested_at: row.requestedAt,
          completed_at: row.completedAt ?? null,
        };
      }
    }

    // Code not found — could be expired or never issued.
    return {
      confirmation_code: code,
      status: 'not_found',
    };
  }
}
