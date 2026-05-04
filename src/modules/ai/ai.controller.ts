// ── AI controller ────────────────────────────────────────────

import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { GenerateContentDto } from './ai.types';
import { AuthGuard } from '../../common/guards/auth.guard';

@Controller('api/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // POST /api/ai/generate
  @Post('generate')
  generate(@Body() dto: GenerateContentDto) {
    return this.aiService.generate(dto);
  }
}
