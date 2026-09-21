ALTER TABLE "party" DROP CONSTRAINT "party_slug";--> statement-breakpoint
ALTER TABLE "agreement_terms" DROP CONSTRAINT "agreement_terms_slug";--> statement-breakpoint
ALTER TABLE "offering" DROP CONSTRAINT "offering_slug";--> statement-breakpoint
ALTER TABLE "system" DROP CONSTRAINT "system_slug";--> statement-breakpoint
ALTER TABLE "data_category" DROP CONSTRAINT "data_category_slug";--> statement-breakpoint
ALTER TABLE "security_measure" DROP CONSTRAINT "security_measure_slug";--> statement-breakpoint
ALTER TABLE "subject_category" DROP CONSTRAINT "subject_category_slug";--> statement-breakpoint
ALTER TABLE "party" ADD CONSTRAINT "party_slug" CHECK ("party"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "party"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("party"."slug") <= 100);--> statement-breakpoint
ALTER TABLE "agreement_terms" ADD CONSTRAINT "agreement_terms_slug" CHECK ("agreement_terms"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "agreement_terms"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("agreement_terms"."slug") <= 100);--> statement-breakpoint
ALTER TABLE "offering" ADD CONSTRAINT "offering_slug" CHECK ("offering"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "offering"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("offering"."slug") <= 100);--> statement-breakpoint
ALTER TABLE "system" ADD CONSTRAINT "system_slug" CHECK ("system"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "system"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("system"."slug") <= 100);--> statement-breakpoint
ALTER TABLE "data_category" ADD CONSTRAINT "data_category_slug" CHECK ("data_category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "data_category"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("data_category"."slug") <= 100);--> statement-breakpoint
ALTER TABLE "security_measure" ADD CONSTRAINT "security_measure_slug" CHECK ("security_measure"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "security_measure"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("security_measure"."slug") <= 100);--> statement-breakpoint
ALTER TABLE "subject_category" ADD CONSTRAINT "subject_category_slug" CHECK ("subject_category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "subject_category"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-' AND length("subject_category"."slug") <= 100);