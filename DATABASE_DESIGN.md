# Database Design — Production Schema

## Overview

The database uses **Supabase Postgres** with **Drizzle ORM** for type-safe queries and migrations. The schema supports two user roles (creators and brands) with a campaign collaboration workflow.

---

## Entity Relationship Diagram

```
┌──────────────┐
│    users     │ ← Supabase Auth (id = auth.uid())
│──────────────│
│ id (PK)      │
│ email        │
│ role         │
│ created_at   │
│ updated_at   │
└──────┬───────┘
       │ 1:1
       ├────────────────────────────────────┐
       │                                    │
       ▼                                    ▼
┌──────────────────┐              ┌──────────────────┐
│ creator_profiles │              │  brand_profiles  │
│──────────────────│              │──────────────────│
│ id (PK)          │              │ id (PK)          │
│ user_id (FK→users)│             │ user_id (FK→users)│
│ username         │              │ business_id (UQ) │
│ display_name     │              │ name             │
│ bio              │              │ logo             │
│ profile_picture  │              │ industry         │
│ follower_count   │              │ website          │
│ follows_count    │              │ description      │
│ media_count      │              │ social_links     │
│ niche            │              └────────┬─────────┘
└──────┬───────────┘                       │
       │                                   │ 1:N
       │                                   ▼
       │                          ┌──────────────────┐
       │                          │    campaigns     │
       │                          │──────────────────│
       │                          │ campaign_id (PK) │
       │                          │ business_id (FK) │
       │                          │ title, desc, ... │
       │                          │ status           │
       │                          │ budget, slots    │
       │                          │ deadlines        │
       │                          └────────┬─────────┘
       │                                   │
       │                          ┌────────┴─────────┐
       │                          │                  │
       │                          ▼                  ▼
       │                 ┌────────────────┐  ┌────────────────┐
       │                 │  applications  │  │  submissions   │
       │                 │────────────────│  │────────────────│
       │                 │ application_id │  │ submission_id  │
       └────────────────►│ campaign_id(FK)│  │ campaign_id(FK)│
         applies to      │ influencer_id  │  │ influencer_id  │
                         │ username       │  │ influencer_user│
                         │ follower_count │  │ content_url    │
                         │ status         │  │ status         │
                         └────────────────┘  └────────────────┘

┌──────────────────────┐          ┌──────────────────────────┐
│   social_accounts    │          │ account_deletion_requests│
│──────────────────────│          │──────────────────────────│
│ id (PK)              │          │ id (PK)                  │
│ user_id (FK→users)   │          │ user_id                  │
│ provider             │          │ confirmation_code (UQ)   │
│ provider_user_id     │          │ status                   │
│ access_token ⚠️      │          │ requested_at             │
│ username             │          │ completed_at             │
│ is_connected         │          └──────────────────────────┘
│ connected_at         │
│ disconnected_at      │
└──────────────────────┘
```

---

## Tables

### `users`
Core identity table linked to Supabase Auth. Minimal — role-specific data lives in profile tables.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | Supabase Auth user ID |
| email | text | NOT NULL, UNIQUE | |
| role | user_role | NOT NULL | creator, brand, admin |
| created_at | timestamp | NOT NULL, DEFAULT now() | |
| updated_at | timestamp | NOT NULL, DEFAULT now() | |

### `creator_profiles`
Extended data for influencer/creator users. Synced from Instagram API.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUID |
| user_id | text | FK→users, UNIQUE | One profile per user |
| username | text | | Instagram @handle |
| display_name | text | | |
| bio | text | | |
| profile_picture_url | text | | |
| follower_count | integer | DEFAULT 0 | Cached from Instagram |
| follows_count | integer | DEFAULT 0 | |
| media_count | integer | DEFAULT 0 | |
| niche | text | | Self-declared or inferred |
| created_at | timestamp | NOT NULL | |
| updated_at | timestamp | NOT NULL | |

### `brand_profiles`
Extended data for brand/business users.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUID |
| user_id | text | FK→users, UNIQUE | |
| business_id | text | NOT NULL, UNIQUE | Human-readable handle |
| name | text | NOT NULL | Brand display name |
| logo | text | | URL or base64 data URI |
| industry | text | NOT NULL | |
| website | text | | |
| description | text | | |
| social_links | text | | JSON string |
| created_at | timestamp | NOT NULL | |
| updated_at | timestamp | NOT NULL | |

