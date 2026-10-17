import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { guardRoute, SIGN_IN_QUERY } from "@/lib/route-guards";

/**
 * Routing guards that run before any route renders — see
 * `src/lib/route-guards.ts` for the rules, and for why `/?signin=1` is never
 * rewritten back to the boards.
 *
 * The session cookie is only *read* here (never validated), which is what keeps
 * the landing statically prerendered: `/` is rewritten to `/welcome` for a
 * visitor without a session instead of rendering both and swapping them.
 */
export function proxy(request: NextRequest) {
  const decision = guardRoute(
    request.nextUrl.pathname,
    getSessionCookie(request) !== null,
    request.nextUrl.searchParams.has(SIGN_IN_QUERY),
  );

  if (decision.action === "next") return NextResponse.next();

  const target = new URL(decision.to, request.nextUrl.origin);

  return decision.action === "rewrite"
    ? NextResponse.rewrite(target)
    : NextResponse.redirect(target);
}

export const config = {
  matcher: [
    "/",
    "/welcome",
    "/account",
    "/signin",
    "/signup",
    // A board. Any other single segment behaves the same way — a board link is
    // the only root-level screen there is.
    "/:projectId",
  ],
};
