import { AiService } from './ai.service';
import { GenerateContentDto } from './ai.types';
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    generate(dto: GenerateContentDto): Promise<{
        result: string;
    }>;
}
