import { env } from "cloudflare:workers";
import { nativeLogout } from "@/lib/web-native-auth.mjs";
export const runtime = "edge";
export async function POST(request: Request) { return nativeLogout(request, env); }
