/**
 * Pre-render routing guards, shared by `src/proxy.ts` and its tests.
 *
 * The only signal available before a route renders is the Better Auth session
 * cookie, and it is *not* validated here (no round-trip to Convex), so the
 * rules stay one-way:
 *
 * * a visitor **with** a session asking for `/` is *rewritten* to the
 *   dashboard — the address bar keeps `/`, the landing stays a static page for
 *   everyone else, and nothing flashes for a signed-in visitor;
 * * a visitor **without** one is sent to `/signin` from the screens that need a
 *   session, instead of painting a skeleton and redirecting from the client.
 *
 * `/signin` is deliberately never redirected from here. A stale cookie would
 * otherwise bounce `/` → `/signin` → `/` for ever; the sign-in screen itself
 * sends a visitor with a live session home once the session query settles.
 */

export type RouteGuard =
  | { action: "next" }
  | { action: "rewrite"; to: string }
  | { action: "redirect"; to: string };

/** Routes that need a session, matched by segment prefix. */
const SESSION_PREFIXES = ["/app", "/account"] as const;

export const HOME_ROUTE = "/";
export const SIGN_IN_ROUTE = "/signin";
export const DASHBOARD_ROUTE = "/app";

/** Matches `/app` and `/app/…` but not `/application`. */
function needsSession(pathname: string): boolean {
  return SESSION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function guardRoute(pathname: string, hasSession: boolean): RouteGuard {
  if (hasSession) {
    return pathname === HOME_ROUTE
      ? { action: "rewrite", to: DASHBOARD_ROUTE }
      : { action: "next" };
  }

  return needsSession(pathname)
    ? { action: "redirect", to: SIGN_IN_ROUTE }
    : { action: "next" };
}
