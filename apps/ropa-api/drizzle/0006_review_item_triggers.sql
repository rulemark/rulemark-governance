-- Hand-written: review_item's triggers (ropa-database.md §4.6, §8.1). The
-- functions were created in 0001; this only attaches them.

-- A code never changes once given: people quote RI-42 in email and tickets,
-- and it must keep meaning the same item (DM §3.0). `OF code` skips the check
-- for updates that do not mention it, such as closing an item.
CREATE TRIGGER review_item_immutable BEFORE UPDATE OF code ON review_item
  FOR EACH ROW EXECUTE FUNCTION forbid_immutable_change('code');
--> statement-breakpoint

CREATE TRIGGER review_item_set_updated_at BEFORE UPDATE ON review_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
