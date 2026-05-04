"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var AiService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiService = void 0;
const common_1 = require("@nestjs/common");
const env_1 = require("../../config/env");
const ai_prompts_1 = require("./ai.prompts");
const app_errors_1 = require("../../common/errors/app.errors");
let AiService = AiService_1 = class AiService {
    constructor() {
        this.logger = new common_1.Logger(AiService_1.name);
    }
    buildUserContext(dto) {
        const lines = [];
        if (dto.niche)
            lines.push(`Niche: ${dto.niche}`);
        if (dto.topic)
            lines.push(`Topic/Idea: ${dto.topic}`);
        if (dto.tone)
            lines.push(`Tone: ${dto.tone}`);
        if (dto.platform_goal)
            lines.push(`Goal: ${dto.platform_goal}`);
        if (dto.format)
            lines.push(`Preferred format: ${dto.format}`);
        if (dto.audience)
            lines.push(`Target audience: ${dto.audience}`);
        return lines.join('\n');
    }
    async generate(dto) {
        if (!dto.type) {
            throw new app_errors_1.ValidationError('type is required');
        }
        if (!dto.topic && !dto.prompt) {
            throw new app_errors_1.ValidationError('topic (or prompt) is required');
        }
        if (!env_1.env.geminiApiKey) {
            throw new app_errors_1.ProviderError('AI service not configured');
        }
        const systemPrompt = ai_prompts_1.SYSTEM_PROMPTS[dto.type];
        if (!systemPrompt) {
            const validTypes = Object.keys(ai_prompts_1.SYSTEM_PROMPTS).join(', ');
            throw new app_errors_1.ValidationError(`Invalid type. Valid types: ${validTypes}`);
        }
        const userMessage = dto.topic
            ? this.buildUserContext(dto)
            : `User request: ${dto.prompt}`;
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${env_1.env.geminiModel}:generateContent?key=${env_1.env.geminiApiKey}`;
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
            throw new app_errors_1.ProviderError(errMsg);
        }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return { result: text };
    }
};
exports.AiService = AiService;
exports.AiService = AiService = AiService_1 = __decorate([
    (0, common_1.Injectable)()
], AiService);
//# sourceMappingURL=ai.service.js.map