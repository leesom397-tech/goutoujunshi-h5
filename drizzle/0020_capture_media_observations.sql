-- Cache visual observations with the exact uploaded media, never as confirmed profile facts.
-- Existing material deletion removes these columns with the media row.
ALTER TABLE coach_capture_media ADD COLUMN analysis_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE coach_capture_media ADD COLUMN analysis_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE coach_capture_media ADD COLUMN analyzed_at INTEGER;
