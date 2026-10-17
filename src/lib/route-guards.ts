/**
 * Pre-render routing guards, shared by `src/proxy.ts` and its tests.
 *
 * `/` renders one screen: the boards for a visitor **with** a session, the
 * landing for everyone else. The landing keeps a route of its own so it stays a
 * statically prerendered page, and `/` is *rewritten* to it rather than
 * redirected — an anonymous visitor's address bar keeps saying `/`, the address
 * the marketing page is published under. That route redirects back to `/`, so
 * `/` is the only address the landing ever wears.
 *
 * The only signal available before a route renders is the Better Auth session
 * cookie, and it is *read* here, never validated, so every rule has to be
 * one-way: a rule that can send a visitor back where it came from is an endless
 * loop:
 *
 * * `/` with a session is the boards (`next`);
 * * `/` without one is rewritten to the landing;
 * * `/?signin=1` — the fallback `useRequireAuth` navigates to — is the landing
 *   **whatever the cookie says**, because a stale cookie is exactly when the
 *   proxy and the client disagree about who is signed in. Without that rule the
 *   disagreement becomes `/` → `/‹id›` → `/?signin=1` forever;
 * * `/signin` and `/signup` redirect, so the addresses the sign-in card used to
 *   have still work.
 */

export type RouteGuard =
  | { action: "next" }
  | { action: "rewrite"; to: string }
  | { action: "redirect"; to: string };

export const HOME_ROUTE = "/";
/** The landing's own route: what `/` is rewritten to, and a redirect to `/`. */
export const WELCOME_ROUTE = "/welcome";
export const ACCOUNT_ROUTE = "/account";

/** Query flag the landing's sign-in dialog opens itself on. */
export const SIGN_IN_QUERY = "signin";

/** Home with the sign-in dialog open — where the guards send an anonymous visitor. */
export const SIGN_IN_DIALOG_ROUTE = `${HOME_ROUTE}?${SIGN_IN_QUERY}=1`;

/** Removed routes, and where a link to one goes now. */
const LEGACY_ROUTES: Readonly<Record<string, string>> = {
  // The passkey card was a page; it is a dialog on the landing now.
  "/signin": SIGN_IN_DIALOG_ROUTE,
  "/signup": SIGN_IN_DIALOG_ROUTE,
};

/**
 * `/<id>` — a board. Convex ids are lowercase alphanumerics, so exactly one
 * such segment is a board: `/foo/bar` is not, and neither is a file request
 * like `/favicon.ico`.
 */
const BOARD_PATH = /^\/[a-z0-9]+$/;

function needsSession(pathname: string): boolean {
  return pathname === ACCOUNT_ROUTE || BOARD_PATH.test(pathname);
}

export function guardRoute(
  pathname: string,
  hasSession: boolean,
  requestsSignIn = false,
): RouteGuard {
  const legacy = LEGACY_ROUTES[pathname];
  if (legacy !== undefined) return { action: "redirect", to: legacy };

  // The landing answers to `/` alone; this is the way in for the rewrite.
  if (pathname === WELCOME_ROUTE) return { action: "redirect", to: HOME_ROUTE };

  if (pathname === HOME_ROUTE) {
    return hasSession && !requestsSignIn
      ? { action: "next" }
      : { action: "rewrite", to: WELCOME_ROUTE };
  }

  if (hasSession) return { action: "next" };

  return needsSession(pathname)
    ? { action: "redirect", to: SIGN_IN_DIALOG_ROUTE }
    : { action: "next" };
}
