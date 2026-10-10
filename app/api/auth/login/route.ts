import { env } from "cloudflare:workers";
import { nativeLogin } from "@/lib/web-native-auth.mjs";
export const runtime = "edge";
export async function POST(request: Request) { return nativeLogin(request, env); }
