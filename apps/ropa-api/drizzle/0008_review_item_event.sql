CREATE TABLE "review_item_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"event_id" uuid NOT NULL,
	"review_item_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"review_item" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_item_event_once" UNIQUE("event_id"),
	CONSTRAINT "review_item_event_change_type" CHECK ("review_item_event"."change_type" IN ('opened', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX "review_item_event_changes" ON "review_item_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "review_item_event_item" ON "review_item_event" USING btree ("review_item_id","occurred_at");