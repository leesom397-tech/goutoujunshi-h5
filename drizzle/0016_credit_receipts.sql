CREATE TABLE coach_credit_receipts (
  owner_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, request_id),
  FOREIGN KEY (owner_id, request_id) REFERENCES coach_credit_tasks(owner_id, request_id)
);
CREATE INDEX idx_credit_receipts_expiry ON coach_credit_receipts(expires_at);
