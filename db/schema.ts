import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("coach_profiles", {
  ownerId: text("owner_id").primaryKey(),
  consentAt: integer("consent_at"),
  paused: integer("paused").notNull().default(0),
  data: text("data").notNull().default("{}"),
  updatedAt: integer("updated_at").notNull(),
});

export const subjects = sqliteTable("coach_subjects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull().default("active"),
  data: text("data").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_coach_subjects_owner").on(table.ownerId, table.updatedAt)]);

export const facts = sqliteTable("coach_facts", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  subjectId: text("subject_id"),
  field: text("field").notNull(),
  value: text("value").notNull(),
  source: text("source").notNull(),
  evidence: text("evidence").notNull().default(""),
  eventMeta: text("event_meta"),
  confidence: text("confidence").notNull().default("medium"),
  status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_coach_facts_owner_status").on(table.ownerId, table.status, table.createdAt)]);

export const positionings = sqliteTable("coach_positionings", {
  ownerId: text("owner_id").primaryKey(),
  inputJson: text("input_json").notNull(),
  reportJson: text("report_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const wechatBindCodes = sqliteTable("coach_wechat_bind_codes", {
  codeHash: text("code_hash").primaryKey(),
  ownerId: text("owner_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_coach_wechat_bind_codes_owner").on(table.ownerId)]);

export const wechatLinks = sqliteTable("coach_wechat_links", {
  externalUserId: text("external_userid").primaryKey(),
  openKfId: text("open_kfid").notNull(),
  ownerId: text("owner_id").notNull(),
  subjectId: text("subject_id"),
  memoryOfferReportId: text("memory_offer_report_id"),
  memoryOfferExpiresAt: integer("memory_offer_expires_at").notNull().default(0),
  memoryOfferAskedAt: integer("memory_offer_asked_at").notNull().default(0),
  memoryOfferStartRevision: integer("memory_offer_start_revision").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_coach_wechat_links_owner").on(table.ownerId)]);

// Mini Program OpenID is an identity within one AppID, not a LoveTalk account
// and not a WeChat Customer Service external_userid. Binding is explicit.
export const miniappLinks = sqliteTable("coach_miniapp_links", {
  openId: text("open_id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  phoneLast4: text("phone_last4"),
  phoneVerifiedAt: integer("phone_verified_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_coach_miniapp_links_owner").on(table.ownerId)]);

export const miniappPairings = sqliteTable("coach_miniapp_pairings", {
  codeHash: text("code_hash").primaryKey(),
  openId: text("open_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_coach_miniapp_pairings_open").on(table.openId)]);

export const miniappSessions = sqliteTable("coach_miniapp_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  openId: text("open_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_coach_miniapp_sessions_open").on(table.openId)]);

export const wechatCursors = sqliteTable("coach_wechat_cursors", {
  openKfId: text("open_kfid").primaryKey(),
  cursor: text("cursor").notNull().default(""),
  leaseUntil: integer("lease_until").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});

export const wechatMessages = sqliteTable("coach_wechat_messages", {
  msgId: text("msgid").primaryKey(),
  openKfId: text("open_kfid").notNull(),
  externalUserId: text("external_userid").notNull(),
  status: text("status").notNull().default("processing"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const crushSettings = sqliteTable("coach_crush_settings", {
  ownerId: text("owner_id").primaryKey(),
  consentAt: integer("consent_at"),
  jevConsentAt: integer("jev_consent_at"),
  jevFullConsentAt: integer("jev_full_consent_at"),
  affinityConsentAt: integer("affinity_consent_at"),
  imageConsentAt: integer("image_consent_at"),
  imageSelfSide: text("image_self_side").notNull().default("ask"),
  provider: text("provider").notNull().default("qwen"),
  updatedAt: integer("updated_at").notNull(),
});
export const crushThreads = sqliteTable("coach_crush_threads", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(),
  subjectId: text("subject_id"), channelKey: text("channel_key").notNull(),
  data: text("data").notNull().default("[]"), selfLabel: text("self_label").notNull().default(""),
  draft: text("draft").notNull().default(""), collecting: integer("collecting").notNull().default(0),
  voicePending: text("voice_pending").notNull().default("{}"), voicePendingExpiresAt: integer("voice_pending_expires_at").notNull().default(0),
  imagePending: text("image_pending").notNull().default("{}"), imagePendingExpiresAt: integer("image_pending_expires_at").notNull().default(0),
  adviceData: text("advice_data").notNull().default("[]"),
  revision: integer("revision").notNull().default(0), leaseUntil: integer("lease_until").notNull().default(0), updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, t => [uniqueIndex("idx_crush_threads_owner_channel").on(t.ownerId,t.channelKey), index("idx_crush_threads_expiry").on(t.expiresAt)]);
export const crushReports = sqliteTable("coach_crush_reports", {
  id: text("id").primaryKey(), ownerId: text("owner_id").notNull(), threadId: text("thread_id").notNull(),
  sourceKey: text("source_key").notNull(), inputHash: text("input_hash").notNull(),
  revision: integer("revision").notNull(), status: text("status").notNull().default("pending"),
  result: text("result").notNull().default("{}"), createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [uniqueIndex("idx_crush_reports_source").on(t.ownerId,t.sourceKey),index("idx_crush_reports_thread").on(t.ownerId,t.threadId,t.createdAt),index("idx_crush_reports_expiry").on(t.expiresAt)]);
export const crushBudget = sqliteTable("coach_crush_budget", {
  id: text("id").primaryKey(), uses: integer("uses").notNull().default(0), expiresAt: integer("expires_at").notNull(),
});
export const wechatInbox = sqliteTable("coach_wechat_inbox", {
  id: text("id").primaryKey(), openKfId: text("open_kfid").notNull(), externalUserId: text("external_userid").notNull(),
  attempts: integer("attempts").notNull().default(0),
  payload: text("payload").notNull(), status: text("status").notNull().default("pending"),
  updatedAt: integer("updated_at").notNull(), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [index("idx_wechat_inbox_pending").on(t.status,t.updatedAt),index("idx_wechat_inbox_conversation").on(t.openKfId,t.externalUserId,t.createdAt)]);
export const wechatOutbox = sqliteTable("coach_wechat_outbox", {
  id: text("id").primaryKey(), ownerId: text("owner_id"), openKfId: text("open_kfid").notNull(), externalUserId: text("external_userid").notNull(),
  payload: text("payload").notNull(), status: text("status").notNull().default("pending"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(), expiresAt: integer("expires_at").notNull(),
}, t => [index("idx_wechat_outbox_owner").on(t.ownerId),index("idx_wechat_outbox_expiry").on(t.expiresAt)]);
