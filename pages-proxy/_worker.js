export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "coach.lovetalk.love" && url.pathname === "/rEKgJtA1hJ.txt") {
      return new Response("1788b9a0eec49a67c57c8125ea43c372", {
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    if (!env.COACH) return new Response("服务暂不可用。", { status: 503 });
    return env.COACH.fetch(request);
  },
};
