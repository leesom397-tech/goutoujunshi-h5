/** Only return to existing in-app report/archive/material-choice screens. */
export function intakeReturnTo(value: unknown): string {
  if (typeof value !== "string" || value.length > 1500 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "";
  try {
    const url = new URL(value, "https://intake.invalid");
    if (url.origin !== "https://intake.invalid" || !["/report", "/archive", "/relationship"].includes(url.pathname)) return "";
    const params = new URLSearchParams();
    if (url.pathname === "/report") {
      const id = url.searchParams.get("id") || ""; if (!/^[a-f0-9-]{36}$/i.test(id)) return "";
      params.set("id", id);
      const focus=url.searchParams.get('focus');if(focus&&['affinity','intent','reply'].includes(focus))params.set('focus',focus);
    } else for (const key of (url.pathname === "/relationship" ? ["subjectId"] : ["compare", "subjectId", "tab", "section", "people", "ids"])) {
      const next = url.searchParams.get(key); if (next && next.length <= 250 && /^[\p{L}\p{N}_,:-]+$/u.test(next)) params.set(key, next);
    }
    const fragment=url.pathname==='/report'&&/^#report-section-(status|moments|change|next|overview|content|replies|evidence|tone|signals)$/.test(url.hash)?url.hash:'';
    return url.pathname + (params.size ? "?" + params : "") + fragment;
  } catch { return ""; }
}
export function intakeHref(path: "/analyze" | "/capture", options: { mode?: string; kind?: string; method?: string; subjectId?: string; libraryId?: string; returnTo?: string; targetSelf?: boolean; capture?: boolean } = {}) {
  const params = new URLSearchParams();
  for (const key of ["mode", "kind", "method", "subjectId", "libraryId"] as const) if (options[key]) params.set(key, options[key]!);
  if (options.targetSelf) params.set("target", "self");
  if (options.capture) params.set("capture", "1");
  const back = intakeReturnTo(options.returnTo); if (back) params.set("returnTo", back);
  return path + (params.size ? "?" + params : "");
}
