-- Private captured materials are separate from paid reports and profile memory.
CREATE TABLE IF NOT EXISTS coach_capture_libraries (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  account TEXT NOT NULL,
  friend TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat','moments')),
  subject_id TEXT,
  epoch INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  warnings TEXT NOT NULL DEFAULT '[]',
  deleted_at INTEGER,
  UNIQUE(owner_id,account,friend,kind)
);
CREATE INDEX IF NOT EXISTS idx_capture_libraries_owner ON coach_capture_libraries(owner_id,deleted_at,updated_at DESC,id);
CREATE TABLE IF NOT EXISTS coach_capture_records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  local_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  record_json TEXT NOT NULL,
  sort_known INTEGER NOT NULL DEFAULT 1,
  sort_time INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(library_id,epoch,local_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_records_page ON coach_capture_records(owner_id,library_id,epoch,sort_known,sort_time,seq);
CREATE TABLE IF NOT EXISTS coach_capture_report_links (
  owner_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  source_ids TEXT NOT NULL,
  memory_source_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,report_id)
);
CREATE INDEX IF NOT EXISTS idx_capture_report_library ON coach_capture_report_links(owner_id,library_id,epoch);
CREATE TABLE IF NOT EXISTS coach_capture_sync_receipts (
  owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id,request_id)
);
CREATE TABLE IF NOT EXISTS coach_capture_media (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  library_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  local_id TEXT NOT NULL,
  image_index INTEGER NOT NULL,
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','ready')),
  created_at INTEGER NOT NULL,
  UNIQUE(library_id,epoch,local_id,image_index,sha256)
);
CREATE INDEX IF NOT EXISTS idx_capture_media_records ON coach_capture_media(owner_id,library_id,epoch,local_id,status);
CREATE TABLE IF NOT EXISTS coach_capture_media_chunks (
  media_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY(media_id,chunk_index)
);
