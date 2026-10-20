type ReportReturnContext = { reportId?: unknown; returnTo?: unknown };

/** Rebuild a local report URL; never follow an arbitrary address from stored context. */
export function reportReturnHref(context: ReportReturnContext | null | undefined): string {
  const id = typeof context?.reportId === "string" ? context.reportId.trim() : "";
  if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) return "/reports";
  const params = new URLSearchParams({ id });
  const address = context?.returnTo;
  if (typeof address === "string" && address.startsWith("/") && !address.startsWith("//")) {
    try {
      const source = new URL(address, "https://report-return.invalid");
      if (source.origin === "https://report-return.invalid" && ["/report", "/analyze"].includes(source.pathname)) {
        const focus = source.searchParams.get("focus");
        if (focus && ["affinity", "intent", "reply"].includes(focus)) params.set("focus", focus);
      }
    } catch { /* The saved report ID remains usable without an optional reading focus. */ }
  }
  return "/report?" + params.toString();
}
