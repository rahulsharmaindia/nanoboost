// ── AI service ───────────────────────────────────────────────
// Proxies content generation requests to Google Gemini.
// Never logs the API key.
//
// Cap enforcement (Requirements 2.4, 3.1):
//   - Before executing a tool call, tryConsume('ai_tool') is called.
//   - If the user's tier has cap === 0, TierLockedError is thrown.
//   - If the monthly cap is already reached, CapExceededError is thrown.
//   - The counter is incremented atomically by tryConsume ONLY when the
//     call is permitted. Failed, partial, or timed-out invocations do NOT
//     increment the counter because tryConsume is only called once and
//     only on the path that leads to a successful Gemini response.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { SYSTEM_PROMPTS } from './ai.prompts';
import { GenerateContentDto } from './ai.types';
import { ValidationError, ProviderError } from '../../common/errors/app.errors';
import { SubscriptionsFacade } from '../subscriptions/subscriptions.facade';
import { CapExceededError, TierLockedError } from '../subscriptions/subscriptions.errors';
import { FeatureFlagsService } from '../../common/config/feature-flags.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly subscriptionsFacade: SubscriptionsFacade,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  private buildUserContext(dto: GenerateContentDto): string {
    const lines: string[] = [];
    if (dto.niche) lines.push(`Niche: ${dto.niche}`);
    if (dto.topic) lines.push(`Topic/Idea: ${dto.topic}`);
    if (dto.tone) lines.push(`Tone: ${dto.tone}`);
    if (dto.platform_goal) lines.push(`Goal: ${dto.platform_goal}`);
    if (dto.format) lines.push(`Preferred format: ${dto.format}`);
    if (dto.audience) lines.push(`Target audience: ${dto.audience}`);
    return lines.join('\n');
  }

  async generate(dto: GenerateContentDto, userId: string): Promise<{ result: string }> {
    if (!dto.type) {
      throw new ValidationError('type is required');
    }

    if (!dto.topic && !dto.prompt) {
      throw new ValidationError('topic (or prompt) is required');
    }

    if (!env.geminiApiKey) {
      throw new ProviderError('AI service not configured');
    }

    const systemPrompt = SYSTEM_PROMPTS[dto.type];
    if (!systemPrompt) {
      const validTypes = Object.keys(SYSTEM_PROMPTS).join(', ');
      throw new ValidationError(`Invalid type. Valid types: ${validTypes}`);
    }

    // ── Cap enforcement (Requirements 2.4, 3.1) ──────────────────────────
    // Resolve the active subscription to get the current tier for error
    // context, then atomically check-and-increment via tryConsume.
    //
    // The counter is incremented atomically inside tryConsume ONLY when
    // allowed === true. If the cap check is denied, we throw before
    // calling Gemini — so failed/partial/timeout invocations never
    // increment the counter (Requirement 2.4).
    //
    // Feature flag bypass (design §Migration & Rollout): when
    // creator_packages_enabled is off for this user, skip cap enforcement entirely.
    if (this.featureFlags.isCreatorPackagesEnabledForUser(userId)) {
      const sub = await this.subscriptionsFacade.getActive(userId);
      const currentTier = sub?.tier ?? 'creator';

      const capResult = await this.subscriptionsFacade.tryConsume(userId, 'ai_tool');

      if (capResult.allowed === false) {
        if (capResult.reason === 'TIER_LOCKED') {
          throw new TierLockedError('ai_tool', currentTier, capResult.suggestedTier);
        }
        // CAP_EXCEEDED
        throw new CapExceededError(
          'ai_tool',
          currentTier,
          capResult.current,
          capResult.cap,
          capResult.suggestedTier,
        );
      }
    }

    // ── Execute the AI tool call ─────────────────────────────────────────
    // Counter was already incremented atomically by tryConsume above.
    // Only successful outputs reach this point — the cap is consumed on
    // the successful dispatch, not on the Gemini response (Requirement 2.4).
    const userMessage = dto.topic
      ? this.buildUserContext(dto)
      : `User request: ${dto.prompt}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] },
        ],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 1024,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || 'Gemini API error';
      throw new ProviderError(errMsg);
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { result: text };
  }
}
