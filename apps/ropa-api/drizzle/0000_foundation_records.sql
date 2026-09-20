CREATE TABLE "party" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"legal_name" text NOT NULL,
	"country" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"dpo_name" text,
	"dpo_email" text,
	"trust_url" text,
	"dpa_url" text,
	"subprocessor_list_url" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "party_slug_unique" UNIQUE("slug"),
	CONSTRAINT "party_kind" CHECK ("party"."kind" IN ('self', 'client', 'vendor', 'other')),
	CONSTRAINT "party_slug" CHECK ("party"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "party"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'),
	CONSTRAINT "party_country" CHECK ("party"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "party_self_dpo" CHECK ("party"."kind" <> 'self' OR ("party"."dpo_name" IS NOT NULL AND "party"."dpo_email" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "agreement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"party_id" uuid NOT NULL,
	"terms_id" uuid NOT NULL,
	"offering_id" uuid,
	"signed_at" date NOT NULL,
	"ended_at" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_dates" CHECK ("agreement"."ended_at" IS NULL OR "agreement"."ended_at" >= "agreement"."signed_at")
);
--> statement-breakpoint
CREATE TABLE "agreement_terms" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"direction" text NOT NULL,
	"authorization_type" text NOT NULL,
	"notice_days" integer NOT NULL,
	"allowed_regions" text[] DEFAULT '{}' NOT NULL,
	"document_url" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_terms_slug_unique" UNIQUE("slug"),
	CONSTRAINT "agreement_terms_slug" CHECK ("agreement_terms"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "agreement_terms"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'),
	CONSTRAINT "agreement_terms_direction" CHECK ("agreement_terms"."direction" IN ('outbound', 'inbound')),
	CONSTRAINT "agreement_terms_authorization" CHECK ("agreement_terms"."authorization_type" IN ('general', 'specific')),
	CONSTRAINT "agreement_terms_notice_days" CHECK ("agreement_terms"."notice_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE "offering" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"default_terms_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offering_slug_unique" UNIQUE("slug"),
	CONSTRAINT "offering_slug" CHECK ("offering"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "offering"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-')
);
--> statement-breakpoint
CREATE TABLE "system" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"render_resource_id" text,
	"region" text,
	"hosting_party_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_slug_unique" UNIQUE("slug"),
	CONSTRAINT "system_render_resource_id" UNIQUE("render_resource_id"),
	CONSTRAINT "system_slug" CHECK ("system"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "system"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'),
	CONSTRAINT "system_kind" CHECK ("system"."kind" IN ('render_web_service', 'render_private_service', 'render_worker', 'render_cron', 'render_static_site', 'render_postgres', 'render_key_value', 'external_saas')),
	CONSTRAINT "system_render_region" CHECK ("system"."kind" = 'external_saas' OR "system"."region" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "data_category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"special" text DEFAULT 'none' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_category_slug_unique" UNIQUE("slug"),
	CONSTRAINT "data_category_slug" CHECK ("data_category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "data_category"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'),
	CONSTRAINT "data_category_special" CHECK ("data_category"."special" IN ('none', 'art9', 'art10'))
);
--> statement-breakpoint
CREATE TABLE "security_measure" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_measure_slug_unique" UNIQUE("slug"),
	CONSTRAINT "security_measure_slug" CHECK ("security_measure"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "security_measure"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-')
);
--> statement-breakpoint
CREATE TABLE "subject_category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_category_slug_unique" UNIQUE("slug"),
	CONSTRAINT "subject_category_slug" CHECK ("subject_category"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND "subject_category"."slug" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-')
);
--> statement-breakpoint
CREATE TABLE "code_counter" (
	"prefix" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_counter_prefix" CHECK ("code_counter"."prefix" IN ('C', 'P', 'J', 'RI')),
	CONSTRAINT "code_counter_last_value" CHECK ("code_counter"."last_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"destination" text NOT NULL,
	"payload" jsonb NOT NULL,
	"revision_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_outbox_once" UNIQUE("event_id","destination"),
	CONSTRAINT "event_outbox_event_type" CHECK ("event_outbox"."event_type" IN ('record.changed', 'subprocessors.changed')),
	CONSTRAINT "event_outbox_attempts" CHECK ("event_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"change_type" text NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"actor" text NOT NULL,
	"change_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_version_once" UNIQUE("entity_type","entity_id","version"),
	CONSTRAINT "revision_entity_type" CHECK ("revision"."entity_type" IN ('activity', 'party', 'agreement', 'agreement_terms', 'offering', 'system', 'subject_category', 'data_category', 'security_measure')),
	CONSTRAINT "revision_change_type" CHECK ("revision"."change_type" IN ('created', 'updated', 'activated', 'retired', 'deleted')),
	CONSTRAINT "revision_version" CHECK ("revision"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_terms_id_agreement_terms_id_fk" FOREIGN KEY ("terms_id") REFERENCES "public"."agreement_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreement" ADD CONSTRAINT "agreement_offering_id_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."offering"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offering" ADD CONSTRAINT "offering_default_terms_id_agreement_terms_id_fk" FOREIGN KEY ("default_terms_id") REFERENCES "public"."agreement_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system" ADD CONSTRAINT "system_hosting_party_id_party_id_fk" FOREIGN KEY ("hosting_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_revision_id_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "party_one_self" ON "party" USING btree ("kind") WHERE "party"."kind" = 'self';--> statement-breakpoint
CREATE INDEX "agreement_offering_party" ON "agreement" USING btree ("offering_id","party_id","ended_at");--> statement-breakpoint
CREATE INDEX "agreement_party" ON "agreement" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "system_hosting_party" ON "system" USING btree ("hosting_party_id");--> statement-breakpoint
CREATE INDEX "event_outbox_pending" ON "event_outbox" USING btree ("destination","next_attempt_at") WHERE "event_outbox"."delivered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "revision_as_of" ON "revision" USING btree ("entity_type","entity_id","valid_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "revision_changes" ON "revision" USING btree ("valid_from");