/**
 * Full-page navigation used after a passkey ceremony succeeded.
 *
 * A soft `router.push` is not enough here: the passkey plugin only notifies
 * the client's session signal on `verify-authentication`. Right after
 * sign-up (`verify-registration`), or after signing in through browser
 * autofill, the Convex auth-token provider still holds the old (anonymous)
 * session, so a client-side transition can render the destination as signed
 * out. A real reload re-runs the provider against the freshly set cookie.
 */
export function hardNavigate(href: string): void {
  window.location.assign(href);
}
