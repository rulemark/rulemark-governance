-- Hand-written: the activity aggregate's triggers (ropa-database.md §4.6, §8.1).
-- The functions were created in 0001; this only attaches them.

-- A code and a role never change once saved. The prefix encodes the role, so
-- a role change means retiring the activity and creating a new one with
-- supersedes_id (DM §3.0); a code that has appeared in a contract annex must
-- mean the same thing forever. `OF code, role` skips the check for updates
-- that do not mention either column.
CREATE TRIGGER processing_activity_immutable BEFORE UPDATE OF code, role ON processing_activity
  FOR EACH ROW EXECUTE FUNCTION forbid_immutable_change('code', 'role');
--> statement-breakpoint

-- Every editable table of the aggregate. The link tables are replaced
-- wholesale on save and never updated, so they carry created_at only.
CREATE TRIGGER processing_activity_set_updated_at BEFORE UPDATE ON processing_activity
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER retention_rule_set_updated_at BEFORE UPDATE ON retention_rule
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER activity_client_scope_set_updated_at BEFORE UPDATE ON activity_client_scope
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER engagement_set_updated_at BEFORE UPDATE ON engagement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER transfer_set_updated_at BEFORE UPDATE ON transfer
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER engagement_client_scope_set_updated_at BEFORE UPDATE ON engagement_client_scope
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
