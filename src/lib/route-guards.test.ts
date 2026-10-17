import { describe, expect, it } from "vitest";
import { guardRoute } from "./route-guards";

describe("guardRoute", () => {
  it("leaves `/` alone for a visitor with a session — the boards live there", () => {
    expect(guardRoute("/", true)).toEqual({ action: "next" });
  });

  it("rewrites `/` to the landing for an anonymous visitor", () => {
    expect(guardRoute("/", false)).toEqual({ action: "rewrite", to: "/welcome" });
  });

  it("always renders the landing for `/?signin=1`, cookie or not", () => {
    // The rule that keeps a stale cookie from ping-ponging: the guards' own
    // fallback may never bounce back to the boards.
    expect(guardRoute("/", true, true)).toEqual({
      action: "rewrite",
      to: "/welcome",
    });
    expect(guardRoute("/", false, true)).toEqual({
      action: "rewrite",
      to: "/welcome",
    });
  });

  it("sends the landing's own address back to `/`, cookie or not", () => {
    expect(guardRoute("/welcome", true)).toEqual({
      action: "redirect",
      to: "/",
    });
    expect(guardRoute("/welcome", false)).toEqual({
      action: "redirect",
      to: "/",
    });
  });

  it.each(["/account", "/j57195vyzfcckg0dv469vz6bzs8ge42s"])(
    "sends an anonymous visitor from %s home with the sign-in dialog",
    (pathname) => {
      expect(guardRoute(pathname, false)).toEqual({
        action: "redirect",
        to: "/?signin=1",
      });
    },
  );

  it("lets a signed-in visitor through to the session screens", () => {
    expect(guardRoute("/account", true)).toEqual({ action: "next" });
    expect(guardRoute("/my-board", true)).toEqual({ action: "next" });
  });

  it("matches whole segments only", () => {
    expect(guardRoute("/foo/bar", false)).toEqual({ action: "next" });
    expect(guardRoute("/favicon.ico", false)).toEqual({ action: "next" });
    expect(guardRoute("/NotAnId", false)).toEqual({ action: "next" });
  });

  it("has no rule for the old `/app` addresses — they are just paths now", () => {
    // `/app` looks like a board id, so it lands on the same screens a bad board
    // link does; `/app/<id>` no longer exists at all.
    expect(guardRoute("/app", false)).toEqual({
      action: "redirect",
      to: "/?signin=1",
    });
    expect(guardRoute("/app", true)).toEqual({ action: "next" });
    expect(guardRoute("/app/j57195vyzfcckg0dv469vz6bzs8ge42s", true)).toEqual({
      action: "next",
    });
  });

  it.each(["/signin", "/signup"])(
    "redirects the removed %s route to the dialog, whatever the cookie says",
    (pathname) => {
      expect(guardRoute(pathname, true)).toEqual({
        action: "redirect",
        to: "/?signin=1",
      });
      expect(guardRoute(pathname, false)).toEqual({
        action: "redirect",
        to: "/?signin=1",
      });
    },
  );
});
