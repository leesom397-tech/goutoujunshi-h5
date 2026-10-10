-- No signup gift, no legacy-account gift, no reviewer-specific permissions.
CREATE TABLE coach_credit_accounts (
  owner_id TEXT PRIMARY KEY NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (typeof(balance) = 'integer' AND balance >= 0),
  features TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(features) AND json_type(features) = 'array'),
  enabled_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE coach_credit_adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES coach_credit_accounts(owner_id),
  actor_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (typeof(delta) = 'integer' AND delta != 0 AND abs(delta) <= 1000000),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 2 AND 200),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_credit_adjustments_owner ON coach_credit_adjustments(owner_id, created_at);
CREATE TRIGGER credit_adjustment_apply AFTER INSERT ON coach_credit_adjustments BEGIN
  UPDATE coach_credit_accounts SET balance = balance + NEW.delta, updated_at = NEW.created_at WHERE owner_id = NEW.owner_id;
END;
CREATE TRIGGER credit_adjustment_immutable_update BEFORE UPDATE ON coach_credit_adjustments BEGIN
  SELECT RAISE(ABORT, 'CREDIT_AUDIT_IMMUTABLE');
END;
CREATE TRIGGER credit_adjustment_immutable_delete BEFORE DELETE ON coach_credit_adjustments BEGIN
  SELECT RAISE(ABORT, 'CREDIT_AUDIT_IMMUTABLE');
END;

CREATE TABLE coach_credit_permissions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES coach_credit_accounts(owner_id),
  actor_id TEXT NOT NULL,
  features TEXT NOT NULL CHECK (json_valid(features) AND json_type(features) = 'array'),
  enabled_until INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 2 AND 200),
  created_at INTEGER NOT NULL
);
CREATE TRIGGER credit_permission_apply AFTER INSERT ON coach_credit_permissions BEGIN
  UPDATE coach_credit_accounts SET features = NEW.features, enabled_until = NEW.enabled_until, updated_at = NEW.created_at WHERE owner_id = NEW.owner_id;
END;
CREATE TRIGGER credit_permission_immutable_update BEFORE UPDATE ON coach_credit_permissions BEGIN
  SELECT RAISE(ABORT, 'CREDIT_AUDIT_IMMUTABLE');
END;
CREATE TRIGGER credit_permission_immutable_delete BEFORE DELETE ON coach_credit_permissions BEGIN
  SELECT RAISE(ABORT, 'CREDIT_AUDIT_IMMUTABLE');
END;

CREATE TABLE coach_credit_tasks (
  owner_id TEXT NOT NULL REFERENCES coach_credit_accounts(owner_id),
  request_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'released')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, request_id)
);
CREATE INDEX idx_credit_tasks_owner ON coach_credit_tasks(owner_id, created_at);
CREATE TRIGGER credit_task_authorize BEFORE INSERT ON coach_credit_tasks BEGIN
  SELECT CASE WHEN NEW.status != 'reserved' OR NOT EXISTS (
    SELECT 1 FROM coach_credit_accounts a WHERE a.owner_id = NEW.owner_id
      AND a.enabled_until > NEW.created_at AND a.balance >= NEW.amount
      AND EXISTS (SELECT 1 FROM json_each(a.features) WHERE value = NEW.feature)
  ) THEN RAISE(ABORT, 'CREDIT_NOT_AVAILABLE') END;
END;
CREATE TRIGGER credit_task_reserve AFTER INSERT ON coach_credit_tasks BEGIN
  UPDATE coach_credit_accounts SET balance = balance - NEW.amount, updated_at = NEW.created_at WHERE owner_id = NEW.owner_id;
END;
CREATE TRIGGER credit_task_transition BEFORE UPDATE ON coach_credit_tasks BEGIN
  SELECT CASE WHEN OLD.status != 'reserved' OR NEW.status NOT IN ('settled', 'released')
    OR NEW.owner_id != OLD.owner_id OR NEW.request_id != OLD.request_id
    OR NEW.feature != OLD.feature OR NEW.fingerprint != OLD.fingerprint
    OR NEW.amount != OLD.amount OR NEW.created_at != OLD.created_at
    THEN RAISE(ABORT, 'CREDIT_INVALID_TRANSITION') END;
END;
CREATE TRIGGER credit_task_release AFTER UPDATE OF status ON coach_credit_tasks WHEN NEW.status = 'released' BEGIN
  UPDATE coach_credit_accounts SET balance = balance + NEW.amount, updated_at = NEW.updated_at WHERE owner_id = NEW.owner_id;
END;
CREATE TRIGGER credit_task_immutable_delete BEFORE DELETE ON coach_credit_tasks BEGIN
  SELECT RAISE(ABORT, 'CREDIT_AUDIT_IMMUTABLE');
END;
