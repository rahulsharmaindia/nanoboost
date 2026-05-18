// ── Legal pages controller ───────────────────────────────────
// Serves Privacy Policy and Terms of Service as HTML.
// Meta App Review requires publicly accessible URLs for these.

import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';

function renderPage(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} - Instagram Insights</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #1A1035, #6C3CE1); min-height: 100vh; margin: 0; padding: 20px; color: #333; }
    .card { background: #fff; border-radius: 16px; padding: 40px; max-width: 720px; margin: 0 auto; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
    h1 { color: #1A1035; margin-bottom: 8px; font-size: 28px; }
    h2 { color: #6C3CE1; margin-top: 28px; margin-bottom: 12px; font-size: 18px; }
    p { color: #555; font-size: 15px; line-height: 1.6; }
    ul { color: #555; font-size: 15px; line-height: 1.8; padding-left: 20px; }
    li { margin-bottom: 4px; }
    a { color: #6C3CE1; }
    em { color: #888; }
    strong { color: #333; }
  </style>
</head>
<body><div class="card">${content}</div></body>
</html>`;
}

@Controller()
export class LegalController {
  @Public()
  @Get('privacy-policy')
  privacyPolicy(@Res() res: Response) {
    const html = renderPage('Privacy Policy', `
      <h1>Privacy Policy</h1>
      <p><em>Last updated: May 2026</em></p>
      <h2>1. Information We Collect</h2>
      <p>When you connect your Instagram account, we access the following data through the official Meta/Instagram API:</p>
      <ul>
        <li>Your Instagram username, display name, and profile picture</li>
        <li>Your follower count, following count, and media count</li>
        <li>Your account biography</li>
        <li>Your public media (posts, reels, stories)</li>
        <li>Account insights and demographics</li>
      </ul>
      <p>We do <strong>NOT</strong> access your private messages, password, or non-public content.</p>
      <h2>2. How We Use Your Information</h2>
      <ul>
        <li>Display your profile and analytics within the app</li>
        <li>Match you with relevant brand campaigns</li>
        <li>Provide AI-powered content suggestions</li>
        <li>Show brands your public profile when you apply to campaigns</li>
      </ul>
      <p>We never sell your personal data to third parties.</p>
      <h2>3. Data Storage &amp; Security</h2>
      <ul>
        <li>Access tokens stored securely on our server, never exposed to client</li>
        <li>All communication uses HTTPS encryption</li>
        <li>We do not store your Instagram password</li>
      </ul>
      <h2>4. Data Sharing</h2>
      <ul>
        <li><strong>Brands you apply to:</strong> public username, follower count, engagement metrics</li>
        <li><strong>Google Gemini AI:</strong> anonymized prompts (no personal data)</li>
      </ul>
      <h2>5. Data Retention &amp; Deletion</h2>
      <ul>
        <li>Disconnect your Instagram account at any time from the Profile screen</li>
        <li>Request complete account deletion via the in-app option or email</li>
        <li>Deletion processed within 30 days per Meta Platform Terms</li>
      </ul>
      <h2>6. Contact</h2>
      <p>Email: <a href="mailto:privacy@iginsights.app">privacy@iginsights.app</a></p>
    `);
    res.type('html').send(html);
  }

  @Public()
  @Get('terms-of-service')
  termsOfService(@Res() res: Response) {
    const html = renderPage('Terms of Service', `
      <h1>Terms of Service</h1>
      <p><em>Last updated: May 2026</em></p>
      <h2>1. Acceptance of Terms</h2>
      <p>By using Instagram Insights, you agree to these Terms of Service.</p>
      <h2>2. Description of Service</h2>
      <p>A platform connecting Instagram creators with brands for collaboration campaigns, providing analytics, campaign marketplace, and AI content tools.</p>
      <h2>3. Account Requirements</h2>
      <ul>
        <li>Valid Instagram Professional or Creator account required</li>
        <li>Must be at least 18 years old</li>
        <li>Responsible for maintaining account security</li>
      </ul>
      <h2>4. Instagram Data Usage</h2>
      <ul>
        <li>Data accessed only through official Meta APIs</li>
        <li>You can revoke access at any time</li>
        <li>We comply with Meta Platform Terms</li>
      </ul>
      <h2>5. Campaign Participation</h2>
      <ul>
        <li>Creators apply voluntarily</li>
        <li>We do not guarantee acceptance</li>
        <li>Payment terms are between brand and creator</li>
      </ul>
      <h2>6. Prohibited Conduct</h2>
      <ul>
        <li>Illegal use, identity misrepresentation, data scraping, security circumvention</li>
      </ul>
      <h2>7. Limitation of Liability</h2>
      <p>The App is provided "as is" without warranties.</p>
      <h2>8. Contact</h2>
      <p>Email: <a href="mailto:legal@iginsights.app">legal@iginsights.app</a></p>
    `);
    res.type('html').send(html);
  }
}
