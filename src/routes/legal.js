// ── Legal pages routes ───────────────────────────────────────
// Serves Privacy Policy and Terms of Service as HTML pages.
// Meta App Review requires publicly accessible URLs for these.

const { Router } = require('express');
const { renderPage } = require('../utils/html');

const router = Router();

// ── GET /privacy-policy ──────────────────────────────────────
router.get('/privacy-policy', (req, res) => {
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
      <li>Account insights and demographics (reach, engagement, follower demographics)</li>
    </ul>
    <p>We do <strong>NOT</strong> access your private messages, password, or non-public content.</p>

    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>Display your profile and analytics within the app</li>
      <li>Match you with relevant brand campaigns based on your niche and audience</li>
      <li>Provide AI-powered content suggestions tailored to your account</li>
      <li>Show brands your public profile when you apply to campaigns</li>
    </ul>
    <p>We never sell your personal data to third parties.</p>

    <h2>3. Data Storage &amp; Security</h2>
    <ul>
      <li>Your Instagram access token is stored securely on our server and never exposed to the client app</li>
      <li>Session identifiers are stored in encrypted device storage</li>
      <li>All communication uses HTTPS encryption</li>
      <li>We do not store your Instagram password</li>
    </ul>

    <h2>4. Data Sharing</h2>
    <p>We share limited data with:</p>
    <ul>
      <li><strong>Brands you apply to:</strong> your public username, follower count, and engagement metrics</li>
      <li><strong>Google Gemini AI:</strong> anonymized prompts for content generation (no personal data)</li>
    </ul>
    <p>We do not share your data with advertisers or data brokers.</p>

    <h2>5. Data Retention &amp; Deletion</h2>
    <ul>
      <li>You can disconnect your Instagram account at any time from the Profile screen</li>
      <li>Upon disconnection, we revoke the access token and delete your cached Instagram data</li>
      <li>You can request complete account deletion using the in-app deletion option or by emailing us</li>
      <li>We process deletion requests within 30 days as required by Meta Platform Terms</li>
    </ul>

    <h2>6. Your Rights</h2>
    <ul>
      <li>Access the data we hold about you</li>
      <li>Request correction of inaccurate data</li>
      <li>Request deletion of your data</li>
      <li>Withdraw consent and disconnect your account</li>
      <li>Export your data in a portable format</li>
    </ul>

    <h2>7. Third-Party Services</h2>
    <p>This app integrates with:</p>
    <ul>
      <li>Meta/Instagram API (OAuth authentication and data access)</li>
      <li>Google Gemini (AI content generation)</li>
      <li>Supabase (secure data storage)</li>
    </ul>

    <h2>8. Contact Us</h2>
    <p>For privacy-related questions or data deletion requests:</p>
    <p>Email: <a href="mailto:privacy@iginsights.app">privacy@iginsights.app</a></p>
  `);
  res.type('html').send(html);
});

// ── GET /terms-of-service ────────────────────────────────────
router.get('/terms-of-service', (req, res) => {
  const html = renderPage('Terms of Service', `
    <h1>Terms of Service</h1>
    <p><em>Last updated: May 2026</em></p>

    <h2>1. Acceptance of Terms</h2>
    <p>By using Instagram Insights ("the App"), you agree to these Terms of Service. If you do not agree, please do not use the App.</p>

    <h2>2. Description of Service</h2>
    <p>Instagram Insights is a platform connecting Instagram creators with brands for collaboration campaigns. The App provides:</p>
    <ul>
      <li>Instagram account analytics and insights</li>
      <li>Campaign marketplace for brand collaborations</li>
      <li>AI-powered content generation tools</li>
      <li>Profile management and discovery features</li>
    </ul>

    <h2>3. Account Requirements</h2>
    <ul>
      <li>You must have a valid Instagram Professional or Creator account</li>
      <li>You must be at least 18 years old to use this service</li>
      <li>You are responsible for maintaining the security of your account</li>
      <li>You must not share your session credentials with others</li>
    </ul>

    <h2>4. Instagram Data Usage</h2>
    <ul>
      <li>We access your Instagram data only through official Meta APIs</li>
      <li>We use your data solely for the purposes described in our Privacy Policy</li>
      <li>You can revoke access at any time by disconnecting your account</li>
      <li>We comply with Meta Platform Terms and Developer Policies</li>
    </ul>

    <h2>5. Campaign Participation</h2>
    <ul>
      <li>Creators apply to campaigns voluntarily</li>
      <li>Brands set their own campaign requirements and selection criteria</li>
      <li>We do not guarantee acceptance into any campaign</li>
      <li>Payment terms are between the brand and creator</li>
      <li>Content submissions must comply with Instagram Community Guidelines</li>
    </ul>

    <h2>6. AI Content Generation</h2>
    <ul>
      <li>AI-generated content is provided as suggestions only</li>
      <li>You are responsible for reviewing and editing AI content before posting</li>
      <li>We do not guarantee the accuracy or effectiveness of AI suggestions</li>
    </ul>

    <h2>7. Prohibited Conduct</h2>
    <ul>
      <li>Use the App for any illegal purpose</li>
      <li>Misrepresent your identity or follower metrics</li>
      <li>Scrape or collect data from other users</li>
      <li>Attempt to circumvent security measures</li>
      <li>Submit fraudulent campaign applications</li>
    </ul>

    <h2>8. Account Termination</h2>
    <ul>
      <li>You may delete your account at any time</li>
      <li>We may suspend accounts that violate these terms</li>
      <li>Upon termination, your data will be deleted per our Privacy Policy</li>
    </ul>

    <h2>9. Limitation of Liability</h2>
    <p>The App is provided "as is" without warranties. We are not liable for loss of data, revenue, Instagram API changes, or campaign disputes.</p>

    <h2>10. Contact</h2>
    <p>Email: <a href="mailto:legal@iginsights.app">legal@iginsights.app</a></p>
  `);
  res.type('html').send(html);
});

module.exports = router;
