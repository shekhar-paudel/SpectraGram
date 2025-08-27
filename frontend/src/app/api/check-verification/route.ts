import { NextResponse } from "next/server";
import { failedAttempts } from "../_banStore"; // ✅ reuse same store

export async function GET(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const ua = req.headers.get("user-agent") || "unknown";
  const clientKey = `${ip}|${ua}`;

  const attempt = failedAttempts[clientKey];
  const now = Date.now();

  let cooldown = 0;
  if (attempt && now < attempt.banUntil) {
    cooldown = Math.ceil((attempt.banUntil - now) / 1000);
  }

  const verified = Boolean(req.headers.get("cookie")?.includes("human_verified=true"));
  return NextResponse.json({ verified, cooldown });
}
