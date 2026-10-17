import { describe, expect, it } from "vitest";
import { guardRoute } from "./route-guards";

describe("guardRoute", () => {
  it("rewrites the landing to the dashboard for a visitor with a session", () => {
    expect(guardRoute("/", true)).toEqual({ action: "rewrite", to: "/app" });
  });

  it("leaves the landing alone for an anonymous visitor", () => {
    expect(guardRoute("/", false)).toEqual({ action: "next" });
  });

  it.each(["/app", "/app/j57195vyzfcckg0dv469vz6bzs8ge42s", "/account"])(
    "sends an anonymous visitor from %s home with the sign-in dialog",
    (pathname) => {
      expect(guardRoute(pathname, false)).toEqual({
        action: "redirect",
        to: "/?signin=1",
      });
    },
  );

  it("lets a signed-in visitor through to the guarded screens", () => {
    expect(guardRoute("/app", true)).toEqual({ action: "next" });
    expect(guardRoute("/account", true)).toEqual({ action: "next" });
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

  it("matches whole segments only", () => {
    expect(guardRoute("/application", false)).toEqual({ action: "next" });
    expect(guardRoute("/accounts", false)).toEqual({ action: "next" });
    expect(guardRoute("/signing", false)).toEqual({ action: "next" });
  });
});
