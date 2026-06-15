// ── NestJS entry point ───────────────────────────────────────
// Bootstraps the application. Keep this file thin.

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getCorsOptions } from './config/cors';
import { env } from './config/env';
import { getDrizzleClient } from './database/database.client';
import { probeDatabase } from './database/database.probe';

async function bootstrap() {
  if (!env.databaseUrl) {
    console.error(
      '❌ DATABASE_URL is not set. This server persists all data — including sessions — to Postgres and cannot run without it.',
    );
    process.exit(1);
  }

  // Log the configured DB host at boot — without credentials — so
  // deployment issues like "I changed the env var but the container
  // is still hitting the old host" are immediately diagnosable.
  try {
    const u = new URL(env.databaseUrl);
    console.log(
      `Database target: host="${u.hostname}" port="${u.port || '5432'}" db="${u.pathname.replace(/^\//, '')}"`,
    );
  } catch {
    console.warn('DATABASE_URL is not a parseable URL');
  }

  // Run the schema probe but never block the listener on it. A DNS
  // blip, a Supabase reboot, or a stale env value should not put the
  // container into an unrecoverable deploy loop. The /health endpoint
  // surfaces DB liveness so Railway's healthcheck can still gate
  // traffic correctly.
  probeDatabase(getDrizzleClient()).catch((err) => {
    console.error(
      'Database probe failed at boot — server will continue, /health will report unhealthy. ' +
        `Cause: ${(err as Error).message}`,
    );
  });

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    // Disable built-in body parser so our custom express.json with a
    // higher limit takes effect. Without this, NestJS registers a
    // default 100KB parser first and our 5MB middleware never fires
    // because the body is already consumed.
    bodyParser: false,
  });

  // Raise the JSON body limit to 10 MB so that brand logo images
  // (sent as base64 data URIs in the registration payload) are accepted
  // from all clients — web, Android, and iOS.
  app.use(require('express').json({ limit: '10mb' }));
  app.use(require('express').urlencoded({ extended: true, limit: '10mb' }));

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
