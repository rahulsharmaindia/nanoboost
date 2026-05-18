// ── CORS configuration ───────────────────────────────────────
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { env } from './env';

export function getCorsOptions(): CorsOptions {
  const origins = env.corsOrigins === '*'
    ? '*'
    : env.corsOrigins.split(',').map(o => o.trim());

  return {
    origin: origins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: origins !== '*',
  };
}