### `campaigns`
Brand campaigns. The largest table — stores all wizard fields.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| campaign_id | text | PK | UUID |
| business_id | text | NOT NULL, FK→brand_profiles | |
| title | text | NOT NULL | |
| description | text | NOT NULL | |
| objective | text | NOT NULL | Brand Awareness, Product Promotion, etc. |
| campaign_type | text | NOT NULL | Promotion, UGC, Review, Giveaway |
| platform | text | DEFAULT 'Instagram' | |
| post_types | text | | JSON array: ["Reel", "Story", ...] |
| deliverables | text | | JSON: {posts: N, reels: N, stories: N} |
| content_count_per_influencer | integer | | |
| caption_guidelines | text | | |
| hashtags | text | | JSON array |
| mentions | text | | JSON array |
| handle_to_tag | text | | |
| reference_images | text | | JSON array of URLs |
| age_group_min | integer | NOT NULL | 13-65 |
| age_group_max | integer | NOT NULL | 13-65 |
| gender | text | NOT NULL | Male, Female, All |
| target_location | text | NOT NULL | |
| interests | text | | JSON array |
| language_preference | text | | |
| total_budget | numeric | NOT NULL | |
| budget_per_creator | numeric | NOT NULL | |
| payment_model | text | NOT NULL | Fixed, Commission, Barter |
| commission_rate | numeric | | For Commission model |
| product_details | text | | For Barter model |
| bonus_criteria | text | | |
| performance_incentive | text | | |
| start_date | text | NOT NULL | ISO date string |
| end_date | text | NOT NULL | |
| application_deadline | text | NOT NULL | Must be before start_date |
| submission_deadline | text | NOT NULL | |
| content_deadline | text | NOT NULL | |
| revision_allowed_count | integer | DEFAULT 0 | |
| review_turnaround_hours | integer | | |
| posting_time_window | text | | |
| minimum_followers | integer | NOT NULL | |
| required_engagement_rate | numeric | NOT NULL | 0-100 |
| preferred_niche | text | NOT NULL | |
| content_style_expectations | text | | |
| audience_gender_ratio | text | | |
| total_slots | integer | NOT NULL | ≥ 1 |
| reserve_slots | integer | | |
| priority_invite_list | text | | JSON array of usernames |
| guidelines_dos | text | | |
| guidelines_donts | text | | |
| brand_messaging | text | | |
| approval_process_description | text | | |
| require_approval | text | | |
| auto_approve_after_hours | integer | | |
| status | campaign_status | NOT NULL, DEFAULT 'Draft' | |
| created_at | timestamp | NOT NULL | |
| updated_at | timestamp | NOT NULL | |

**Status Lifecycle:** Draft → Published → Active → Completed → Archived (or Cancelled at any point)

### `applications`
Creator applications to campaigns.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| application_id | text | PK | UUID |
| campaign_id | text | NOT NULL, FK→campaigns | CASCADE delete |
| influencer_id | text | NOT NULL | Instagram user ID |
| username | text | NOT NULL, DEFAULT 'unknown' | Denormalized |
| follower_count | integer | NOT NULL, DEFAULT 0 | Snapshot at apply time |
| status | application_status | NOT NULL, DEFAULT 'Pending' | |
| created_at | timestamp | NOT NULL | |

**Unique constraint:** (campaign_id, influencer_id) — one application per creator per campaign.

### `submissions`
Content submissions from approved creators.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| submission_id | text | PK | UUID |
| campaign_id | text | NOT NULL, FK→campaigns | CASCADE delete |
| influencer_id | text | NOT NULL | |
| influencer_username | text | | Denormalized for display |
| content_url | text | | Link to the posted content |
| content_caption | text | | |
| notes_to_brand | text | | Creator's notes |
| revision_notes | text | | Brand's revision feedback |
| status | submission_status | NOT NULL, DEFAULT 'Pending_Review' | |
| created_at | timestamp | NOT NULL | |

