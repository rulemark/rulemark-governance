CREATE TABLE "activity_client_scope" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"activity_id" uuid NOT NULL,
	"client_party_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"reason" text,
	"agreement_id" uuid,
	"started_at" date NOT NULL,
	"ended_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_client_scope_mode" CHECK ("activity_client_scope"."mode" IN ('include', 'exclude')),
	CONSTRAINT "activity_client_scope_dates" CHECK ("activity_client_scope"."ended_at" IS NULL OR "activity_client_scope"."ended_at" >= "activity_client_scope"."started_at")
);
--> statement-breakpoint
CREATE TABLE "activity_data_category" (
	"activity_id" uuid NOT NULL,
	"data_category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_data_category_pkey" PRIMARY KEY("activity_id","data_category_id")
);
--> statement-breakpoint
CREATE TABLE "activity_security_measure" (
	"activity_id" uuid NOT NULL,
	"security_measure_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_security_measure_pkey" PRIMARY KEY("activity_id","security_measure_id")
);
--> statement-breakpoint
CREATE TABLE "activity_subject_category" (
	"activity_id" uuid NOT NULL,
	"subject_category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_subject_category_pkey" PRIMARY KEY("activity_id","subject_category_id")
);
--> statement-breakpoint
CREATE TABLE "activity_system" (
	"activity_id" uuid NOT NULL,
	"system_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_system_pkey" PRIMARY KEY("activity_id","system_id")
);
--> statement-breakpoint
CREATE TABLE "engagement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"activity_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" text NOT NULL,
	"service_description" text NOT NULL,
	"processing_countries" text[] NOT NULL,
	"started_at" date,
	"ended_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_role" CHECK ("engagement"."role" IN ('processor', 'subprocessor', 'recipient', 'joint_controller')),
	CONSTRAINT "engagement_processing_countries" CHECK (cardinality("engagement"."processing_countries") >= 1)
);
--> statement-breakpoint
CREATE TABLE "engagement_client_scope" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"client_party_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"reason" text NOT NULL,
	"agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_client_scope_once" UNIQUE("engagement_id","client_party_id"),
	CONSTRAINT "engagement_client_scope_mode" CHECK ("engagement_client_scope"."mode" IN ('include', 'exclude'))
);
--> statement-breakpoint
CREATE TABLE "engagement_data_category" (
	"engagement_id" uuid NOT NULL,
	"data_category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_data_category_pkey" PRIMARY KEY("engagement_id","data_category_id")
);
--> statement-breakpoint
CREATE TABLE "processing_activity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"supersedes_id" uuid,
	"role" text NOT NULL,
	"role_rationale" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner" text NOT NULL,
	"offering_id" uuid,
	"client_coverage" text,
	"purposes" text[] DEFAULT '{}' NOT NULL,
	"lawful_bases" text[] DEFAULT '{}' NOT NULL,
	"special_conditions" text[] DEFAULT '{}' NOT NULL,
	"processing_categories" text[] DEFAULT '{}' NOT NULL,
	"dpia_required" boolean,
	"dpia_ref" text,
	"dpia_support_ref" text,
	"review_due_at" date,
	"started_at" date,
	"ended_at" date,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processing_activity_code_unique" UNIQUE("code"),
	CONSTRAINT "processing_activity_code" CHECK ("processing_activity"."code" ~ '^[CPJ][1-9][0-9]*$'),
	CONSTRAINT "processing_activity_role" CHECK ("processing_activity"."role" IN ('controller', 'processor', 'joint_controller')),
	CONSTRAINT "processing_activity_status" CHECK ("processing_activity"."status" IN ('draft', 'active', 'retired')),
	CONSTRAINT "processing_activity_client_coverage" CHECK ("processing_activity"."client_coverage" IN ('all_enrolled', 'opt_in')),
	CONSTRAINT "processing_activity_lawful_bases" CHECK ("processing_activity"."lawful_bases" <@ ARRAY['6(1)(a)', '6(1)(b)', '6(1)(c)', '6(1)(d)', '6(1)(e)', '6(1)(f)']::text[]),
	CONSTRAINT "processing_activity_special_conditions" CHECK ("processing_activity"."special_conditions" <@ ARRAY['9(2)(a)', '9(2)(b)', '9(2)(c)', '9(2)(d)', '9(2)(e)', '9(2)(f)', '9(2)(g)', '9(2)(h)', '9(2)(i)', '9(2)(j)', 'art10']::text[]),
	CONSTRAINT "processing_activity_code_prefix" CHECK (left("processing_activity"."code", 1) = CASE "processing_activity"."role" WHEN 'controller' THEN 'C' WHEN 'processor' THEN 'P' ELSE 'J' END),
	CONSTRAINT "processing_activity_controller_fields" CHECK ("processing_activity"."role" <> 'controller' OR ("processing_activity"."offering_id" IS NULL AND "processing_activity"."client_coverage" IS NULL AND "processing_activity"."processing_categories" = '{}' AND "processing_activity"."dpia_support_ref" IS NULL)),
	CONSTRAINT "processing_activity_processor_fields" CHECK ("processing_activity"."role" <> 'processor' OR ("processing_activity"."purposes" = '{}' AND "processing_activity"."lawful_bases" = '{}' AND "processing_activity"."special_conditions" = '{}' AND "processing_activity"."dpia_required" IS NULL AND "processing_activity"."dpia_ref" IS NULL)),
	CONSTRAINT "processing_activity_dates" CHECK ("processing_activity"."ended_at" IS NULL OR "processing_activity"."started_at" IS NULL OR "processing_activity"."ended_at" >= "processing_activity"."started_at"),
	CONSTRAINT "processing_activity_active_controller" CHECK ("processing_activity"."status" <> 'active' OR "processing_activity"."role" <> 'controller' OR (cardinality("processing_activity"."purposes") > 0 AND cardinality("processing_activity"."lawful_bases") > 0 AND "processing_activity"."dpia_required" IS NOT NULL)),
	CONSTRAINT "processing_activity_active_processor" CHECK ("processing_activity"."status" <> 'active' OR "processing_activity"."role" <> 'processor' OR ("processing_activity"."offering_id" IS NOT NULL AND "processing_activity"."client_coverage" IS NOT NULL AND cardinality("processing_activity"."processing_categories") > 0)),
	CONSTRAINT "processing_activity_active_started" CHECK ("processing_activity"."status" = 'draft' OR "processing_activity"."started_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "retention_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"activity_id" uuid NOT NULL,
	"data_category_id" uuid,
	"retention_period" text NOT NULL,
	"trigger_event" text NOT NULL,
	"legal_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_rule_one_per_category" UNIQUE NULLS NOT DISTINCT("activity_id","data_category_id"),
	CONSTRAINT "retention_rule_period" CHECK ("retention_rule"."retention_period" ~ '^P([0-9]+Y)?([0-9]+M)?([0-9]+W)?([0-9]+D)?$' AND "retention_rule"."retention_period" <> 'P')
);
--> statement-breakpoint
CREATE TABLE "transfer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"engagement_id" uuid NOT NULL,
	"destination_country" text NOT NULL,
	"mechanism" text NOT NULL,
	"onward_via" text,
	"document_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_destination_country" CHECK ("transfer"."destination_country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "transfer_mechanism" CHECK ("transfer"."mechanism" IN ('adequacy', 'dpf', 'sccs', 'bcr', 'derogation_49'))
);
--> statement-breakpoint
ALTER TABLE "activity_client_scope" ADD CONSTRAINT "activity_client_scope_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_client_scope" ADD CONSTRAINT "activity_client_scope_client_party_id_party_id_fk" FOREIGN KEY ("client_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_client_scope" ADD CONSTRAINT "activity_client_scope_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_data_category" ADD CONSTRAINT "activity_data_category_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_data_category" ADD CONSTRAINT "activity_data_category_data_category_id_data_category_id_fk" FOREIGN KEY ("data_category_id") REFERENCES "public"."data_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_security_measure" ADD CONSTRAINT "activity_security_measure_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_security_measure" ADD CONSTRAINT "activity_security_measure_security_measure_id_security_measure_id_fk" FOREIGN KEY ("security_measure_id") REFERENCES "public"."security_measure"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_subject_category" ADD CONSTRAINT "activity_subject_category_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_subject_category" ADD CONSTRAINT "activity_subject_category_subject_category_id_subject_category_id_fk" FOREIGN KEY ("subject_category_id") REFERENCES "public"."subject_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_system" ADD CONSTRAINT "activity_system_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_system" ADD CONSTRAINT "activity_system_system_id_system_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."system"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_party_id_party_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_client_scope" ADD CONSTRAINT "engagement_client_scope_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_client_scope" ADD CONSTRAINT "engagement_client_scope_client_party_id_party_id_fk" FOREIGN KEY ("client_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_client_scope" ADD CONSTRAINT "engagement_client_scope_agreement_id_agreement_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreement"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_data_category" ADD CONSTRAINT "engagement_data_category_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_data_category" ADD CONSTRAINT "engagement_data_category_data_category_id_data_category_id_fk" FOREIGN KEY ("data_category_id") REFERENCES "public"."data_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD CONSTRAINT "processing_activity_supersedes_id_processing_activity_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."processing_activity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activity" ADD CONSTRAINT "processing_activity_offering_id_offering_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."offering"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rule" ADD CONSTRAINT "retention_rule_activity_id_processing_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_rule" ADD CONSTRAINT "retention_rule_data_category_id_data_category_id_fk" FOREIGN KEY ("data_category_id") REFERENCES "public"."data_category"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_engagement_id_engagement_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_client_scope_one_active" ON "activity_client_scope" USING btree ("activity_id","client_party_id") WHERE "activity_client_scope"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "activity_client_scope_client" ON "activity_client_scope" USING btree ("client_party_id");--> statement-breakpoint
CREATE INDEX "activity_data_category_rev" ON "activity_data_category" USING btree ("data_category_id");--> statement-breakpoint
CREATE INDEX "activity_security_measure_rev" ON "activity_security_measure" USING btree ("security_measure_id");--> statement-breakpoint
CREATE INDEX "activity_subject_category_rev" ON "activity_subject_category" USING btree ("subject_category_id");--> statement-breakpoint
CREATE INDEX "activity_system_rev" ON "activity_system" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX "engagement_activity" ON "engagement" USING btree ("activity_id");--> statement-breakpoint
CREATE INDEX "engagement_party" ON "engagement" USING btree ("party_id");--> statement-breakpoint
CREATE INDEX "engagement_client_scope_client" ON "engagement_client_scope" USING btree ("client_party_id");--> statement-breakpoint
CREATE INDEX "processing_activity_offering" ON "processing_activity" USING btree ("offering_id");--> statement-breakpoint
CREATE INDEX "processing_activity_status" ON "processing_activity" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transfer_engagement" ON "transfer" USING btree ("engagement_id");