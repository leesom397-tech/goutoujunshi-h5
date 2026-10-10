import { getChatGPTUser } from "@/app/chatgpt-auth";
export const runtime = "edge";
export async function GET() {
  const user = await getChatGPTUser();
  return Response.json({ loggedIn: !!user, user: user ? { id: user.userId, name: user.displayName } : null }, {
    headers: { "Cache-Control": "no-store" },
  });
}
