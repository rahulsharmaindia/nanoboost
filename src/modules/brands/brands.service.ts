// ── Brands service ───────────────────────────────────────────
// Brand registration, login, and profile retrieval. All data is
// persisted to the database — credentials live in the
// brand_credentials table, profile data in brand_profiles.
//
// Sessions are DB-backed via SessionService.

import { Injectable, Inject } from '@nestjs/common';
import { createHash, scryptSync, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { SessionService } from '../../common/services/session.service';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { brandProfiles } from '../../database/schema/brands.schema';
import { brandCredentials } from '../../database/schema/brand-credentials.schema';
import { users } from '../../database/schema/users.schema';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '../../common/errors/app.errors';
import { randomUUID } from 'crypto';

interface BrandResponseData {
  name: string;
  logo: string | null;
  industry: string;
  website: string | null;
  description: string | null;
  socialLinks: any;
  businessId: string;
}

export type { BrandResponseData };

@Injectable()
export class BrandsService {
  constructor(
    private readonly sessionService: SessionService,
    @Inject(DRIZZLE_CLIENT) private readonly db: any,
  ) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. BrandsService requires a database connection.',
      );
    }
  }

  // ── Password hashing ───────────────────────────────────────

  private hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    // Legacy SHA-256 format (no colon separator)
    if (!stored.includes(':')) {
      return createHash('sha256').update(password).digest('hex') === stored;
    }
    const [salt, hash] = stored.split(':');
    return scryptSync(password, salt, 64).toString('hex') === hash;
  }

  private toResponse(brand: any): BrandResponseData {
    return {
      name: brand.name,
      logo: brand.logo,
      industry: brand.industry,
      website: brand.website,
      description: brand.description,
      socialLinks: brand.socialLinks ? JSON.parse(brand.socialLinks) : null,
      businessId: brand.businessId,
    };
  }

  // ── Registration ───────────────────────────────────────────

  async register(dto: RegisterBrandDto): Promise<{ sessionId: string; brandData: BrandResponseData }> {
    // Uniqueness check
    const existing = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.businessId, dto.businessId));
    if (existing.length > 0) {
      throw new ConflictError('Business ID already taken');
    }

    const userId = `brand_${dto.businessId}_${randomUUID()}`;
    const email = `${dto.businessId}@brand.local`;

    // Persist user → brand profile → credentials in sequence.
    // No transaction helper on the current Drizzle client setup — each
    // failure leaves a recoverable state that the uniqueness check catches
    // on retry.
    await this.db.insert(users).values({
      id: userId,
      email,
      role: 'brand',
    });

    await this.db.insert(brandProfiles).values({
      userId,
      businessId: dto.businessId,
      name: dto.name,
      logo: dto.logo || null,
      industry: dto.industry,
      website: dto.website || null,
      description: dto.description || null,
      socialLinks: dto.socialLinks ? JSON.stringify(dto.socialLinks) : null,
    });

    await this.db.insert(brandCredentials).values({
      businessId: dto.businessId,
      passwordHash: this.hashPassword(dto.password),
    });

    const sessionId = await this.sessionService.create({
      businessId: dto.businessId,
      status: 'authenticated',
    });

    const [profile] = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.businessId, dto.businessId));

    return { sessionId, brandData: this.toResponse(profile) };
  }

  // ── Login ──────────────────────────────────────────────────

  async login(dto: LoginBrandDto): Promise<{ sessionId: string; brandData: BrandResponseData }> {
    const profiles = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.businessId, dto.businessId));

    if (profiles.length === 0) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const credentials = await this.db
      .select()
      .from(brandCredentials)
      .where(eq(brandCredentials.businessId, dto.businessId));

    if (credentials.length === 0) {
      throw new UnauthorizedError('Invalid credentials');
    }

    if (!this.verifyPassword(dto.password, credentials[0].passwordHash)) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const sessionId = await this.sessionService.create({
      businessId: dto.businessId,
      status: 'authenticated',
    });

    return { sessionId, brandData: this.toResponse(profiles[0]) };
  }

  // ── Profile ────────────────────────────────────────────────

  async getProfile(sessionId: string): Promise<BrandResponseData> {
    const session = await this.sessionService.get(sessionId);
    if (!session || !session.businessId) {
      throw new NotFoundError('No brand registered');
    }

    const rows = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.businessId, session.businessId));

    if (rows.length === 0) {
      throw new NotFoundError('No brand registered');
    }

    return this.toResponse(rows[0]);
  }

  // ── Public profile (for influencers) ─────────────────────────

  async getPublicProfile(businessId: string): Promise<BrandResponseData> {
    const rows = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.businessId, businessId));

    if (rows.length === 0) {
      throw new NotFoundError('Brand not found');
    }

    return this.toResponse(rows[0]);
  }

  // ── Update profile ─────────────────────────────────────────
  //
  // Partial update of the authenticated brand's own profile.
  // businessId and password cannot be changed here — they need
  // dedicated flows. Empty strings on optional fields are normalised
  // to null so callers can clear a previously-set value.
  async updateProfile(
    sessionId: string,
    dto: UpdateBrandDto,
  ): Promise<BrandResponseData> {
    const session = await this.sessionService.get(sessionId);
    if (!session || !session.businessId) {
      throw new NotFoundError('No brand registered');
    }

    const update: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed.length === 0) {
        throw new ConflictError('Brand name cannot be empty');
      }
      update.name = trimmed;
    }
    if (dto.industry !== undefined) {
      const trimmed = dto.industry.trim();
      if (trimmed.length === 0) {
        throw new ConflictError('Industry cannot be empty');
      }
      update.industry = trimmed;
    }
    if (dto.logo !== undefined) {
      update.logo = dto.logo.trim().length > 0 ? dto.logo : null;
    }
    if (dto.website !== undefined) {
      update.website = dto.website.trim().length > 0 ? dto.website.trim() : null;
    }
    if (dto.description !== undefined) {
      update.description =
        dto.description.trim().length > 0 ? dto.description.trim() : null;
    }
    if (dto.socialLinks !== undefined) {
      // Strip empty values so the stored JSON only contains real links.
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(dto.socialLinks ?? {})) {
        if (typeof v === 'string' && v.trim().length > 0) {
          cleaned[k] = v.trim();
        }
      }
      update.socialLinks =
        Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
    }

    await this.db
      .update(brandProfiles)
      .set(update)
      .where(eq(brandProfiles.businessId, session.businessId));

    const [updated] = await this.db
      .select()
      .from(brandProfiles)
      .where(eq(brandProfiles.businessId, session.businessId));

    if (!updated) {
      throw new NotFoundError('No brand registered');
    }

    return this.toResponse(updated);
  }
}
