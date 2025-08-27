// src/middleware.ts
import { NextResponse, NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const path = url.pathname;

  // ✅ Allow public routes
  const publicPaths = ["/welcome", "/api/verify-beta-access", "/api/check-verification", "/_next", "/favicon.ico"];
  if (publicPaths.some((p) => path.startsWith(p))) {
    return NextResponse.next();
  }

  // ✅ Require verification for all other pages
  const verified = req.cookies.get("human_verified");
  if (!verified) {
    url.pathname = "/welcome";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// ✅ Apply middleware to all routes except static files
export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
