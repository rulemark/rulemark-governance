-- Hand-written: triggers, functions and the reference rows the application
-- cannot run without (ropa-database.md §4.6, §5, §8.1).

-- updated_at is maintained by the database, not the application, so a direct
-- SQL fix or a missed assignment in a repository cannot leave it stale.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER party_set_updated_at BEFORE UPDATE ON party
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agreement_terms_set_updated_at BEFORE UPDATE ON agreement_terms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER offering_set_updated_at BEFORE UPDATE ON offering
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agreement_set_updated_at BEFORE UPDATE ON agreement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER system_set_updated_at BEFORE UPDATE ON system
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subject_category_set_updated_at BEFORE UPDATE ON subject_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER data_category_set_updated_at BEFORE UPDATE ON data_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER security_measure_set_updated_at BEFORE UPDATE ON security_measure
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER code_counter_set_updated_at BEFORE UPDATE ON code_counter
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER event_outbox_set_updated_at BEFORE UPDATE ON event_outbox
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Raises if any of the columns named in the trigger arguments changes. Written
-- generically because the columns it protects (processing_activity.code and
-- .role, review_item.code) belong to tables built in step 2; attaching it there
-- is then a single CREATE TRIGGER. A code that has appeared in a contract annex
-- must mean the same thing forever (DM §3.0).
CREATE OR REPLACE FUNCTION forbid_immutable_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  column_name text;
  old_value   text;
  new_value   text;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', column_name, column_name)
      INTO old_value, new_value USING OLD, NEW;
    IF old_value IS DISTINCT FROM new_value THEN
      RAISE EXCEPTION '%.% is immutable (% -> %)',
        TG_TABLE_NAME, column_name, old_value, new_value
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

-- History can only be appended. Enforcing this in the database means an
-- application bug, or someone holding the app's credentials at a SQL console,
-- still cannot rewrite what the record said (§4.6). This is the control the
-- Chapter 8 regulator scene depends on.
CREATE OR REPLACE FUNCTION revision_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'revision is append-only: % is not allowed on this table', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER revision_append_only BEFORE UPDATE OR DELETE ON revision
  FOR EACH ROW EXECUTE FUNCTION revision_append_only();
--> statement-breakpoint

-- Codes are allocated by incrementing these rows inside the creating
-- transaction (§5). The application cannot create a record without them, so
-- they are structure rather than seed data.
INSERT INTO code_counter (prefix) VALUES ('C'), ('P'), ('J'), ('RI')
  ON CONFLICT (prefix) DO NOTHING;
