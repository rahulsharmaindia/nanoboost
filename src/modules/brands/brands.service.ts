// ── Brands service ───────────────────────────────────────────
// Handles brand registration, login, and profile retrieval.
// Passwords are hashed with SHA-256 (upgrade to bcrypt when adding
// a proper user database — this matches the existing behavior).

import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { SessionService } from '../../common/services/session.service';
import { RegisterBrandDto } from './dto/register-brand.dto';
import { LoginBrandDto } from './dto/login-brand.dto';
import {
  ConflictError,
  UnauthorizedError,
  NotFoundError,
} from '../../common/errors/app.errors';

@Injectable()
export class BrandsService {
  constructor(private readonly sessionService: SessionService) {}

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }

  register(dto: RegisterBrandDto): { sessionId: string; brandData: Record<string, any> } {
    // Check businessId uniqueness
    const existing = this.sessionService.findBy((s) => s.businessId === dto.businessId);
    if (existing) {
      throw new ConflictError('Business ID already taken');
    }

    const hashedPassword = this.hashPassword(dto.password);
    const sessionId = this.sessionService.create();
    const session = this.sessionService.get(sessionId)!;

    session.accessToken = null;
    session.userId = null;
    session.status = 'authenticated';
    session.businessId = dto.businessId;
    session.hashedPassword = hashedPassword;
    session.brandData = {
      name: dto.name,
      logo: dto.logo,
      industry: dto.industry,
      website: dto.website || null,
      description: dto.description || null,
      socialLinks: dto.socialLinks || null,
      registeredAt: new Date().toISOString(),
    };

    return { sessionId, brandData: session.brandData };
  }

  login(dto: LoginBrandDto): { sessionId: string; brandData: Record<string, any> } {
    const found = this.sessionService.findBy((s) => s.businessId === dto.businessId);
    if (!found) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const hashedPassword = this.hashPassword(dto.password);
    if (found.session.hashedPassword !== hashedPassword) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // Create a new session with the same brand data
    const sessionId = this.sessionService.create();
    const session = this.sessionService.get(sessionId)!;

    session.accessToken = null;
    session.userId = null;
    session.status = 'authenticated';
    session.businessId = found.session.businessId;
    session.hashedPassword = found.session.hashedPassword;
    session.brandData = found.session.brandData;

    return { sessionId, brandData: session.brandData };
  }

  getProfile(sessionId: string): Record<string, any> {
    const session = this.sessionService.get(sessionId);
    if (!session || !session.brandData) {
      throw new NotFoundError('No brand registered');
    }
    return session.brandData;
  }
}
