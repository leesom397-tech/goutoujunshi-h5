import { env } from "cloudflare:workers";
import { sendRegistrationCode } from "@/lib/web-phone-register.mjs";
export const runtime = "edge";
export async function POST(request: Request) { return sendRegistrationCode(request, env); }
