import { describe, expect, it, vi } from "vitest";
import { backoffDelay, retryTransient, type Sleep } from "./retry";

/** Records the delays the helper asked for, without any real waiting. */
function recordingSleep(): { sleep: Sleep; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

describe("backoffDelay", () => {
  it("doubles from the base delay and never goes below it", () => {
    expect(backoffDelay(0, 250)).toBe(250);
    expect(backoffDelay(1, 250)).toBe(500);
    expect(backoffDelay(2, 250)).toBe(1000);
    expect(backoffDelay(-1, 250)).toBe(250);
  });
});

describe("retryTransient", () => {
  it("returns the first result without waiting when the call works", async () => {
    const { sleep, delays } = recordingSleep();
    const run = vi.fn(() => Promise.resolve("ok"));

    await expect(retryTransient(run, { sleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("asks again after a short backoff, then succeeds", async () => {
    const { sleep, delays } = recordingSleep();
    const run = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce("ok");

    await expect(
      retryTransient(run, { attempts: 3, backoffMs: 200, sleep }),
    ).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(delays).toEqual([200]);
  });

  it("gives up after the last attempt and rethrows that attempt's error", async () => {
    const { sleep, delays } = recordingSleep();
    const run = vi.fn(() => Promise.reject(new Error("still down")));

    await expect(
      retryTransient(run, { attempts: 3, backoffMs: 100, sleep }),
    ).rejects.toThrow("still down");
    expect(run).toHaveBeenCalledTimes(3);
    // A delay between attempts, but never after the last one.
    expect(delays).toEqual([100, 200]);
  });

  it("makes exactly one attempt when attempts is 1", async () => {
    const { sleep } = recordingSleep();
    const run = vi.fn(() => Promise.reject(new Error("nope")));

    await expect(retryTransient(run, { attempts: 1, sleep })).rejects.toThrow(
      "nope",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("tells the run function which attempt it is", async () => {
    const { sleep } = recordingSleep();
    const seen: number[] = [];
    const run = (attempt: number) => {
      seen.push(attempt);
      return attempt < 1
        ? Promise.reject(new Error("first"))
        : Promise.resolve("done");
    };

    await retryTransient(run, { attempts: 2, sleep });
    expect(seen).toEqual([0, 1]);
  });
});
