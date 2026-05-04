// ── Public route decorator ───────────────────────────────────
// Mark a route as public (no auth required) by adding this decorator.
// The auth guard checks for this metadata before verifying tokens.

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
