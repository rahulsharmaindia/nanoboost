import { GenerateContentDto } from './ai.types';
export declare class AiService {
    private readonly logger;
    private buildUserContext;
    generate(dto: GenerateContentDto): Promise<{
        result: string;
    }>;
}
