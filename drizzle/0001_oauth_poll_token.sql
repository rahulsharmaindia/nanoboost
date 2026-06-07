ALTER TABLE "influencer_oauth_states" ADD COLUMN "poll_token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "influencer_oauth_states" ADD COLUMN "result_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "influencer_oauth_states" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_oauth_poll_token" ON "influencer_oauth_states" USING btree ("poll_token");