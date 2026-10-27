/** JSON transport. Only GETs are retried; a lost mutation reply has an unknown outcome. */
export class RequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const listeners = new Set<() => void>();
const active = new Map<symbol, boolean>();
let activity = { pending: 0, retrying: 0 };
export const getRequestActivity = () => activity;
export function subscribeRequests(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish() {
  activity = {
    pending: active.size,
    retrying: [...active.values()].filter(Boolean).length,
  };
  listeners.forEach((listener) => listener());
}
function abortReason(signal?: AbortSignal | null) {
  return signal?.reason || new DOMException("Request cancelled", "AbortError");
}
function delay(milliseconds: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const cancel = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}
const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);
function retryDelay(attempt: number, response?: Response) {
  const header = response?.headers.get("Retry-After");
  const seconds = header ? Number(header) : NaN;
  const suggested = Number.isFinite(seconds)
    ? seconds * 1000
    : header
      ? Date.parse(header) - Date.now()
      : NaN;
  return Number.isFinite(suggested)
    ? Math.min(5000, Math.max(300, suggested))
    : 600 * 2 ** attempt + Math.random() * 200;
}

export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const read = (init.method || "GET").toUpperCase() === "GET";
  const identifier = Symbol();
  if (init.signal?.aborted) throw abortReason(init.signal);
  active.set(identifier, false);
  publish();
  try {
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const cancel = () => controller.abort(abortReason(init.signal));
      init.signal?.addEventListener("abort", cancel, { once: true });
      // Allow the host relay's 45s deadline to return a useful server response first.
      const timeout = read
        ? setTimeout(() => controller.abort(), 50000)
        : undefined;
      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await fetch(url, { ...init, signal: controller.signal });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new RequestError(
            response.status === 401 && !url.endsWith("/auth/login")
              ? "Your session is invalid or expired. Sign in again."
              : typeof payload.detail === "string"
                ? payload.detail
                : `Request failed (${response.status})`,
            response.status,
          );
        }
        return (await response.json()) as T;
      } catch (error) {
        if (init.signal?.aborted) throw abortReason(init.signal);
        failure = error;
      } finally {
        clearTimeout(timeout);
        init.signal?.removeEventListener("abort", cancel);
      }
      const transient =
        failure instanceof RequestError
          ? retryStatuses.has(failure.status || 0)
          : failure instanceof TypeError ||
            failure instanceof SyntaxError ||
            controller.signal.aborted;
      if (read && transient && attempt < 2) {
        active.set(identifier, true);
        publish();
        await delay(retryDelay(attempt, response), init.signal);
        continue;
      }
      if (failure instanceof RequestError) throw failure;
      if (!read)
        throw new RequestError(
          "The connection was interrupted. Check the result before trying again.",
        );
      throw new RequestError(
        controller.signal.aborted
          ? "The server is taking too long to respond. Try again shortly."
          : "Could not reach the server. Check your connection; live updates will retry automatically.",
      );
    }
  } finally {
    active.delete(identifier);
    publish();
  }
}
