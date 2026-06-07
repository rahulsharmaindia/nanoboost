// ── Brands service ───────────────────────────────────────────
// Brand registration, login, and profile management. Brands are a
// first-class entity: registration writes `brands` +
// `brand_credentials`. Sessions are DB-backed via
// BrandSessionService.

import { Injectable, Inject } from '@nestjs/common';
import { createHash, scryptSync, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { BrandSessionService } from '../../common/services/brand-session.service';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { brands, brandCredentials } from '../../database/schema/brands.schema';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '../../common/errors/app.errors';

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
    private readonly brandSessionService: BrandSessionService,
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
      socialLinks: brand.socialLinks ?? null,
      businessId: brand.businessId,
    };
  }

  // ── Registration ───────────────────────────────────────────

  async register(dto: RegisterBrandDto): Promise<{ sessionId: string; brandData: BrandResponseData }> {
    const existing = await this.db
      .select()
      .from(brands)
      .where(eq(brands.businessId, dto.businessId));
    if (existing.length > 0) {
      throw new ConflictError('Business ID already taken');
    }

    const brandId = await this.db.transaction(async (tx: any) => {
      const [created] = await tx
        .insert(brands)
        .values({
          businessId: dto.businessId,
          name: dto.name,
          logo: dto.logo || null,
          industry: dto.industry,
          website: dto.website || null,
          description: dto.description || null,
          socialLinks: dto.socialLinks ?? null,
        })
        .returning({ brandId: brands.brandId });

      await tx.insert(brandCredentials).values({
        brandId: created.brandId,
        passwordHash: this.hashPassword(dto.password),
      });
      return created.brandId;
    });

    const sessionId = await this.brandSessionService.create(brandId);

    const [profile] = await this.db
      .select()
      .from(brands)
      .where(eq(brands.brandId, brandId));

    return { sessionId, brandData: this.toResponse(profile) };
  }

  // ── Login ──────────────────────────────────────────────────

  async login(dto: LoginBrandDto): Promise<{ sessionId: string; brandData: BrandResponseData }> {
    const profiles = await this.db
      .select()
      .from(brands)
      .where(eq(brands.businessId, dto.businessId));
    if (profiles.length === 0) {
      throw new UnauthorizedError('Invalid credentials');
    }
    const brand = profiles[0];

    const credentials = await this.db
      .select()
      .from(brandCredentials)
      .where(eq(brandCredentials.brandId, brand.brandId));
    if (credentials.length === 0) {
      throw new UnauthorizedError('Invalid credentials');
    }
    if (!this.verifyPassword(dto.password, credentials[0].passwordHash)) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const sessionId = await this.brandSessionService.create(brand.brandId);
    return { sessionId, brandData: this.toResponse(brand) };
  }

  // ── Profile (authenticated brand) ──────────────────────────

  async getProfile(brandId: string): Promise<BrandResponseData> {
    const rows = await this.db.select().from(brands).where(eq(brands.brandId, brandId));
    if (rows.length === 0) {
      throw new NotFoundError('No brand registered');
    }
    return this.toResponse(rows[0]);
  }

  // ── Public profile (for influencers) ───────────────────────

  async getPublicProfile(businessId: string): Promise<BrandResponseData> {
    const rows = await this.db.select().from(brands).where(eq(brands.businessId, businessId));
    if (rows.length === 0) {
      throw new NotFoundError('Brand not found');
    }
    return this.toResponse(rows[0]);
  }

  // ── Update profile ─────────────────────────────────────────

  async updateProfile(brandId: string, dto: UpdateBrandDto): Promise<BrandResponseData> {
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed.length === 0) throw new ConflictError('Brand name cannot be empty');
      update.name = trimmed;
    }
    if (dto.industry !== undefined) {
      const trimmed = dto.industry.trim();
      if (trimmed.length === 0) throw new ConflictError('Industry cannot be empty');
      update.industry = trimmed;
    }
    if (dto.logo !== undefined) {
      update.logo = dto.logo.trim().length > 0 ? dto.logo : null;
    }
    if (dto.website !== undefined) {
      update.website = dto.website.trim().length > 0 ? dto.website.trim() : null;
    }
    if (dto.description !== undefined) {
      update.description = dto.description.trim().length > 0 ? dto.description.trim() : null;
    }
    if (dto.socialLinks !== undefined) {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(dto.socialLinks ?? {})) {
        if (typeof v === 'string' && v.trim().length > 0) cleaned[k] = v.trim();
      }
      update.socialLinks = Object.keys(cleaned).length > 0 ? cleaned : null;
    }

    await this.db.update(brands).set(update).where(eq(brands.brandId, brandId));

    const [updated] = await this.db.select().from(brands).where(eq(brands.brandId, brandId));
    if (!updated) {
      throw new NotFoundError('No brand registered');
    }
    return this.toResponse(updated);
  }
}
