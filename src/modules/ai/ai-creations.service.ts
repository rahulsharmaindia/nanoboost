// ── AI creations service ─────────────────────────────────────
// Persists AI-generated content (hooks, scripts, captions, ideas)
// that an influencer chooses to save (feature #11). Backed by the
// ai_creations table.

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE_CLIENT } from '../../database/database.module';
import { aiCreations } from '../../database/schema/studio.schema';
import { ValidationError, NotFoundError } from '../../common/errors/app.errors';

export type AiCreationKind = 'hook' | 'script' | 'caption' | 'idea';
const VALID_KINDS: AiCreationKind[] = ['hook', 'script', 'caption', 'idea'];

export interface SaveCreationInput {
  kind: string;
  title?: string;
  prompt?: string;
  content: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class AiCreationsService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly db: any) {
    if (!db) {
      throw new Error(
        'DATABASE_URL is not configured. AiCreationsService requires a database connection.',
      );
    }
  }

  async save(influencerId: string, input: SaveCreationInput) {
    if (!input.content || input.content.trim().length === 0) {
      throw new ValidationError('content is required');
    }
    const kind = (input.kind || '').toLowerCase();
    if (!VALID_KINDS.includes(kind as AiCreationKind)) {
      throw new ValidationError(`kind must be one of: ${VALID_KINDS.join(', ')}`);
    }

    const [row] = await this.db
      .insert(aiCreations)
      .values({
        influencerId,
        kind: kind as AiCreationKind,
        title: input.title ?? null,
        prompt: input.prompt ?? null,
        content: input.content,
        metadata: input.metadata ?? null,
      })
      .returning();
    return this.map(row);
  }

  async list(influencerId: string, kind?: string) {
    const conditions = [
      eq(aiCreations.influencerId, influencerId),
      eq(aiCreations.isArchived, false),
    ];
    if (kind && VALID_KINDS.includes(kind.toLowerCase() as AiCreationKind)) {
      conditions.push(eq(aiCreations.kind, kind.toLowerCase() as AiCreationKind));
    }
    const rows = await this.db
      .select()
      .from(aiCreations)
      .where(and(...conditions))
      .orderBy(desc(aiCreations.createdAt));
    return rows.map((r: any) => this.map(r));
  }

  async delete(influencerId: string, id: string): Promise<void> {
    const rows = await this.db
      .select({ id: aiCreations.id })
      .from(aiCreations)
      .where(and(eq(aiCreations.id, id), eq(aiCreations.influencerId, influencerId)));
    if (rows.length === 0) throw new NotFoundError('Saved content not found');
    await this.db.delete(aiCreations).where(eq(aiCreations.id, id));
  }

  private map(r: any) {
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      prompt: r.prompt,
      content: r.content,
      metadata: r.metadata ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    };
  }
}
