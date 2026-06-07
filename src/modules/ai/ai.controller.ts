// ── AI controller ────────────────────────────────────────────

import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AiService } from './ai.service';
import { AiCreationsService, SaveCreationInput } from './ai-creations.service';
import { GenerateContentDto } from './ai.types';
import { AuthGuard } from '../../common/guards/auth.guard';

@Controller('api/ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly aiCreationsService: AiCreationsService,
  ) {}

  // POST /api/ai/generate
  @Post('generate')
  generate(@Body() dto: GenerateContentDto) {
    return this.aiService.generate(dto);
  }

  // ── Saved AI content (feature #11) ─────────────────────────

  // POST /api/ai/creations
  @Post('creations')
  save(@Req() req: Request, @Body() body: SaveCreationInput) {
    return this.aiCreationsService.save((req as any).influencerId, body);
  }

  // GET /api/ai/creations?kind=hook
  @Get('creations')
  list(@Req() req: Request, @Query('kind') kind?: string) {
    return this.aiCreationsService.list((req as any).influencerId, kind);
  }

  // DELETE /api/ai/creations/:id
  @Delete('creations/:id')
  async remove(@Req() req: Request, @Param('id') id: string) {
    await this.aiCreationsService.delete((req as any).influencerId, id);
    return { status: 'deleted' };
  }
}
