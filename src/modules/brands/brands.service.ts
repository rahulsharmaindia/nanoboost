// ── Brands service ───────────────────────────────────────────
// Handles brand registration, login, and profile retrieval.
// Persists brand data to the database when DATABASE_URL is set.
// Falls back to in-memory sessions when no database is configured.

import { Injectable, Inject, Optional } from '@nestjs/common';
import { createHash, scryptSync, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { SessionService } from '../../common/services/session.service';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { brandProfiles } from '../../database/schema/brands.schema';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '../../common/errors/app.errors';

@Injectable()
export class BrandsService {
  private readonly useDb: boolean;

  constructor(
    private readonly sessionService: SessionService,
    @Inject(DRIZZLE_CLIENT) @Optional() private readonly db: any,
  ) {
    this.useDb = !!db;
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

  // ── Registration ───────────────────────────────────────────

  async register(dto: RegisterBrandDto): Promise<{ sessionId: string; brandData: Record<string, any> }> {
    const hashedPassword = this.hashPassword(dto.password);

    const brandData = {
      name: dto.name,
      logo: dto.logo,
      industry: dto.industry,
      website: dto.website || null,
      description: dto.description || null,
      socialLinks: dto.socialLinks ? JSON.stringify(dto.socialLinks) : null,
      registeredAt: new Date().toISOString(),
    };

    if (this.useDb) {
      // Check uniqueness in DB
      const existing = await this.db.select().from(brandProfiles)
        .where(eq(brandProfiles.businessId, dto.businessId));
      if (existing.length > 0) {
        throw new ConflictError('Business ID already taken');
      }

      // Persist to DB — store password hash in description field temporarily
      // In production, add a separate credentials table
      await this.db.insert(brandProfiles).values({
        userId: `brand_${dto.businessId}`, // synthetic userId until Supabase Auth is wired
        businessId: dto.businessId,
        name: dto.name,
        logo: dto.logo || null,
        industry: dto.industry,
        website: dto.website || null,
        description: dto.description || null,
        socialLinks: dto.socialLinks ? JSON.stringify(dto.socialLinks) : null,
      });
    } else {
      // In-memory fallback
      const existing = this.sessionService.findBy((s) => s.businessId === dto.businessId);
      if (existing) throw new ConflictError('Business ID already taken');
    }

    // Always create a session (sessions are always in-memory)
    const sessionId = this.sessionService.create();
    const session = this.sessionService.get(sessionId)!;
    session.accessToken = null;
    session.userId = null;
    session.status = 'authenticated';
    session.businessId = dto.businessId;
    session.hashedPassword = hashedPassword;
    session.brandData = brandData;

    return { sessionId, brandData };
  }

  // ── Login ──────────────────────────────────────────────────

  async login(dto: LoginBrandDto): Promise<{ sessionId: string; brandData: Record<string, any> }> {
    if (this.useDb) {
      // Look up brand in DB
      const rows = await this.db.select().from(brandProfiles)
        .where(eq(brandProfiles.businessId, dto.businessId));

      if (rows.length === 0) {
        // Fall back to in-memory (for brands registered before DB was set up)
        return this.loginFromMemory(dto);
      }

      const brand = rows[0];

      // Check if we have a hashed password in the session store
      const memSession = this.sessionService.findBy((s) => s.businessId === dto.businessId);
      if (memSession) {
        if (!this.verifyPassword(dto.password, memSession.session.hashedPassword!)) {
          throw new UnauthorizedError('Invalid credentials');
        }
      } else {
        // No in-memory session — we can't verify password without a credentials table
        // For now, accept any login for DB-registered brands (temporary until auth table added)
        // TODO: add brand_credentials table with hashed passwords
      }

      const brandData = {
        name: brand.name,
        logo: brand.logo,
        industry: brand.industry,
        website: brand.website,
        description: brand.description,
        socialLinks: brand.socialLinks ? JSON.parse(brand.socialLinks) : null,
        businessId: brand.businessId,
      };

      const sessionId = this.sessionService.create();
      const session = this.sessionService.get(sessionId)!;
      session.accessToken = null;
      session.userId = null;
      session.status = 'authenticated';
      session.businessId = dto.businessId;
      session.hashedPassword = memSession?.session.hashedPassword ?? '';
      session.brandData = brandData;

      return { sessionId, brandData };
    }

    return this.loginFromMemory(dto);
  }

  private loginFromMemory(dto: LoginBrandDto): { sessionId: string; brandData: Record<string, any> } {
    const found = this.sessionService.findBy((s) => s.businessId === dto.businessId);
    if (!found) throw new UnauthorizedError('Invalid credentials');

    if (!this.verifyPassword(dto.password, found.session.hashedPassword!)) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const sessionId = this.sessionService.create();
    const session = this.sessionService.get(sessionId)!;
    session.accessToken = null;
    session.userId = null;
    session.status = 'authenticated';
    session.businessId = found.session.businessId;
    session.hashedPassword = found.session.hashedPassword;
    session.brandData = found.session.brandData;

    return { sessionId, brandData: session.brandData! };
  }

  // ── Profile ────────────────────────────────────────────────

  async getProfile(sessionId: string): Promise<Record<string, any>> {
    const session = this.sessionService.get(sessionId);
    if (!session || !session.businessId) {
      throw new NotFoundError('No brand registered');
    }

    // Try DB first for fresh data
    if (this.useDb) {
      const rows = await this.db.select().from(brandProfiles)
        .where(eq(brandProfiles.businessId, session.businessId));
      if (rows.length > 0) {
        const brand = rows[0];
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
    }

    if (!session.brandData) throw new NotFoundError('No brand registered');
    return session.brandData;
  }
}
