import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("miniapp/pages/social-profile/index.js", "utf8");
const markup = readFileSync("miniapp/pages/social-profile/index.wxml", "utf8");
const moments = readFileSync("miniapp/components/moments-report.wxml", "utf8");
const scrolls = [];
const previews = [];
const followups = [];
let followupFailure = false;
let releaseFollowup = null;
let definition;
new Function("require", "Page", "wx", source)(
  name => name.endsWith("followup-context") ? { async openReportFollowup(value) { followups.push(value); if (followupFailure) throw new Error("暂时无法打开"); if (releaseFollowup) await new Promise(resolve => { releaseFollowup = resolve; }); } } : {},
  value => { definition = value; },
  { pageScrollTo(value) { scrolls.push(value); }, previewImage(value) { previews.push(value); } }
);
const page = () => ({
  ...definition,
  data: structuredClone(definition.data),
  setData(value) { Object.assign(this.data, value); }
});
const event = dataset => ({ currentTarget: { dataset } });

const navigation = page();
navigation.jumpToSection(event({ section: "evidence" }));
assert.equal(scrolls.length, 0, "no report means no dead navigation");
navigation.data.result = { hypotheses: [] };
for (const section of ["findings", "actions", "evidence"]) navigation.jumpToSection(event({ section }));
assert.deepEqual(scrolls.map(item => item.selector), ["#profile-findings", "#profile-actions", "#social-evidence"]);
navigation.data.result = { moments: {} };
for (const section of ["findings", "actions", "evidence"]) navigation.jumpToSection(event({ section }));
assert.deepEqual(scrolls.slice(3).map(item => item.selector), ["#moments-findings", "#moments-actions", "#moments-statistics"]);
navigation.jumpToSection(event({ section: "unknown" }));
assert.equal(scrolls.length, 6, "invalid section cannot become an arbitrary selector");
for (const { selector } of scrolls) assert.ok((markup + moments).includes('id="' + selector.slice(1) + '"'), selector + " has a real target");

const gallery = page();
gallery.data.images = [{ path: "/first.png" }, { path: "/second.png" }];
gallery.previewImage(event({ index: "1" }));
assert.deepEqual(previews[0], { current: "/second.png", urls: ["/first.png", "/second.png"] }, "preview keeps upload order and opens the selected screenshot");
for (const index of [-1, 2, "invalid", undefined]) {
  gallery.previewImage(event({ index }));
}
assert.equal(previews.length, 1, "invalid gallery indices do not open previews");

const states = ["showReportDetails", "showFitDetails", "showMomentsDetails", "showMomentsTimeline"];
for (const action of ["startNewProfile", "materialChange", "targetChange", "personChange"]) {
  const screen = page();
  Object.assign(screen.data, Object.fromEntries(states.map(key => [key, true])));
  Object.assign(screen.data, { agreed: true, totalCount: 1, result: { summary: "previous" }, people: [{ id: "", label: "暂不归档" }, { id: "person-b", label: "乙" }] });
  if (action === "materialChange") screen[action](event({ type: "moments" }));
  else if (action === "targetChange") screen[action](event({ target: "self" }));
  else if (action === "personChange") screen[action]({ detail: { value: "1" } });
  else screen[action]();
  for (const key of states) assert.equal(screen.data[key], false, action + " resets " + key);
  assert.equal(screen.data.agreed, false, "new material context needs fresh consent");
  assert.equal(screen.data.result, null, "new material context clears the previous report");
}
const busy = page();
busy.data.busy = true;
busy.data.result = { summary: "in progress" };
busy.materialChange(event({ type: "moments" }));
assert.equal(busy.data.result.summary, "in progress", "display changes do not interrupt active work");
busy.data.busy = false;
busy.data.backgroundPending = true;
busy.materialChange(event({ type: "moments" }));
assert.equal(busy.data.result.summary, "in progress", "background work keeps its existing material context");

const input = page();
input.toggleUploadHelp();
input.togglePrivacyDetails();
assert.equal(input.data.showUploadHelp, true);
assert.equal(input.data.showPrivacyDetails, true);
assert.equal(input.data.agreed, false, "reading help must never tick analysis consent");
input.agree({ detail: { value: ["yes"] } });
input.togglePrivacyDetails();
assert.equal(input.data.agreed, true, "collapsing disclosure does not alter explicit consent");

