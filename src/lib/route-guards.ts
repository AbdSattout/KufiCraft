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
 * * a visitor **without** one is sent to the landing with the sign-in dialog
 *   already open (`/?signin=1`), instead of painting a skeleton and redirecting
 *   from the client. There is no sign-in *page* to point at: the dialog lives on
 *   the landing, and `SIGN_IN_DIALOG_ROUTE` is the one place that says so.
 * * `/signin` and `/signup` are kept as redirects for old links — the routes
 *   were removed, so anything still linking to them ends up in the dialog.
 *
 * Note the asymmetry the guards must live with: `/` *is* bounced on the cookie,
 * while `/?signin=1` is the same URL. A stale cookie therefore lands a visitor
 * on the dashboard, whose client guard clears that cookie before coming home
 * (`useRequireAuth`) — the one path that could otherwise ping-pong.
 */

export type RouteGuard =
  | { action: "next" }
  | { action: "rewrite"; to: string }
  | { action: "redirect"; to: string };

/** Routes that need a session, matched by segment prefix. */
const SESSION_PREFIXES = ["/app", "/account"] as const;

/** Routes that used to render the passkey card; they only open the dialog now. */
const LEGACY_SIGN_IN_ROUTES: readonly string[] = ["/signin", "/signup"];

export const HOME_ROUTE = "/";
export const DASHBOARD_ROUTE = "/app";

/** Query flag the landing's sign-in dialog opens itself on. */
export const SIGN_IN_QUERY = "signin";

/** Home with the sign-in dialog open — where the guards send an anonymous visitor. */
export const SIGN_IN_DIALOG_ROUTE = `${HOME_ROUTE}?${SIGN_IN_QUERY}=1`;

/** Matches `/app` and `/app/…` but not `/application`. */
function needsSession(pathname: string): boolean {
  return SESSION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function guardRoute(pathname: string, hasSession: boolean): RouteGuard {
  if (LEGACY_SIGN_IN_ROUTES.includes(pathname)) {
    return { action: "redirect", to: SIGN_IN_DIALOG_ROUTE };
  }

  if (hasSession) {
    return pathname === HOME_ROUTE
      ? { action: "rewrite", to: DASHBOARD_ROUTE }
      : { action: "next" };
  }

  return needsSession(pathname)
    ? { action: "redirect", to: SIGN_IN_DIALOG_ROUTE }
    : { action: "next" };
}