### `social_accounts`
Connected Instagram accounts. **Tokens are sensitive — never expose to client.**

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUID |
| user_id | text | NOT NULL, FK→users | CASCADE delete |
| provider | text | NOT NULL, DEFAULT 'instagram' | |
| provider_user_id | text | NOT NULL | Instagram user_id |
| access_token | text | NOT NULL | ⚠️ Long-lived token (60 days) |
| username | text | | |
| is_connected | boolean | NOT NULL, DEFAULT true | |
| connected_at | timestamp | NOT NULL | |
| disconnected_at | timestamp | | Set when disconnected |

### `account_deletion_requests`
Tracks data deletion requests (Meta Platform Terms compliance).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | UUID |
| user_id | text | NOT NULL | |
| confirmation_code | text | NOT NULL, UNIQUE | Returned to user & Meta |
| status | deletion_status | NOT NULL, DEFAULT 'pending' | |
| requested_at | timestamp | NOT NULL | |
| completed_at | timestamp | | Set when deletion finishes |

---

## Enums

| Enum | Values |
|------|--------|
| user_role | creator, brand, admin |
| campaign_status | Draft, Published, Active, Completed, Cancelled, Archived |
| application_status | Pending, Approved, Rejected, Withdrawn |
| submission_status | Pending_Review, Approved, Revision_Requested, Published |
| deletion_status | pending, processing, completed, failed |

---

## Indexes

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| campaigns | business_id | B-tree | Filter by brand |
| campaigns | status | B-tree | Marketplace queries |
| campaigns | application_deadline | B-tree | Active deadline filtering |
| campaigns | preferred_niche | B-tree | Niche-based search |
| applications | campaign_id | B-tree | List apps per campaign |
| applications | influencer_id | B-tree | List apps per creator |
| applications | (campaign_id, influencer_id) | Unique | Prevent duplicates |
| applications | status | B-tree | Filter by status |
| submissions | campaign_id | B-tree | List subs per campaign |
| submissions | influencer_id | B-tree | List subs per creator |
| submissions | status | B-tree | Filter by status |
| social_accounts | user_id | B-tree | Lookup by user |
| social_accounts | provider_user_id | B-tree | Lookup by IG user ID |
| creator_profiles | username | B-tree | Search by handle |
| creator_profiles | niche | B-tree | Niche-based discovery |

---

## Row Level Security (RLS)

All tables have RLS enabled. The server uses `SUPABASE_SERVICE_ROLE_KEY` which bypasses RLS. Policies exist for potential direct client access:

- **Users:** Can only read/update own row
- **Creator/Brand Profiles:** Owner-only access
- **Campaigns:** Brands manage own; creators can read Published/Active
- **Applications:** Creators see own; brands see for their campaigns
- **Submissions:** Same as applications
- **Social Accounts:** Owner-only (tokens are sensitive)
- **Deletion Requests:** Owner-only

---

## Migration Commands

```bash
# Generate migration files from schema changes
npm run db:generate

# Apply migrations to the database
npm run db:migrate

# Push schema directly (dev only — never production)
npm run db:push

# Open Drizzle Studio (visual DB browser)
npm run db:studio

# Run the custom migration script
npx tsx drizzle/migrate.ts
```

---

## Design Decisions

1. **Text PKs (UUIDs)** — Compatible with Supabase Auth IDs. No auto-increment conflicts across distributed systems.

2. **Denormalized fields** (username in applications, influencer_username in submissions) — Avoids JOINs for common read paths. Acceptable trade-off since these values rarely change.

3. **JSON-as-text columns** (deliverables, hashtags, interests, etc.) — Simpler than JSONB for this use case. The app reads/writes these as complete objects, never queries inside them.

4. **Separate profile tables** — Keeps the users table clean. Role-specific data doesn't pollute the core identity table.

5. **Soft-delete for social accounts** — `is_connected` + `disconnected_at` instead of hard delete. Preserves audit trail for Meta compliance.

6. **Campaign FK to brand_profiles.business_id** — Uses the human-readable business_id rather than the internal UUID. Simplifies queries and matches the session-based auth model.

7. **No password column** — Brand auth currently uses in-memory session store. For production, passwords should be hashed with bcrypt and stored in a separate `brand_credentials` table or use Supabase Auth directly.
