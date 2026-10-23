import type { ReplyPaths as Paths } from "@/lib/reply-paths";

export function ReplyPaths({ paths }: { paths?: Paths }) {
  if (!paths) return null;
  return <details className="reply-paths"><summary>发出这句后，三种情况怎么接？</summary><dl><div><dt>TA 积极接话</dt><dd>{paths.positive}</dd></div><div><dt>TA 含糊或暂未回应</dt><dd>{paths.unclear}</dd></div><div><dt>TA 拒绝或不舒服</dt><dd>{paths.stop}</dd></div></dl><small>这是不同反馈下的应对备选，不是对 TA 反应的预测。</small></details>;
}
