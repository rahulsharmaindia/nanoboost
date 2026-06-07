import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiCreationsService } from './ai-creations.service';

@Module({
  controllers: [AiController],
  providers: [AiService, AiCreationsService],
  exports: [AiService, AiCreationsService],
})
export class AiModule {}
