import type { PersonalEvidence, PersonalInsight } from "./personal-context";

// Questions use the topic actually supported by the selected sources. They do
// not invent a shared experience, a date, pet ownership or a willingness to meet.
const questions: Record<string, string> = {
  photography: "你平时拍照更喜欢记录人，还是沿途看到的风景？",
  art: "最近有没有哪个展览或作品，让你看完还会想起？",
  career: "最近做的事情里，哪一件最让你有成就感？",
  travel: "你旅行时更喜欢提前规划，还是到了再随意走走？",
  outdoors: "你平时更喜欢轻松走走，还是稍有挑战的户外活动？",
  exercise: "你最近最享受哪项运动？是放松下来，还是突破自己的感觉？",
  music: "最近有没有一首一直在循环听的歌？",
  reading: "最近读到的东西里，有没有一段让你特别有共鸣？",
  film: "最近有没有一部看完还想和别人聊聊的电影或剧？",
  food: "说到吃，你更享受找一家好店，还是自己动手做？",
  coffee: "你更喜欢咖啡还是茶？平时一般喝什么口味？",
  pets: "说到宠物，你更喜欢猫还是狗？最喜欢它们哪一点？",
  games: "你平时更喜欢轻松玩一会儿，还是认真琢磨玩法？",
  craft: "做手作时，你最享受过程里的哪一步？",
  quiet: "你平时想放松一下时，更喜欢自己待会儿，还是找人聊聊天？",
  honesty: "如果想法不一样，你更喜欢当下聊清楚，还是缓一缓再说？",
  growth: "最近有没有一件你挺想学会，或者想慢慢做好的事？",
  planning: "平时约时间，你更喜欢提前定下来，还是临近再确认？",
  expectation: "你现在更希望两个人以怎样的节奏了解彼此？",
};

export function personalConversationStarter(item: PersonalInsight, sources: PersonalEvidence[]) {
  if (!item || !Array.isArray(item.evidenceIds) || !Array.isArray(sources)) return "";
  const selected = sources.filter(source => item.evidenceIds.includes(source.id) && source.quote.trim() && source.basis !== "observation");
  if (!selected.some(source => source.side === "other")) return "";
  if (item.id.startsWith("common-") && !selected.some(source => source.side === "self")) return "";
  if (!/^(common|entry|topic)-/.test(item.id)) return "";
  return questions[item.id.replace(/^(common|entry|topic)-/, "")] || "";
}
