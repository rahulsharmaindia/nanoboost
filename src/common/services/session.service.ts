// ── In-memory session store ──────────────────────────────────
// Holds OAuth state during the Instagram login flow.
// Sessions expire after TTL and are cleaned up periodically.
// This is intentionally simple — it is the OAuth handshake store,
// not the primary auth mechanism (Supabase Auth handles that).

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { env } from '../../config/env';

export interface Session {
  accessToken: string | null;
  userId: string | null;
  businessId: string | null;
  hashedPassword: string | null;
  brandData: Record<string, any> | null;
  status: 'pending' | 'authenticated' | 'error';
  createdAt: number;
}

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), env.sessionCleanupIntervalMs);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }

  create(): string {
    const id = randomUUID();
    this.sessions.set(id, {
      accessToken: null,
      userId: null,
      businessId: null,
      hashedPassword: null,
      brandData: null,
      status: 'pending',
      createdAt: Date.now(),
    });
    return id;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  findBy(predicate: (session: Session) => boolean): { id: string; session: Session } | null {
    for (const [id, session] of this.sessions) {
      if (predicate(session)) return { id, session };
    }
    return null;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > env.sessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
