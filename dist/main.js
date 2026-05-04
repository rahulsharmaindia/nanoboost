"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const helmet_1 = __importDefault(require("helmet"));
const app_module_1 = require("./app.module");
const cors_1 = require("./config/cors");
const env_1 = require("./config/env");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        logger: ['log', 'warn', 'error'],
    });
    app.use((0, helmet_1.default)());
    app.enableCors((0, cors_1.getCorsOptions)());
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
    }));
    const port = env_1.env.port;
    await app.listen(port, '0.0.0.0');
    console.log(`Server running on port ${port}`);
    console.log(`Redirect URI: ${env_1.env.redirectUri || '(not set)'}`);
    console.log(`App ID loaded: ${env_1.env.instagramAppId ? 'yes' : '❌ MISSING'}`);
    console.log(`App Secret loaded: ${env_1.env.instagramAppSecret ? 'yes' : '❌ MISSING'}`);
    console.log(`Gemini API key loaded: ${env_1.env.geminiApiKey ? 'yes' : '⚠️  NOT SET (AI features disabled)'}`);
    console.log(`Database URL loaded: ${env_1.env.databaseUrl ? 'yes' : '⚠️  NOT SET (in-memory mode)'}`);
}
bootstrap().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map