const discussion = page();
discussion._token = "synthetic-token";
discussion.data.people = [{ id: "stale-person", label: "上次人物" }];
await discussion.continueDiscussion();
assert.equal(followups.length, 0, "no report means no empty follow-up");
discussion.data.result = { summary: "人物总评", hypotheses: [{ title: "倾向", possibility: "可能更喜欢具体交流", evidence: "图一原文", alternative: "也可能只是公开展示", verify: "观察下一次回应" }], approach: { attitude: "轻松具体", evidence: "图二原文", adjustWhen: "对方开始主动追问" } };
await discussion.continueDiscussion();
assert.equal(followups.at(-1).subjectId, "", "unbound reports never borrow current or previously selected person");
assert.equal(followups.at(-1).source, "social-profile");
assert.equal(followups.at(-1).token, "synthetic-token");
for (const retained of ["人物总评", "待验证推测", "图一原文", "也可能只是公开展示", "轻松具体", "何时调整"]) assert.ok(followups.at(-1).summary.includes(retained), "follow-up retains " + retained);
assert.equal(discussion.data.agreed, false, "opening follow-up never grants analysis consent");
discussion._reportSubjectId = "captured-person";
await discussion.continueDiscussion();
assert.equal(followups.at(-1).subjectId, "captured-person", "follow-up uses the person captured for this report");
discussion.data.result.subjectId = "report-person";
discussion.data.result.id = "report-id";
await discussion.continueDiscussion();
assert.equal(followups.at(-1).subjectId, "report-person", "explicit report identity takes precedence");
assert.equal(followups.at(-1).reportId, "report-id");
discussion.data.targetSelf = true;
await discussion.continueDiscussion();
assert.equal(followups.at(-1).subjectId, "", "self-analysis cannot use someone else's archive");
assert.ok(followups.at(-1).summary.includes("我自己的资料"));
discussion.data.result.moments = { summary: "朋友圈总评".repeat(1000), hypotheses: [{ possibility: "朋友圈倾向", evidence: "动态一" }] };
await discussion.continueDiscussion();
assert.equal(followups.at(-1).source, "moments");
assert.ok(followups.at(-1).summary.includes("朋友圈倾向"));
assert.ok(followups.at(-1).summary.length <= 1050, "context remains bounded before shared utility validation");
releaseFollowup = true;
const waitingFollowup = discussion.continueDiscussion();
const pendingCount = followups.length;
await discussion.continueDiscussion();
assert.equal(followups.length, pendingCount, "repeated taps cannot open duplicate chats");
releaseFollowup(); releaseFollowup = null;
await waitingFollowup;
assert.equal(discussion.data.followupBusy, false);
followupFailure = true;
await discussion.continueDiscussion();
assert.equal(discussion.data.error, "暂时无法打开", "navigation failures leave the report with a readable retry message");
assert.ok(discussion.data.result);
assert.equal(discussion.data.followupBusy, false);

assert.ok(markup.indexOf('class="profile-verdict"') < markup.indexOf('class="group hypotheses featured"'));
assert.ok(markup.indexOf('class="group hypotheses featured"') < markup.indexOf("approach:result.approach"), "profile findings precede communication advice");
assert.ok(markup.indexOf('id="profile-actions"') < markup.indexOf("{{item.verify}}"), "individual suggested actions belong to the action section");
assert.ok(moments.indexOf("report.summary") < moments.indexOf("report.hasHypotheses"));
assert.ok(moments.indexOf("report.hasHypotheses") < moments.indexOf("report.approach"));
assert.ok(moments.indexOf("report.hasStarters") < moments.indexOf("report.statistics.hasContent"));
assert.equal((markup.match(/\{\{item.possibility\}\}/g) || []).length, 1, "profile inference has one presentation");
assert.equal((moments.match(/\{\{item.possibility\}\}/g) || []).length, 1, "moments inference has one presentation");
assert.ok(moments.indexOf('class="moments-source-button"') < moments.indexOf("report.approach"), "evidence is reachable next to visible findings");
for (const field of ["statistics.hasContent", "statistics.hasCopy", "statistics.hasSummaries", "statistics.hasMilestones", "hasPosts", "hasBehaviorClues", "visibility", "themes", "photoClues", "commonPoints", "fitSummary"]) assert.ok(moments.includes("report." + field), "retain moments " + field);
for (const field of ["riskSignals", "commonPoints", "fit", "photoClues", "profileBasics", "visibleFacts", "positives", "cautions", "unknowns", "questions", "nextMaterials", "knowledgeSources"]) assert.ok(markup.includes("result." + field), "retain profile " + field);
for (const fact of ["最多 9 张", "阿里云百炼", "临时图片副本", "取回结果或取消上传", "任务过期后再次处理", "基础资料只在成子服务端", "关系偏好会随本次图片", "服务端图片仅用于本次后台处理", "基础信息和截图线索待逐条确认"]) assert.ok(markup.includes(fact), "retain disclosure: " + fact);
assert.ok(markup.includes('wx:if="{{result && error}}"'), "archive errors remain visible after the input form is replaced by a report");
for (const match of (markup + moments).matchAll(/bind(?:tap|change|input)="([^"]+)"/g)) assert.equal(typeof definition[match[1]], "function", "bound handler exists: " + match[1]);
console.log("PASS social experience: report navigation, source access, gallery order, context resets, consent isolation, scoped follow-up and full report coverage");
