ALTER TABLE "agents" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pipeline_routing_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pipeline_routing_onboarding_skipped" boolean DEFAULT false NOT NULL;
