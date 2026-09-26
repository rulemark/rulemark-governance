CREATE TABLE "review_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"target_activity_id" uuid,
	"target_party_id" uuid,
	"target_system_id" uuid,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"details" jsonb,
	"deadlines" jsonb,
	"due_at" date,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"opened_by" text NOT NULL,
	"closed_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_item_code_unique" UNIQUE("code"),
	CONSTRAINT "review_item_code" CHECK ("review_item"."code" ~ '^RI-[1-9][0-9]*$'),
	CONSTRAINT "review_item_one_target" CHECK (num_nonnulls("review_item"."target_activity_id", "review_item"."target_party_id", "review_item"."target_system_id") = 1),
	CONSTRAINT "review_item_source" CHECK ("review_item"."source" IN ('monitor', 'snapshot', 'manual', 'schedule')),
	CONSTRAINT "review_item_reason" CHECK ("review_item"."reason" IN ('vendor_subprocessor_added', 'vendor_subprocessor_removed', 'unmapped_system', 'transfer_missing', 'region_violation', 'review_overdue')),
	CONSTRAINT "review_item_status" CHECK ("review_item"."status" IN ('open', 'resolved', 'dismissed')),
	CONSTRAINT "review_item_resolution" CHECK ("review_item"."status" = 'open' OR "review_item"."resolution_note" IS NOT NULL),
	CONSTRAINT "review_item_closed" CHECK (("review_item"."status" = 'open') = ("review_item"."closed_by" IS NULL) AND ("review_item"."closed_by" IS NULL) = ("review_item"."closed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "event_outbox" DROP CONSTRAINT "event_outbox_event_type";--> statement-breakpoint
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_target_activity_id_processing_activity_id_fk" FOREIGN KEY ("target_activity_id") REFERENCES "public"."processing_activity"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_target_party_id_party_id_fk" FOREIGN KEY ("target_party_id") REFERENCES "public"."party"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_item" ADD CONSTRAINT "review_item_target_system_id_system_id_fk" FOREIGN KEY ("target_system_id") REFERENCES "public"."system"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_item_open_due" ON "review_item" USING btree ("due_at") WHERE "review_item"."status" = 'open';--> statement-breakpoint
CREATE INDEX "review_item_target_activity" ON "review_item" USING btree ("target_activity_id");--> statement-breakpoint
CREATE INDEX "review_item_target_party" ON "review_item" USING btree ("target_party_id");--> statement-breakpoint
CREATE INDEX "review_item_target_system" ON "review_item" USING btree ("target_system_id");--> statement-breakpoint
ALTER TABLE "event_outbox" ADD CONSTRAINT "event_outbox_event_type" CHECK ("event_outbox"."event_type" IN ('record.changed', 'subprocessors.changed', 'review_item.changed'));