CREATE TABLE "influencer_invite_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"influencer_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "influencer_invite_tokens" ADD CONSTRAINT "influencer_invite_tokens_influencer_id_influencers_influencer_id_fk" FOREIGN KEY ("influencer_id") REFERENCES "public"."influencers"("influencer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_invite_influencer" ON "influencer_invite_tokens" USING btree ("influencer_id");
