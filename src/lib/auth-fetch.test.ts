import { describe, expect, it, vi } from "vitest";
import { createResilientAuthFetch, type FetchLike } from "./auth-fetch";

const sleep = () => Promise.resolve();
const response = (body = "{}") =>
  new Response(body, { headers: { "content-type": "application/json" } });

/** A fake impl that rejects until its attempt count is spent. */
function flakyImpl(failures: number, onCall?: () => void): FetchLike {
  let calls = 0;
  return (input, init) => {
    onCall?.();
    calls += 1;
    if (calls <= failures) return Promise.reject(new TypeError("fetch failed"));
    void input;
    void init;
    return Promise.resolve(response());
  };
}

describe("createResilientAuthFetch", () => {
  it("retries a GET that failed, and resolves with the second answer", async () => {
    const impl = flakyImpl(1);
    const fetchWithRetry = createResilientAuthFetch(impl, { sleep });

    await expect(fetchWithRetry("/api/auth/get-session")).resolves.toBeInstanceOf(
      Response,
    );
  });

  it("does not retry a POST, and never aborts one on a budget", async () => {
    const impl = vi.fn<FetchLike>(() => Promise.reject(new TypeError("fetch failed")));
    const fetchWithRetry = createResilientAuthFetch(impl, { sleep, timeoutMs: 1 });

    await expect(
      fetchWithRetry("/api/auth/passkey/verify-authentication", {
        method: "POST",
      }),
    ).rejects.toThrow("fetch failed");
    expect(impl).toHaveBeenCalledTimes(1);
    // Passed through untouched: no signal was added for the caller to observe.
    expect(impl.mock.calls[0]?.[1]?.signal).toBeUndefined();
  });

  it("gives a GET a signal to abort it with", async () => {
    let seen: RequestInit | undefined;
    const impl: FetchLike = (_input, init) => {
      seen = init;
      return Promise.resolve(response());
    };
    const fetchWithRetry = createResilientAuthFetch(impl, { sleep });

    await fetchWithRetry("/api/auth/get-session");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("abandons a stalled attempt and lets the retry win", async () => {
    let calls = 0;
    const impl: FetchLike = (_input, init) => {
      calls += 1;
      if (calls === 1) {
        // The attempt that never answers: only the budget can end it.
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(response("second attempt"));
    };
    const fetchWithRetry = createResilientAuthFetch(impl, {
      sleep,
      timeoutMs: 5,
    });

    const result = await fetchWithRetry("/api/auth/convex/token");
    expect(await result.text()).toBe("second attempt");
    expect(calls).toBe(2);
  });

  it("never retries the registration-options GET", async () => {
    const impl = vi.fn<FetchLike>(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    const fetchWithRetry = createResilientAuthFetch(impl, { sleep });

    await expect(
      fetchWithRetry(
        "/api/auth/passkey/generate-register-options?context=signed-token",
      ),
    ).rejects.toThrow("fetch failed");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("still budgets the registration-options GET with one attempt", async () => {
    let calls = 0;
    const impl: FetchLike = (_input, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    };
    const fetchWithRetry = createResilientAuthFetch(impl, {
      sleep,
      timeoutMs: 5,
    });

    await expect(
      fetchWithRetry("/api/auth/passkey/generate-register-options?context=x"),
    ).rejects.toThrow(/abort/i);
    expect(calls).toBe(1);
  });

  it("recognises a Request object for the registration GET", async () => {
    const impl = vi.fn<FetchLike>(() =>
      Promise.reject(new TypeError("fetch failed")),
    );
    const fetchWithRetry = createResilientAuthFetch(impl, { sleep });

    await expect(
      fetchWithRetry(
        new Request(
          "http://localhost:3000/api/auth/passkey/generate-register-options?context=x",
        ),
      ),
    ).rejects.toThrow("fetch failed");
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when the caller aborted its own request", async () => {
    const controller = new AbortController();
    const impl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        controller.abort();
      });
    const fetchWithRetry = createResilientAuthFetch(impl, {
      sleep,
      attempts: 3,
      timeoutMs: 1_000,
    });

    await expect(
      fetchWithRetry("/api/auth/get-session", { signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    // One attempt: a cancelled request is not asked again.
    expect(controller.signal.aborted).toBe(true);
  });

  it("keeps a caller's signal on the request it forwards", async () => {
    const controller = new AbortController();
    let seen: RequestInit | undefined;
    const impl: FetchLike = (_input, init) => {
      seen = init;
      return Promise.resolve(response());
    };
    const fetchWithRetry = createResilientAuthFetch(impl, { sleep });

    await fetchWithRetry("/api/auth/get-session", {
      signal: controller.signal,
    });
    expect(seen?.signal?.aborted).toBe(false);
    controller.abort();
    expect(seen?.signal?.aborted).toBe(true);
  });
});
