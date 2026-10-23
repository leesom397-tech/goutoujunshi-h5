type ReportReturnContext = { reportId?: unknown; returnTo?: unknown };

/** Rebuild a local report URL; never follow an arbitrary address from stored context. */
export function reportReturnHref(context: ReportReturnContext | null | undefined): string {
  const id = typeof context?.reportId === "string" ? context.reportId.trim() : "";
  if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) return "/reports";
  const params = new URLSearchParams({ id });
  let fragment = "";
  const address = context?.returnTo;
  if (typeof address === "string" && address.startsWith("/") && !address.startsWith("//")) {
    try {
      const source = new URL(address, "https://report-return.invalid");
      if (source.origin === "https://report-return.invalid" && ["/report", "/analyze"].includes(source.pathname)) {
        const focus = source.searchParams.get("focus");
        if (focus && ["affinity", "intent", "reply"].includes(focus)) params.set("focus", focus);
        if (/^#report-section-(status|moments|change|next|overview|content|replies|evidence|tone|signals)$/.test(source.hash)) fragment=source.hash;
      }
    } catch { /* The saved report ID remains usable without an optional reading focus. */ }
  }
  return "/report?" + params.toString() + fragment;
}

/** Explicit local destinations, with a bounded return to the report being read. */
export function reportOutboundHref(destination:string, context:ReportReturnContext):string {
  if(!destination.startsWith('/')||destination.startsWith('//')||/[\\\u0000-\u001f]/.test(destination))return '/reports';
  try {
    const target=new URL(destination,'https://report-return.invalid');
    if(target.origin!=='https://report-return.invalid'||!['/report','/archive','/analyze','/capture'].includes(target.pathname))return '/reports';
    target.searchParams.set('returnTo',reportReturnHref(context));
    return target.pathname+target.search+target.hash;
  }catch{return '/reports';}
}
