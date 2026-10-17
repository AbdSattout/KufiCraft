/**
 * Pre-render routing guards, shared by `src/proxy.ts` and its tests.
 *
 * Two screens claim the root URL: `/` is the boards for a visitor **with** a
 * session, and the landing for everyone else — served from `/welcome` so both
 * stay statically prerendered and the landing keeps `/` as its address (a
 * rewrite leaves the browser URL alone). The only signal available before a
 * route renders is the Better Auth session cookie, and it is *read* here, never
 * validated, so every rule has to be one-way — a rule that can send a visitor
 * back where it came from is an endless loop:
 *
 * * `/` with a session is the boards (`next`);
 * * `/` without one is rewritten to `/welcome`;
 * * `/?signin=1` — the fallback `useRequireAuth` navigates to — is the landing
 *   **whatever the cookie says**, because a stale cookie is exactly when the
 *   proxy and the client disagree about who is signed in. Without that rule the
 *   disagreement becomes `/` → `/‹id›` → `/?signin=1` forever.
 * * `/app` (the boards' old address), `/signin` and `/signup` redirect, so old
 *   links keep working.
 */

export type RouteGuard =
  | { action: "next" }
  | { action: "rewrite"; to: string }
  | { action: "redirect"; to: string };

export const HOME_ROUTE = "/";
/** The landing, which `/` is rewritten to for a visitor without a session. */
export const WELCOME_ROUTE = "/welcome";
export const ACCOUNT_ROUTE = "/account";

/** Query flag the landing's sign-in dialog opens itself on. */
export const SIGN_IN_QUERY = "signin";

/** Home with the sign-in dialog open — where the guards send an anonymous visitor. */
export const SIGN_IN_DIALOG_ROUTE = `${HOME_ROUTE}?${SIGN_IN_QUERY}=1`;

/** Routes that moved or were removed; the value is their replacement. */
const LEGACY_ROUTES: ReadonlyArray<readonly [from: string, to: string]> = [
  // The boards were `/app`; the editor was `/app/<id>`.
  ["/app", HOME_ROUTE],
  // The passkey card was a page; it is a dialog on the landing now.
  ["/signin", SIGN_IN_DIALOG_ROUTE],
  ["/signup", SIGN_IN_DIALOG_ROUTE],
];

/**
 * `/<id>` — a board. Convex ids are lowercase alphanumerics, so exactly one
 * such segment is a board: `/foo/bar` is not, and neither is a file request
 * like `/favicon.ico`. The landing's own path is spelled the same way, which is
 * why it is named before the pattern is tried.
 */
const BOARD_PATH = /^\/[a-z0-9]+$/;

function needsSession(pathname: string): boolean {
  if (pathname === WELCOME_ROUTE) return false;
  return pathname === ACCOUNT_ROUTE || BOARD_PATH.test(pathname);
}

export function guardRoute(
  pathname: string,
  hasSession: boolean,
  requestsSignIn = false,
): RouteGuard {
  for (const [from, to] of LEGACY_ROUTES) {
    if (pathname === from) return { action: "redirect", to };
    // `/app/<id>` → `/<id>`: the tail is the replacement.
    if (pathname.startsWith(`${from}/`)) {
      return { action: "redirect", to: pathname.slice(from.length) };
    }
  }

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
