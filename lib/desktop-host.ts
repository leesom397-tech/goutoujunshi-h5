/** The desktop preload exposes only these three fixed capabilities. */
export type DesktopRuntimeState = {
  platform: "win32" | "darwin";
  version: string;
  collectorStatus: "stopped" | "starting" | "ready" | "error";
  message?: string;
};
export type DesktopHost = {
  connectCollector(): Promise<{ handoff: string }>;
  openCollectorSetup(): Promise<{ opened: boolean }>;
  getRuntimeState(): Promise<DesktopRuntimeState>;
};

declare global { interface Window { chengziDesktop?: DesktopHost } }

const origin = "https://coach.lovetalk.love";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const invalid = () => new Error("桌面应用返回了无法识别的状态，请重新打开应用。");

/** Replace browser-only transport guidance; pairing and service errors stay intact. */
export function desktopConnectionMessage(value: string): string {
  if (/^(?:浏览器已禁止本站连接本机助手|浏览器尚未允许连接本机助手|未能连接本机助手。请先启动助手)/.test(value)) return "未能连接内置采集工具，请打开本机采集设置检查状态后重试。";
  if (value.startsWith("连接本机采集助手超时。")) return "连接内置采集工具超时，请打开本机采集设置检查状态后重试。";
  if (value.startsWith("连接本机助手需要 HTTPS 网页")) return "本机采集连接环境异常，请重新打开成子桌面应用。";
  return value;
}

/** No UA sniffing or Node access: ordinary browsers keep their existing flow. */
export function getDesktopHost(): DesktopHost | null {
  if (typeof window === "undefined" || window.location.origin !== origin || window.top !== window) return null;
  const host = window.chengziDesktop;
  if (!host || ![host.connectCollector, host.openCollectorSetup, host.getRuntimeState].every(method => typeof method === "function")) return null;
  return {
    async connectCollector() {
      const value: unknown = await host.connectCollector();
      if (!record(value) || typeof value.handoff !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.handoff)) throw invalid();
      // A one-time exchange secret is returned only to the existing pairing flow.
      return { handoff: value.handoff };
    },
    async openCollectorSetup() {
      const value: unknown = await host.openCollectorSetup();
      if (!record(value) || typeof value.opened !== "boolean") throw invalid();
      return { opened: value.opened };
    },
    async getRuntimeState() {
      const value: unknown = await host.getRuntimeState();
      if (!record(value) || typeof value.platform !== "string" || !["win32", "darwin"].includes(value.platform) || typeof value.version !== "string" || !/^[0-9A-Za-z.+_-]{1,80}$/.test(value.version) || typeof value.collectorStatus !== "string" || !["stopped", "starting", "ready", "error"].includes(value.collectorStatus)) throw invalid();
      return {
        platform: value.platform as DesktopRuntimeState["platform"],
        version: value.version,
        collectorStatus: value.collectorStatus as DesktopRuntimeState["collectorStatus"],
        ...(typeof value.message === "string" ? { message: value.message.slice(0, 500) } : {}),
      };
    },
  };
}
