import { env } from "cloudflare:workers";
import { phoneRegister } from "@/lib/web-phone-register.mjs";
export const runtime = "edge";
export async function POST(request: Request) { return phoneRegister(request, env); }
