import { Injectable } from '@nestjs/common';
import { Request } from 'express';

export type Locale = 'IN' | 'US';

@Injectable()
export class LocaleResolver {
  /**
   * Resolves the locale for a request.
   * Priority: account country → IP country → 'IN' (default)
   *
   * Requirement 18.1: locale determines which priced row is returned
   */
  resolve(req: Request, accountCountry?: string): Locale {
    // 1. Account country (from user profile)
    if (accountCountry) {
      return this.countryToLocale(accountCountry);
    }

    // 2. IP country (from Cloudflare or similar CDN headers)
    const cfCountry = req.headers['cf-ipcountry'] as string;
    if (cfCountry) {
      return this.countryToLocale(cfCountry);
    }

    // 3. X-Country-Code header (for testing/proxies)
    const xCountry = req.headers['x-country-code'] as string;
    if (xCountry) {
      return this.countryToLocale(xCountry);
    }

    // 4. Default to IN
    return 'IN';
  }

  private countryToLocale(country: string): Locale {
    return country.toUpperCase() === 'IN' ? 'IN' : 'US';
  }
}
