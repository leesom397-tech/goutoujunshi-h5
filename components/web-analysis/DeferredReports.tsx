"use client";

import { Component, Suspense, lazy, useMemo, type ComponentProps, type ComponentType, type ReactNode } from "react";

class ViewBoundary extends Component<{ children: ReactNode; recovery: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="web-notice">{this.props.recovery}</div>;
    return this.props.children;
  }
}

function DeferredView<P extends object>({ loader, viewProps, recovery }: { loader: () => Promise<{ default: ComponentType<P> }>; viewProps: P; recovery: ReactNode }) {
  const View = useMemo(() => lazy(loader), [loader]);
  return <ViewBoundary recovery={recovery}><Suspense fallback={<p role="status" aria-live="polite">正在打开报告…</p>}><View {...viewProps}/></Suspense></ViewBoundary>;
}

const loadChat = () => import("./ReportView").then(module => ({ default: module.ChatReport }));
const loadSocial = () => import("./SocialReport").then(module => ({ default: module.SocialReport }));
const loadExample = () => import("./AnalysisExample").then(module => ({ default: module.AnalysisExample }));

function savedReportRecovery(report: { reportId?: string; id?: string }) {
  const id=report.reportId||report.id;
  // A full document navigation recovers even when a failed dependency import is
  // cached by the browser. Keep this intake tab and its unsubmitted files intact.
  return <><p>报告的显示资源暂时没加载成功。打开已保存的报告不会重新分析或扣积分。</p><a className="web-btn web-btn-secondary" href={id?`/report?id=${encodeURIComponent(id)}`:'/history'} target="_blank" rel="noopener noreferrer">在新页面打开已保存报告</a></>;
}
export function DeferredChatReport(props: ComponentProps<typeof import("./ReportView").ChatReport>) { return <DeferredView loader={loadChat} viewProps={props} recovery={savedReportRecovery(props.report)}/>; }
export function DeferredSocialReport(props: ComponentProps<typeof import("./SocialReport").SocialReport>) { return <DeferredView loader={loadSocial} viewProps={props} recovery={savedReportRecovery(props.report)}/>; }
export function DeferredAnalysisExample(props: ComponentProps<typeof import("./AnalysisExample").AnalysisExample>) { return <DeferredView loader={loadExample} viewProps={props} recovery={<><p>示例暂时没加载成功，你仍可以继续上传材料。</p><a className="web-btn web-btn-secondary" href={`/analyze?mode=${encodeURIComponent(props.mode)}&example=1`} target="_blank" rel="noopener noreferrer">在新页面重试示例</a></>}/>; }
