// ── Token cipher service ─────────────────────────────────────
// AES-256-GCM encryption wrapper for Instagram access tokens at
// rest. Tokens are long-lived (60 days) and valuable, so storing
// them in plaintext would be a serious risk if the database is
// ever exfiltrated.
//
// Ciphertext format (base64-url-encoded):
//   enc:v1:<12 byte iv>:<16 byte auth tag>:<ciphertext>
//
// The "enc:v1:" prefix lets us distinguish encrypted values from
// legacy plaintext tokens during rollout — any value not starting
// with the prefix is assumed plaintext and returned as-is. After
// the legacy fallback window we can drop that branch.

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../../config/env';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = 'enc:v1:';

@Injectable()
export class TokenCipher implements OnModuleInit {
  private readonly logger = new Logger(TokenCipher.name);
  private key: Buffer | null = null;

  onModuleInit() {
    const raw = env.tokenEncryptionKey;
    if (!raw) {
      if (env.nodeEnv === 'production') {
        throw new Error(
          'TOKEN_ENCRYPTION_KEY is required in production. Generate one with: ' +
            'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
        );
      }
      this.logger.warn(
        'TOKEN_ENCRYPTION_KEY not set — storing Instagram tokens in plaintext. ' +
          'This is acceptable for local development only.',
      );
      return;
    }

    // Accept hex or base64. Must decode to exactly 32 bytes.
    let keyBuf: Buffer | null = null;
    if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
      keyBuf = Buffer.from(raw, 'hex');
    } else {
      try {
        const b = Buffer.from(raw, 'base64');
        if (b.length === 32) keyBuf = b;
      } catch {
        // fall through
      }
    }

    if (!keyBuf || keyBuf.length !== 32) {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes ' +
          '(64 hex chars or 44 base64 chars).',
      );
    }

    this.key = keyBuf;
    this.logger.log('Token encryption enabled (AES-256-GCM)');
  }

  /**
   * Encrypt a plaintext token. Returns the encoded ciphertext, or
   * the plaintext unchanged if no key is configured (dev fallback).
   */
  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext == null) return null;
    if (!this.key) return plaintext;

    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return (
      PREFIX +
      iv.toString('base64url') +
      ':' +
      tag.toString('base64url') +
      ':' +
      ct.toString('base64url')
    );
  }

  /**
   * Decrypt a value produced by `encrypt`. Values without the
   * "enc:v1:" prefix are treated as legacy plaintext and returned
   * unchanged, so pre-rollout tokens keep working.
   */
  decrypt(value: string | null | undefined): string | null {
    if (value == null) return null;
    if (!value.startsWith(PREFIX)) {
      // Legacy plaintext or unrecognised format — return as-is.
      return value;
    }
    if (!this.key) {
      // We have a ciphertext but no key. This is a fatal config error.
      throw new Error(
        'Stored token is encrypted but TOKEN_ENCRYPTION_KEY is not configured.',
      );
    }
    const body = value.slice(PREFIX.length);
    const [ivPart, tagPart, ctPart] = body.split(':');
    if (!ivPart || !tagPart || !ctPart) {
      throw new Error('Malformed encrypted token');
    }
    const iv = Buffer.from(ivPart, 'base64url');
    const tag = Buffer.from(tagPart, 'base64url');
    const ct = Buffer.from(ctPart, 'base64url');
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
      throw new Error('Malformed encrypted token');
    }
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }
}
