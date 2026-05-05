// ── Database seed script ─────────────────────────────────────
// Populates the database with sample data for development.
// Usage: npx tsx drizzle/seed.ts
//
// ⚠️  NEVER run this in production!

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL is not set.');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Cannot seed production database!');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
  });

  console.log('🌱 Seeding database...');

  try {
    // Create sample users
    const creatorUserId = randomUUID();
    const brandUserId = randomUUID();

    await pool.query(`
      INSERT INTO users (id, email, role) VALUES
        ('${creatorUserId}', 'creator@example.com', 'creator'),
        ('${brandUserId}', 'brand@example.com', 'brand')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Create creator profile
    await pool.query(`
      INSERT INTO creator_profiles (id, user_id, username, display_name, bio, follower_count, follows_count, media_count, niche)
      VALUES (
        '${randomUUID()}',
        '${creatorUserId}',
        'demo_creator',
        'Demo Creator',
        'Fashion & lifestyle content creator 🌟',
        15000,
        500,
        120,
        'Fashion'
      )
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Create brand profile
    const businessId = 'demo-brand';
    await pool.query(`
      INSERT INTO brand_profiles (id, user_id, business_id, name, industry, website, description)
      VALUES (
        '${randomUUID()}',
        '${brandUserId}',
        '${businessId}',
        'Demo Brand Co.',
        'Fashion',
        'https://demobrand.com',
        'A sample fashion brand for testing'
      )
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // Create sample campaigns
    const campaignId1 = randomUUID();
    const campaignId2 = randomUUID();

    await pool.query(`
      INSERT INTO campaigns (
        campaign_id, business_id, title, description, objective, campaign_type,
        age_group_min, age_group_max, gender, target_location,
        total_budget, budget_per_creator, payment_model,
        start_date, end_date, application_deadline, submission_deadline, content_deadline,
        minimum_followers, required_engagement_rate, preferred_niche, total_slots,
        deliverables, status
      ) VALUES
        (
          '${campaignId1}', '${businessId}',
          'Summer Fashion Collection Launch',
          'Promote our new summer collection with authentic lifestyle content',
          'Brand Awareness', 'Promotion',
          18, 35, 'All', 'United States',
          5000, 500, 'Fixed',
          '2026-06-01', '2026-07-31', '2026-05-25', '2026-07-15', '2026-07-10',
          5000, 3.5, 'Fashion', 10,
          '{"posts": 1, "reels": 2, "stories": 3}', 'Published'
        ),
        (
          '${campaignId2}', '${businessId}',
          'Fitness App Review Campaign',
          'Get honest reviews of our new fitness tracking app',
          'Product Promotion', 'Review',
          20, 40, 'All', 'Global',
          3000, 300, 'Commission',
          '2026-06-15', '2026-08-15', '2026-06-10', '2026-08-01', '2026-07-25',
          10000, 2.0, 'Fitness', 15,
          '{"posts": 0, "reels": 1, "stories": 2}', 'Published'
        )
      ON CONFLICT (campaign_id) DO NOTHING;
    `);

    // Create a sample application
    await pool.query(`
      INSERT INTO applications (application_id, campaign_id, influencer_id, username, follower_count, status)
      VALUES (
        '${randomUUID()}',
        '${campaignId1}',
        '${creatorUserId}',
        'demo_creator',
        15000,
        'Approved'
      )
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Seed data inserted successfully!');
    console.log('');
    console.log('Sample accounts:');
    console.log('  Creator: creator@example.com (user_id: ' + creatorUserId + ')');
    console.log('  Brand:   brand@example.com (business_id: demo-brand)');
    console.log('');
    console.log('Sample campaigns:');
    console.log('  1. Summer Fashion Collection Launch (Published)');
    console.log('  2. Fitness App Review Campaign (Published)');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
