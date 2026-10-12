-- Completed reports belong to their authenticated owner until explicitly deleted.
-- Image uploads, OCR checkpoints and live chat context keep their existing TTLs.
CREATE TABLE IF NOT EXISTS coach_saved_reports (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat','moments','social')),
  subject_id TEXT,
  image_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','done','deleted')),
  summary TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '{}',
  report_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_reports_owner_created ON coach_saved_reports(owner_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_reports_owner_subject ON coach_saved_reports(owner_id,subject_id);
-- An old background job must not resurrect reports after an owner clears data.
CREATE TABLE IF NOT EXISTS coach_report_deletions (
  owner_id TEXT PRIMARY KEY NOT NULL,
  deleted_before INTEGER NOT NULL
);
