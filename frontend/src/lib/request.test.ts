import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequestActivity, requestJson } from "./request";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const ok = (value = { ready: true }) => new Response(JSON.stringify(value));

describe("recovering reads without replaying changes", () => {
  it("recovers a network interruption and an unavailable server", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("proxy unavailable", { status: 503 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    const result = requestJson("/api/snapshot");
    await vi.advanceTimersByTimeAsync(1);
    expect(getRequestActivity()).toEqual({ pending: 1, retrying: 1 });
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ ready: true });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(getRequestActivity()).toEqual({ pending: 0, retrying: 0 });
  });
  it("bounds retries and gives a useful network error", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    const rejected = expect(requestJson("/api/events")).rejects.toThrow(
      "Could not reach the server",
    );
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(getRequestActivity().pending).toBe(0);
  });
  it("does not retry rejected credentials or validation errors", async () => {
    for (const status of [401, 403, 404, 422]) {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "Denied" }), { status }),
        );
      vi.stubGlobal("fetch", fetch);
      await expect(requestJson("/api/fleet")).rejects.toMatchObject({ status });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("never retries a POST after network or server failures", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      requestJson("/api/operations/execute", { method: "POST" }),
    ).rejects.toThrow("Check the result");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(
      requestJson("/api/checkpoints", { method: "POST" }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("cancels backoff immediately when navigation aborts the request", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = requestJson("/api/history", { signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getRequestActivity().pending).toBe(0);
  });
  it("bounds Retry-After so a proxy cannot leave the loading indicator stuck", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 429,
          headers: { "Retry-After": "86400" },
        }),
      )
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    const result = requestJson("/api/workloads");
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ ready: true });
  });
  it("recovers a proxy HTML response instead of exposing a JSON parse failure", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>temporary proxy page</html>"))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal("fetch", fetch);
    const result = requestJson("/healthz");
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ ready: true });
  });
});
