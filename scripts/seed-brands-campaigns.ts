// ── Seed: brands + campaigns ─────────────────────────────────
// Inserts a handful of realistic brands (each able to log in with
// the password below) and a few published campaigns per brand.
//
// Idempotent: brands are matched by `business_id` and campaigns by
// (brand_id, title), so re-running won't create duplicates.
//
// Password hashing mirrors BrandsService.hashPassword exactly:
//   scrypt(password, salt, 64) → `${salt}:${hash}`  (salt = 16 random bytes hex)
//
// Usage (from nanoboost/):
//   npx tsx scripts/seed-brands-campaigns.ts
//
// Requires DATABASE_URL in the environment (.env is loaded).

import 'dotenv/config';
import { randomBytes, scryptSync } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/database/schema';
import { brands, brandCredentials } from '../src/database/schema/brands.schema';
import { campaigns } from '../src/database/schema/campaigns.schema';

// Shared login password for every seeded brand.
const BRAND_PASSWORD = '12345678';

/** Mirror of BrandsService.hashPassword — scrypt with a random salt. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** ISO date (YYYY-MM-DD) `days` from today. */
function dateFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

type SeedCampaign = Omit<
  typeof campaigns.$inferInsert,
  'campaignId' | 'brandId' | 'createdAt' | 'updatedAt'
>;

/**
 * Content fields are stored as JSON-encoded text (matching
 * CampaignsRepository.createCampaign): arrays for post types / hashtags /
 * mentions / interests, and a {reels, stories, posts} object for
 * deliverables. The server's mapper JSON.parses these columns.
 */
interface CampaignContent {
  postTypes: string[];
  deliverables: { reels: number; stories: number; posts: number };
  hashtags: string[];
  mentions: string[];
  interests: string[];
}

interface SeedBrand {
  businessId: string;
  name: string;
  industry: string;
  website: string;
  description: string;
  socialLinks: Record<string, string>;
  campaigns: SeedCampaign[];
}

// Reusable defaults so each campaign only declares what makes it distinct.
function campaign(
  overrides: Partial<SeedCampaign> & Partial<CampaignContent> & {
    title: string;
    description: string;
    objective: string;
    campaignType: string;
    preferredNiche: string;
    targetLocation: string;
  },
): SeedCampaign {
  const {
    postTypes = ['Reel', 'Story'],
    deliverables = { reels: 1, stories: 2, posts: 0 },
    hashtags = [],
    mentions = [],
    interests = [],
    ...rest
  } = overrides;

  return {
    platform: 'Instagram',
    contentCountPerInfluencer: 3,
    ageGroupMin: 18,
    ageGroupMax: 35,
    gender: 'All',
    paymentModel: 'Fixed',
    totalBudget: '200000',
    budgetPerCreator: '20000',
    startDate: dateFromNow(7),
    endDate: dateFromNow(45),
    applicationDeadline: dateFromNow(5),
    submissionDeadline: dateFromNow(30),
    contentDeadline: dateFromNow(35),
    minimumFollowers: 5000,
    requiredEngagementRate: '2.5',
    totalSlots: 10,
    reserveSlots: 2,
    revisionAllowedCount: 1,
    status: 'Published',
    // JSON-encoded content columns (parsed by the server mapper).
    postTypes: JSON.stringify(postTypes),
    deliverables: JSON.stringify(deliverables),
    hashtags: JSON.stringify(hashtags),
    mentions: JSON.stringify(mentions),
    interests: JSON.stringify(interests),
    ...rest,
  };
}

