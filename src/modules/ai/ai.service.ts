// ── AI service ───────────────────────────────────────────────
// Proxies content generation requests to Google Gemini.
// Never logs the API key.

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../../config/env';
import { SYSTEM_PROMPTS } from './ai.prompts';
import { GenerateContentDto } from './ai.types';
import { ValidationError, ProviderError } from '../../common/errors/app.errors';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

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

  async generate(dto: GenerateContentDto): Promise<{ result: string }> {
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
