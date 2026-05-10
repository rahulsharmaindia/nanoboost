// ── NestJS entry point ───────────────────────────────────────
// Bootstraps the application. Keep this file thin.

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getCorsOptions } from './config/cors';
import { env } from './config/env';

async function bootstrap() {
  if (!env.databaseUrl) {
    console.error(
      '❌ DATABASE_URL is not set. This server persists all data — including sessions — to Postgres and cannot run without it.',
    );
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Security headers
  app.use(helmet());

  // CORS
  app.enableCors(getCorsOptions());

  // Global validation pipe — validates class-validator DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  const port = env.port;
  await app.listen(port, '0.0.0.0');

  console.log(`Server running on port ${port}`);
  console.log(`Redirect URI: ${env.redirectUri || '(not set)'}`);
  console.log(`App ID loaded: ${env.instagramAppId ? 'yes' : '❌ MISSING'}`);
  console.log(`App Secret loaded: ${env.instagramAppSecret ? 'yes' : '❌ MISSING'}`);
  console.log(`Gemini API key loaded: ${env.geminiApiKey ? 'yes' : '⚠️  NOT SET (AI features disabled)'}`);
  console.log(`Database URL loaded: yes`);
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
