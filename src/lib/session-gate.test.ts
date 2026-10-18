import { describe, expect, it } from "vitest";
import {
  decideGate,
  errorStatus,
  sessionOutcome,
  type GateInput,
} from "./session-gate";

const TRANSIENT_ERRORS: Record<string, unknown> = {
  "a fetch that never reached the server": new TypeError("fetch failed"),
  "an aborted request": Object.assign(new Error("aborted"), {
    name: "AbortError",
  }),
  "a proxy that answered 500": { status: 500, statusText: "Internal Server Error" },
  "a proxy that answered 502": { status: 502 },
  "a 400 no one asked for": { status: 400 },
  "a 403": { status: 403 },
  "an error without a status": { message: "something" },
};

function input(patch: Partial<GateInput> = {}): GateInput {
  return {
    hasSession: false,
    sessionPending: false,
    sessionError: null,
    tokenPending: false,
    tokenReady: false,
    ...patch,
  };
}

describe("errorStatus", () => {
  it("reads a numeric status and nothing else", () => {
    expect(errorStatus({ status: 401 })).toBe(401);
    expect(errorStatus({ status: "401" })).toBeNull();
    expect(errorStatus(new Error("fetch failed"))).toBeNull();
    expect(errorStatus(null)).toBeNull();
    expect(errorStatus("nope")).toBeNull();
  });
});

describe("sessionOutcome", () => {
  it("is authorised by a session object, whatever a later error says", () => {
    expect(
      sessionOutcome(
        input({
          hasSession: true,
          sessionError: new TypeError("fetch failed"),
        }),
      ),
    ).toBe("authenticated");
  });

  it("is pending while the request is in flight", () => {
    expect(sessionOutcome(input({ sessionPending: true }))).toBe("pending");
  });

  it("is signed out on a resolved answer with no session and no error", () => {
    expect(sessionOutcome(input())).toBe("no-session");
  });

  it("is signed out on a clean 401", () => {
    expect(sessionOutcome(input({ sessionError: { status: 401 } }))).toBe(
      "no-session",
    );
  });

  it.each(Object.entries(TRANSIENT_ERRORS))(
    "treats %s as transient",
    (_label, error) => {
      expect(sessionOutcome(input({ sessionError: error }))).toBe("transient");
    },
  );
});

describe("decideGate", () => {
  it("is ready only for a session Convex also holds a token for", () => {
    expect(
      decideGate(input({ hasSession: true, tokenReady: true })),
    ).toMatchObject({ ready: true, transient: false, signedOut: false });
  });

  it("waits on the session, then on the token", () => {
    expect(decideGate(input({ sessionPending: true }))).toMatchObject({
      waiting: true,
      ready: false,
      transient: false,
    });
    expect(
      decideGate(input({ hasSession: true, tokenPending: true })),
    ).toMatchObject({ waiting: true, ready: false, transient: false });
  });

  it("navigates only on an authoritative no-session", () => {
    expect(decideGate(input()).signedOut).toBe(true);
    expect(decideGate(input({ sessionError: { status: 401 } })).signedOut).toBe(
      true,
    );
  });

  it.each(Object.entries(TRANSIENT_ERRORS))(
    "never signs anyone out for %s",
    (_label, error) => {
      const decision = decideGate(input({ sessionError: error }));
      expect(decision.signedOut).toBe(false);
      expect(decision.transient).toBe(true);
      expect(decision.ready).toBe(false);
    },
  );

  it("calls a session with no Convex token transient, not signed out", () => {
    // The token endpoint failed; the session cookie is still perfectly valid.
    const decision = decideGate(input({ hasSession: true }));
    expect(decision).toMatchObject({ transient: true, signedOut: false });
  });

  it("lets a live session cover a transient session error", () => {
    const decision = decideGate(
      input({
        hasSession: true,
        tokenReady: true,
        sessionError: new TypeError("fetch failed"),
      }),
    );
    expect(decision).toMatchObject({ ready: true, transient: false });
  });
});
