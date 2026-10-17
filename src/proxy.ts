import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { guardRoute } from "@/lib/route-guards";

/**
 * Routing guards that run before any route renders — see
 * `src/lib/route-guards.ts` for the rules and for why `/signin` is left alone.
 *
 * The session cookie is only *read* here (never validated), which keeps the
 * landing statically prerendered and the signed-in home flash-free: `/` is
 * rewritten to the dashboard instead of rendering the landing and swapping it.
 */
export function proxy(request: NextRequest) {
  const decision = guardRoute(
    request.nextUrl.pathname,
    getSessionCookie(request) !== null,
  );

  if (decision.action === "next") return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = decision.to;

  return decision.action === "rewrite"
    ? NextResponse.rewrite(target)
    : NextResponse.redirect(target);
}

export const config = {
  matcher: ["/", "/account", "/app", "/app/:path*"],
};
