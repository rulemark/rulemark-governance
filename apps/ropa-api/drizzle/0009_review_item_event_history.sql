-- Hand-written: review_item_event's trigger and backfill (ropa-database.md
-- §4.6, §8.1; step 4, open question 3).

-- One append-only rule for every history table. The function names the table
-- it guards, so `revision` reads exactly as before and `review_item_event`
-- names itself.
CREATE OR REPLACE FUNCTION revision_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed on this table', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER review_item_event_append_only BEFORE UPDATE OR DELETE ON review_item_event
  FOR EACH ROW EXECUTE FUNCTION revision_append_only();
--> statement-breakpoint

-- Until now the outbox held review items' history. Every review_item.changed
-- event becomes a history row: one per event, whichever destinations it was
-- queued for, keeping when the outbox row was written. Safe to run twice.
INSERT INTO review_item_event
  (event_id, review_item_id, change_type, occurred_at, actor, review_item, created_at)
SELECT DISTINCT ON (event_id)
  event_id,
  (payload #>> '{data,reviewItem,id}')::uuid,
  payload #>> '{data,changeType}',
  (payload ->> 'occurredAt')::timestamptz,
  payload #>> '{data,actor}',
  payload #> '{data,reviewItem}',
  created_at
FROM event_outbox
WHERE event_type = 'review_item.changed'
ORDER BY event_id, created_at
ON CONFLICT (event_id) DO NOTHING;
