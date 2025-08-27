// src/app/api/verify-beta-access/route.ts
import { NextResponse } from "next/server";
import { failedAttempts } from "../_banStore"; // ✅ import shared store

// Levenshtein distance for fuzzy matching
function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

// ✅ Allowed answers
const allowedAnswers = ["shekhar paudel", "paudel", "shekharpaudel.com"];

export async function POST(req: Request) {
  const start = Date.now();
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  const ua = req.headers.get("user-agent") || "unknown";
  const clientKey = `${ip}|${ua}`;
  const url = new URL(req.url);
  const now = Date.now();
  let statusCode = 200;

  try {
    const attempt = failedAttempts[clientKey];

    // ✅ If already banned, enforce ban
    if (attempt && now < attempt.banUntil) {
      const remaining = Math.ceil((attempt.banUntil - now) / 1000);
      statusCode = 429;

      // ✅ Log ban info to server terminal
      console.table([
        {
          Key: clientKey,
          IP: ip,
          UserAgent: ua,
          Failures: attempt.count,
          Honeypot: attempt.filledHoneypot ? "YES" : "NO",
          Ban_Until: new Date(attempt.banUntil).toISOString(),
          Remaining_s: remaining,
        },
      ]);

      const res = NextResponse.json(
        { success: false, error: `Too many failed attempts. Try again in ${remaining}s.` },
        { status: statusCode },
      );
      console.log(`POST ${url.pathname} ${statusCode} in ${Date.now() - start}ms`);
      return res;
    }

    const { answer, website } = await req.json();

    // ✅ Honeypot detection
    if (website && website.trim() !== "") {
      console.warn(`[BOT DETECTED] IP: ${ip}, UA: ${ua}`);
      // Mark as bot
      failedAttempts[clientKey] = {
        ip,
        userAgent: ua,
        count: (attempt?.count || 0) + 1,
        lastAttempt: now,
        banUntil: now + 600000, // 10 minutes ban
        filledHoneypot: true,
      };
      return NextResponse.json({ success: false, error: "Bot detected" }, { status: 400 });
    }

    // ✅ Fuzzy match check
    const input = answer.toLowerCase().trim();
    const isHuman = allowedAnswers.some((target) => levenshtein(input, target) <= 2);

    if (isHuman) {
      // ✅ Success: clear failed attempts
      delete failedAttempts[clientKey];
      const res = NextResponse.json({ success: true });
      res.cookies.set("human_verified", "true", {
        httpOnly: true,
        path: "/",
        maxAge: 3600, // 1 hour
        secure: process.env.NODE_ENV === "production",
      });
      console.log(`POST ${url.pathname} 200 in ${Date.now() - start}ms`);
      return res;
    } else {
      // ✅ Failed attempt → exponential backoff ban
      const prevCount = attempt?.count || 0;
      const newCount = prevCount + 1;
      const banDuration = 10000 * Math.pow(2, newCount - 1); // 10s, 20s, 40s...

      failedAttempts[clientKey] = {
        ip,
        userAgent: ua,
        count: newCount,
        lastAttempt: now,
        banUntil: now + banDuration,
        filledHoneypot: attempt?.filledHoneypot || false,
      };

      // ✅ Log ban info to server terminal
      console.table([
        {
          Key: clientKey,
          IP: ip,
          UserAgent: ua,
          Failures: newCount,
          Honeypot: "NO",
          Ban_Until: new Date(now + banDuration).toISOString(),
          Remaining_s: Math.ceil(banDuration / 1000),
        },
      ]);

      statusCode = 403;
      const res = NextResponse.json(
        { success: false, error: `❌ Incorrect. Try again in ${Math.ceil(banDuration / 1000)}s.` },
        { status: statusCode },
      );
      console.log(`POST ${url.pathname} ${statusCode} in ${Date.now() - start}ms`);
      return res;
    }
  } catch (err) {
    console.error("API Error:", err);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
