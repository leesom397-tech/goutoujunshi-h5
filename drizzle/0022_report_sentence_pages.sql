-- Additive cache: original reports and their billing records are never rewritten.
CREATE TABLE IF NOT EXISTS coach_report_sentence_pages (
  owner_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  version INTEGER NOT NULL,
  page_key TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{"annotations":[]}',
  status TEXT NOT NULL DEFAULT 'unread',
  lease_id TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempted_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, report_id, epoch, revision, version, page_key)
);
CREATE INDEX IF NOT EXISTS coach_sentence_pages_owner_lease ON coach_report_sentence_pages(owner_id, lease_until);
CREATE INDEX IF NOT EXISTS coach_sentence_pages_library ON coach_report_sentence_pages(owner_id, library_id);

-- Existing deletion code also clears these derived texts after a rollback to
-- an older application release. In-flight writes still check live source state.
CREATE TRIGGER IF NOT EXISTS coach_sentence_report_deleted AFTER UPDATE OF status ON coach_saved_reports
WHEN NEW.status='deleted'
BEGIN DELETE FROM coach_report_sentence_pages WHERE owner_id=NEW.owner_id AND report_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS coach_sentence_report_removed AFTER DELETE ON coach_saved_reports
BEGIN DELETE FROM coach_report_sentence_pages WHERE owner_id=OLD.owner_id AND report_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS coach_sentence_library_changed AFTER UPDATE OF epoch,revision,deleted_at,subject_id ON coach_capture_libraries
WHEN NEW.epoch!=OLD.epoch OR NEW.revision!=OLD.revision OR NEW.deleted_at IS NOT NULL OR NEW.subject_id IS NOT OLD.subject_id
BEGIN DELETE FROM coach_report_sentence_pages WHERE owner_id=NEW.owner_id AND library_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS coach_sentence_library_removed AFTER DELETE ON coach_capture_libraries
BEGIN DELETE FROM coach_report_sentence_pages WHERE owner_id=OLD.owner_id AND library_id=OLD.id; END;