const SEED_BRANDS: SeedBrand[] = [
  {
    businessId: 'urbanthreads',
    name: 'Urban Threads',
    industry: 'Fashion',
    website: 'https://urbanthreads.example.com',
    description:
      'Streetwear and everyday essentials for the modern urban wardrobe.',
    socialLinks: { instagram: 'https://instagram.com/urbanthreads' },
    campaigns: [
      campaign({
        title: 'Spring Streetwear Drop',
        description:
          'Showcase our new spring streetwear collection in authentic, day-in-the-life Reels.',
        objective: 'Brand Awareness',
        campaignType: 'Product Launch',
        preferredNiche: 'Fashion',
        targetLocation: 'Mumbai, Delhi, Bangalore',
        interests: ['Streetwear', 'Sneakers', 'Urban Fashion'],
        hashtags: ['#UrbanThreads', '#SpringDrop'],
        handleToTag: '@urbanthreads',
        budgetPerCreator: '25000',
        minimumFollowers: 10000,
      }),
      campaign({
        title: 'Everyday Essentials Lookbook',
        description:
          'Style our core basics into 3 distinct everyday looks for your audience.',
        objective: 'Engagement',
        campaignType: 'Content Collaboration',
        preferredNiche: 'Lifestyle',
        targetLocation: 'India',
        postTypes: ['Reel', 'Carousel'],
        totalSlots: 15,
      }),
    ],
  },
  {
    businessId: 'fitfuel',
    name: 'FitFuel Nutrition',
    industry: 'Health & Fitness',
    website: 'https://fitfuel.example.com',
    description:
      'Plant-based protein and clean nutrition for everyday athletes.',
    socialLinks: { instagram: 'https://instagram.com/fitfuel' },
    campaigns: [
      campaign({
        title: '30-Day Protein Challenge',
        description:
          'Document your 30-day journey using FitFuel protein in daily workout Reels.',
        objective: 'Conversions',
        campaignType: 'Ambassador',
        preferredNiche: 'Fitness',
        targetLocation: 'India',
        interests: ['Gym', 'Nutrition', 'Wellness'],
        hashtags: ['#FitFuel', '#ProteinChallenge'],
        paymentModel: 'Fixed + Commission',
        commissionRate: '10',
        budgetPerCreator: '30000',
        minimumFollowers: 15000,
        requiredEngagementRate: '3.0',
      }),
    ],
  },
  {
    businessId: 'gadgethub',
    name: 'GadgetHub',
    industry: 'Technology',
    website: 'https://gadgethub.example.com',
    description: 'Honest reviews and deals on the latest consumer tech.',
    socialLinks: { instagram: 'https://instagram.com/gadgethub' },
    campaigns: [
      campaign({
        title: 'Wireless Earbuds Review',
        description:
          'Create an honest first-impressions Reel for our new noise-cancelling earbuds.',
        objective: 'Brand Awareness',
        campaignType: 'Product Review',
        preferredNiche: 'Tech',
        targetLocation: 'India, US',
        interests: ['Gadgets', 'Audio', 'Reviews'],
        hashtags: ['#GadgetHub', '#SoundUnleashed'],
        budgetPerCreator: '35000',
        minimumFollowers: 20000,
      }),
    ],
  },
  {
    businessId: 'glowbeauty',
    name: 'Glow Beauty Co.',
    industry: 'Beauty',
    website: 'https://glowbeauty.example.com',
    description: 'Clean, cruelty-free skincare for a natural everyday glow.',
    socialLinks: { instagram: 'https://instagram.com/glowbeauty' },
    campaigns: [
      campaign({
        title: 'Morning Glow Routine',
        description:
          'Feature our vitamin-C serum in your morning skincare routine Reel.',
        objective: 'Engagement',
        campaignType: 'Content Collaboration',
        preferredNiche: 'Beauty',
        targetLocation: 'India',
        interests: ['Skincare', 'Beauty', 'Self-care'],
        hashtags: ['#GlowBeauty', '#MorningGlow'],
        gender: 'Female',
        budgetPerCreator: '22000',
      }),
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool, { schema });

  let brandsCreated = 0;
  let brandsSkipped = 0;
  let campaignsCreated = 0;
  let campaignsUpdated = 0;

  try {
    for (const seed of SEED_BRANDS) {
      // ── Brand (idempotent on business_id) ──────────────────
      const existing = await db
        .select()
        .from(brands)
        .where(eq(brands.businessId, seed.businessId));

      let brandId: string;
      if (existing.length > 0) {
        brandId = existing[0].brandId;
        brandsSkipped++;
        console.log(`• brand "${seed.businessId}" exists — reusing`);
      } else {
        brandId = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(brands)
            .values({
              businessId: seed.businessId,
              name: seed.name,
              industry: seed.industry,
              website: seed.website,
              description: seed.description,
              socialLinks: seed.socialLinks,
            })
            .returning({ brandId: brands.brandId });

          await tx.insert(brandCredentials).values({
            brandId: created.brandId,
            passwordHash: hashPassword(BRAND_PASSWORD),
          });
          return created.brandId;
        });
        brandsCreated++;
        console.log(`✓ created brand "${seed.businessId}" (${seed.name})`);
      }

      // ── Campaigns (idempotent on brand_id + title) ─────────
      for (const c of seed.campaigns) {
        const dupe = await db
          .select({ id: campaigns.campaignId })
          .from(campaigns)
          .where(and(eq(campaigns.brandId, brandId), eq(campaigns.title, c.title)));

        if (dupe.length > 0) {
          // Heal any previously-seeded row whose content columns may hold
          // non-JSON strings (which break the server's JSON.parse mapper).
          await db
            .update(campaigns)
            .set({ ...c, brandId, updatedAt: new Date() })
            .where(eq(campaigns.campaignId, dupe[0].id));
          campaignsUpdated++;
          console.log(`  ↻ campaign "${c.title}" updated`);
          continue;
        }

        await db.insert(campaigns).values({ ...c, brandId });
        campaignsCreated++;
        console.log(`  ✓ campaign "${c.title}" [${c.status}]`);
      }
    }

    console.log('\n── Seed complete ──');
    console.log(`brands:    ${brandsCreated} created, ${brandsSkipped} skipped`);
    console.log(`campaigns: ${campaignsCreated} created, ${campaignsUpdated} updated`);
    console.log(`\nBrand login password (all brands): ${BRAND_PASSWORD}`);
    console.log('Business IDs:', SEED_BRANDS.map((b) => b.businessId).join(', '));
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
