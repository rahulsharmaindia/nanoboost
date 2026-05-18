// ── End-to-end database verification ─────────────────────────
// Exercises every persistence path the server uses. Writes rows,
// reads them back, checks invariants, then cleans up. Run against
// the same DATABASE_URL the app uses.
//
// Usage:  npx tsx scripts/verify-stack.ts

import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq } from 'drizzle-orm';

import * as schema from '../src/database/schema';
import { sessions } from '../src/database/schema/sessions.schema';
import { brandProfiles } from '../src/database/schema/brands.schema';
import { brandCredentials } from '../src/database/schema/brand-credentials.schema';
import { users } from '../src/database/schema/users.schema';
import { campaigns } from '../src/database/schema/campaigns.schema';
import { applications } from '../src/database/schema/proposals.schema';
import { submissions } from '../src/database/schema/collaborations.schema';
import { SessionService } from '../src/common/services/session.service';
import { TokenCipher } from '../src/common/services/token-cipher.service';
import { CampaignsRepository } from '../src/modules/campaigns/campaigns.repository';

type Color = 'green' | 'red' | 'yellow' | 'dim';
const paint = (c: Color, s: string) => {
  const codes: Record<Color, string> = {
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    dim: '\x1b[2m',
  };
  return `${codes[c]}${s}\x1b[0m`;
};

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  process.stdout.write(`  • ${name.padEnd(60)} `);
  try {
    await fn();
    console.log(paint('green', '✓'));
    passed++;
  } catch (err) {
    console.log(paint('red', '✗'));
    console.log(paint('red', `    ${(err as Error).message}`));
    failed++;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool, { schema });

  // Synthetic IDs — suffixed with a UUID so repeated runs don't collide.
  const runId = randomUUID().slice(0, 8);
  const businessId = `verify_${runId}`;
  const userId = `verify_user_${runId}`;
  const creatorUserId = `verify_creator_${runId}`;
  const creatorSessionId = null as string | null;

  const cleanup = async () => {
    // Wipe anything we created regardless of test outcome.
    await db.delete(sessions).where(eq(sessions.businessId, businessId));
    await db.delete(brandCredentials).where(eq(brandCredentials.businessId, businessId));
    await db.delete(campaigns).where(eq(campaigns.businessId, businessId));
    await db.delete(brandProfiles).where(eq(brandProfiles.businessId, businessId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, creatorUserId));
  };

  try {
    console.log(paint('dim', `\nConnection: ${url.replace(/:[^@]+@/, ':***@')}`));
    console.log(paint('dim', `Run ID: ${runId}\n`));

    // ── SessionService ───────────────────────────────────────
    console.log(paint('yellow', 'SessionService'));

    const cipher = new TokenCipher();
    cipher.onModuleInit();
    const sessionService = new SessionService(db, cipher);
    let creatorSessId = '';
    let brandSessId = '';

    await check('create pending creator session', async () => {
      creatorSessId = await sessionService.create({ status: 'pending' });
      assert(creatorSessId, 'no sessionId returned');
    });

    await check('get pending session', async () => {
      const s = await sessionService.get(creatorSessId);
      assert(s, 'session not found');
      assert(s.status === 'pending', `expected pending, got ${s.status}`);
      assert(s.accessToken === null, 'accessToken should be null');
    });

    await check('update session with access token', async () => {
      await sessionService.update(creatorSessId, {
        accessToken: 'fake_token_' + runId,
        providerUserId: 'ig_' + runId,
        status: 'authenticated',
      });
      const s = await sessionService.get(creatorSessId);
      assert(s, 'session vanished');
      assert(s.status === 'authenticated', `status=${s.status}`);
      assert(s.accessToken === 'fake_token_' + runId, 'token not persisted');
      assert(s.providerUserId === 'ig_' + runId, 'providerUserId not persisted');
    });

    await check('findCreatorAccessToken', async () => {
      const token = await sessionService.findCreatorAccessToken('ig_' + runId);
      assert(token === 'fake_token_' + runId, `got: ${token}`);
    });

    await check('create brand session', async () => {
      brandSessId = await sessionService.create({
        businessId,
        status: 'authenticated',
      });
      const s = await sessionService.get(brandSessId);
      assert(s, 'brand session missing');
      assert(s.businessId === businessId, 'businessId not persisted');
    });

    await check('invalidateByProviderUserId sets status=error', async () => {
      await sessionService.invalidateByProviderUserId('ig_' + runId);
      const s = await sessionService.get(creatorSessId);
      assert(s, 'session vanished');
      assert(s.status === 'error', `expected error, got ${s.status}`);
      assert(s.accessToken === null, 'accessToken should be cleared');
    });

    await check('remove session', async () => {
      await sessionService.remove(creatorSessId);
      const s = await sessionService.get(creatorSessId);
      assert(s === null, 'session should be gone');
    });

    // ── Brand + credentials ──────────────────────────────────
    console.log(paint('yellow', '\nBrands + credentials'));

    await check('insert user + brand_profile + brand_credentials', async () => {
      await db.insert(users).values({
        id: userId,
        email: `${runId}@verify.local`,
        role: 'brand',
      });
      await db.insert(brandProfiles).values({
        userId,
        businessId,
        name: 'Verify Brand',
        industry: 'Test',
      });
      await db.insert(brandCredentials).values({
        businessId,
        passwordHash: 'salt:hash',
      });

      const rows = await db
        .select()
        .from(brandProfiles)
        .where(eq(brandProfiles.businessId, businessId));
      assert(rows.length === 1, `expected 1 brand row, got ${rows.length}`);
    });

    await check('brand_credentials FK cascade to brand_profiles', async () => {
      const creds = await db
        .select()
        .from(brandCredentials)
        .where(eq(brandCredentials.businessId, businessId));
      assert(creds.length === 1, 'credential row missing');
      assert(creds[0].passwordHash === 'salt:hash', 'hash not persisted');
    });

    // ── CampaignsRepository ──────────────────────────────────
    console.log(paint('yellow', '\nCampaignsRepository'));

    const campaignsRepo = new CampaignsRepository(db);
    const creatorId = 'ig_creator_' + runId;
    let campaignId = '';
    let applicationId = '';
    let submissionId = '';

    const campaignData = {
      title: `Verify ${runId}`,
      description: 'Verification campaign',
      objective: 'Brand Awareness',
      campaignType: 'Promotion',
      ageGroupMin: 18,
      ageGroupMax: 35,
      gender: 'All',
      targetLocation: 'Test',
      totalBudget: 1000,
      budgetPerCreator: 100,
      paymentModel: 'Fixed',
      startDate: '2030-01-10',
      endDate: '2030-01-20',
      applicationDeadline: '2030-01-05',
      submissionDeadline: '2030-01-18',
      contentDeadline: '2030-01-15',
      minimumFollowers: 1000,
      requiredEngagementRate: 2.5,
      preferredNiche: 'Fashion',
      totalSlots: 5,
      status: 'Published',
    };

    await check('createCampaign', async () => {
      const c = await campaignsRepo.createCampaign(businessId, campaignData);
      campaignId = c.campaignId;
      assert(c.title === campaignData.title, 'title mismatch');
      assert(c.businessId === businessId, 'businessId mismatch');
      assert(Number(c.totalBudget) === 1000, 'budget mismatch');
    });

    await check('getCampaign round-trip', async () => {
      const c = await campaignsRepo.getCampaign(campaignId);
      assert(c, 'campaign not found');
      assert(c.campaignId === campaignId, 'id mismatch');
    });

    await check('listByBusiness returns our row', async () => {
      const list = await campaignsRepo.listByBusiness(businessId);
      assert(list.length >= 1, `expected >=1, got ${list.length}`);
      assert(list.some((c) => c.campaignId === campaignId), 'missing');
    });

    await check('listPublished returns our row', async () => {
      const list = await campaignsRepo.listPublished();
      assert(list.some((c) => c.campaignId === campaignId), 'not in published');
    });

    await check('getBrandNames resolves businessId → name', async () => {
      const map = await campaignsRepo.getBrandNames([businessId]);
      assert(map[businessId] === 'Verify Brand', `got: ${map[businessId]}`);
    });

    await check('createApplication', async () => {
      const app = await campaignsRepo.createApplication(campaignId, creatorId, {
        username: 'verifyuser',
        followerCount: 2500,
      });
      applicationId = app.applicationId;
      assert(app.status === 'Pending', `status=${app.status}`);
    });

    await check('findApplication by (campaignId, influencerId)', async () => {
      const a = await campaignsRepo.findApplication(campaignId, creatorId);
      assert(a, 'application not found');
      assert(a.applicationId === applicationId, 'id mismatch');
    });

    await check('updateApplication status → Approved', async () => {
      const a = await campaignsRepo.updateApplication(applicationId, {
        status: 'Approved',
      });
      assert(a, 'update returned null');
      assert(a.status === 'Approved', `status=${a.status}`);
    });

    await check('createSubmission', async () => {
      const s = await campaignsRepo.createSubmission(campaignId, creatorId, {
        contentUrl: 'https://example.com/post',
        contentCaption: 'Test caption',
      });
      submissionId = s.submissionId;
      assert(s.status === 'Pending_Review', `status=${s.status}`);
    });

    await check('updateSubmission status → Approved', async () => {
      const s = await campaignsRepo.updateSubmission(submissionId, {
        status: 'Approved',
      });
      assert(s, 'update returned null');
      assert(s.status === 'Approved', `status=${s.status}`);
    });

    await check('updateCampaign status → Active', async () => {
      const c = await campaignsRepo.updateCampaign(campaignId, {
        status: 'Active',
      });
      assert(c, 'update returned null');
      assert(c.status === 'Active', `status=${c.status}`);
    });

    // ── Cascade behavior ────────────────────────────────────
    console.log(paint('yellow', '\nCascade behavior'));

    await check('deleting campaign cascades applications + submissions', async () => {
      await db.delete(campaigns).where(eq(campaigns.campaignId, campaignId));

      const apps = await db
        .select()
        .from(applications)
        .where(eq(applications.campaignId, campaignId));
      assert(apps.length === 0, `expected cascade, found ${apps.length} apps`);

      const subs = await db
        .select()
        .from(submissions)
        .where(eq(submissions.campaignId, campaignId));
      assert(subs.length === 0, `expected cascade, found ${subs.length} subs`);
    });

    await check('deleting brand_profile cascades brand_credentials', async () => {
      await db
        .delete(brandProfiles)
        .where(eq(brandProfiles.businessId, businessId));

      const creds = await db
        .select()
        .from(brandCredentials)
        .where(eq(brandCredentials.businessId, businessId));
      assert(creds.length === 0, `expected cascade, found ${creds.length}`);
    });

    await check('deleting user cascades brand_profile (already gone — no-op)', async () => {
      await db.delete(users).where(eq(users.id, userId));
      const rows = await db.select().from(users).where(eq(users.id, userId));
      assert(rows.length === 0, 'user should be gone');
    });

    // ── Brand sessions ──────────────────────────────────────
    await check('cleanup brand session', async () => {
      await sessionService.remove(brandSessId);
      const s = await sessionService.get(brandSessId);
      assert(s === null, 'brand session should be gone');
    });
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(paint('red', `\nFatal: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
