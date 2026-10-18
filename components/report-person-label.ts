const roles: Record<string, string> = {
  self: "我", me: "我", other: "对方", unknown: "身份待确认", "": "身份待确认",
};

/** Display labels only. Never pass source quotes or message text through this helper. */
export function reportPersonLabel(value: unknown, fallback = "身份待确认") {
  const label = typeof value === "string" ? value.trim().replace(/ · #[a-fA-F0-9]{16}$/, "") : "";
  return label ? roles[label.toLowerCase()] || label : fallback;
}

export function reportSenderLabel(role: unknown, name?: unknown) {
  if (role === "self") return "我";
  const label = typeof name === "string" ? name.trim() : "";
  return reportPersonLabel(label || role);
}
