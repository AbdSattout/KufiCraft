import { describe, expect, it, vi } from "vitest";
import { createTokenSource, tokenExpiryMs } from "./convex-token";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** A JWT-shaped string: only the payload matters to the token source. */
function jwt(expiresAtSeconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: "user-1", exp: expiresAtSeconds }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function clock(start = 1_000 * MINUTE) {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

/** The source's own sleep, replaced with a no-op so failures retry at once. */
const sleep = () => Promise.resolve();

describe("tokenExpiryMs", () => {
  it("reads the `exp` claim in milliseconds", () => {
    expect(tokenExpiryMs(jwt(2_000_000_000))).toBe(2_000_000_000 * SECOND);
  });

  it("returns null for anything that is not a readable JWT payload", () => {
    expect(tokenExpiryMs("not-a-jwt")).toBeNull();
    expect(tokenExpiryMs("a.%%%.c")).toBeNull();
    expect(tokenExpiryMs("a." + Buffer.from("nope").toString("base64url") + ".c")).toBeNull();
  });
});

describe("createTokenSource", () => {
  it("reuses a fresh token instead of asking again", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND + 600)));
    const source = createTokenSource({ request, now: time.now, sleep });

    await expect(source.get()).resolves.toBeTruthy();
    await expect(source.get()).resolves.toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("re-asks once the reuse window is over", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND + 600)));
    const source = createTokenSource({ request, now: time.now, sleep });

    await source.get();
    time.advance(6 * MINUTE); // past the 5-minute fallback cap
    await source.get();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops reusing a token before its own expiry, minus the leeway", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND + 60)));
    const source = createTokenSource({
      request,
      now: time.now,
      sleep,
      leewayMs: 30 * SECOND,
    });

    await source.get();
    time.advance(29 * SECOND);
    await source.get();
    expect(request).toHaveBeenCalledTimes(1);

    time.advance(2 * SECOND); // 31 s: exp is 29 s away, inside the leeway
    await source.get();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("never caches a token that is already expired", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND - 5)));
    const source = createTokenSource({ request, now: time.now, sleep });

    await source.get();
    await source.get();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("shares one request between concurrent callers", async () => {
    const time = clock();
    let resolveRequest: ((token: string) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const source = createTokenSource({ request, now: time.now, sleep });

    const first = source.get();
    const second = source.get();
    const forced = source.get(true);
    resolveRequest?.(jwt(time.now() / SECOND + 600));

    await expect(first).resolves.toBeTruthy();
    await expect(second).resolves.toBeTruthy();
    await expect(forced).resolves.toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("honours a forced refresh even with a fresh token in hand", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND + 600)));
    const source = createTokenSource({ request, now: time.now, sleep });

    await source.get();
    await source.get(true);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure — the next caller asks again", async () => {
    const time = clock();
    let fail = true;
    const request = vi.fn(() =>
      fail
        ? Promise.reject(new Error("fetch failed"))
        : Promise.resolve(jwt(time.now() / SECOND + 600)),
    );
    const source = createTokenSource({
      request,
      now: time.now,
      sleep,
      attempts: 1,
    });

    await expect(source.get()).resolves.toBeNull();
    fail = false;
    await expect(source.get()).resolves.toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty answer either", async () => {
    const time = clock();
    const request = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(jwt(time.now() / SECOND + 600));
    const source = createTokenSource({
      request,
      now: time.now,
      sleep,
      attempts: 1,
    });

    await expect(source.get()).resolves.toBeNull();
    await expect(source.get()).resolves.toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps a still-fresh token when a forced refresh fails", async () => {
    const time = clock();
    let fail = false;
    const request = vi.fn(() =>
      fail
        ? Promise.reject(new Error("fetch failed"))
        : Promise.resolve(jwt(time.now() / SECOND + 600)),
    );
    const source = createTokenSource({
      request,
      now: time.now,
      sleep,
      attempts: 1,
    });

    const first = await source.get();
    fail = true;
    await expect(source.get(true)).resolves.toBeNull();
    fail = false;
    // The failed refresh did not cache anything, but it did not throw away a
    // token that is still fresh either.
    await expect(source.get()).resolves.toBe(first);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("expire() drops the token for the next caller", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND + 600)));
    const source = createTokenSource({ request, now: time.now, sleep });

    await source.get();
    source.expire();
    await source.get();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("expire() during a request stops its answer from being cached", async () => {
    const time = clock();
    const request = vi.fn(() => Promise.resolve(jwt(time.now() / SECOND + 600)));
    const source = createTokenSource({ request, now: time.now, sleep });

    const inFlight = source.get();
    source.expire();
    await inFlight;
    await source.get();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("retries a failed request before giving up", async () => {
    const time = clock();
    const request = vi
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(jwt(time.now() / SECOND + 600));
    const source = createTokenSource({
      request,
      now: time.now,
      sleep,
      attempts: 2,
    });

    await expect(source.get()).resolves.toBeTruthy();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
