export type Source<T = any> = {
  status: string;
  data: T | null;
  message: string | null;
  updated_at: number | null;
  age_seconds: number | null;
  stale: boolean;
};
export type Snapshot = {
  sources: Record<string, Source>;
  alerts: Array<{
    key: string;
    title: string;
    detail: string;
    severity: string;
  }>;
  recommendations: Array<{
    key: string;
    title: string;
    category: string;
    status: string;
    evidence: string;
    next: string;
  }>;
  server_time: number;
  sample_seconds: number;
  retention_days: number;
  actions_enabled: boolean;
  history_error: string | null;
  version: string;
};
export type History = {
  ts: number;
  cpu: number | null;
  memory: number | null;
  gpu: number | null;
  rx: number | null;
  tx: number | null;
  io_pressure: number | null;
  queued: number | null;
  [key: string]: number | null;
};
export type Event = {
  id: number;
  ts: number;
  kind: string;
  severity: string;
  title: string;
  detail: string;
};
export type Plan = {
  nonce: string;
  action: string;
  target: string;
  name: string;
  confirmation: string;
  expires_at: number;
  impact: string;
};
export async function api<T>(
  path: string,
  token: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      response.status === 401
        ? "Access token is invalid or expired. Sign in again."
        : payload.detail || `Request failed (${response.status})`,
    );
  }
  return response.json();
}
export function bytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 B";
  const index = Math.min(
    4,
    Math.max(0, Math.floor(Math.log(Math.abs(value)) / Math.log(1024))),
  );
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${["B", "KiB", "MiB", "GiB", "TiB"][index]}`;
}
export function pct(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}
export function duration(value: number | null | undefined) {
  if (value == null) return "—";
  value = Math.round(value);
  if (value < 60) return `${Math.round(value)}s`;
  if (value < 3600)
    return `${Math.floor(value / 60)}m ${Math.round(value % 60)}s`;
  if (value < 86400)
    return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 86400)}d ${Math.floor((value % 86400) / 3600)}h`;
}
export function safeUrl(url: string | undefined) {
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type Upload = {
  id: string;
  kind: "image" | "context";
  name: string;
  bytes: number;
  sha256: string;
};
export function uploadArchive(
  token: string,
  file: File,
  kind: string,
  progress: (percent: number) => void,
  signal: AbortSignal,
): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(
      "POST",
      `/api/operations/uploads?kind=${kind}&name=${encodeURIComponent(file.name.slice(0, 120))}`,
    );
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("Content-Type", "application/octet-stream");
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.round((event.loaded / event.total) * 100));
    };
    request.onloadend = () => signal.removeEventListener("abort", abort);
    request.onload = () => {
      let data: any;
      try {
        data = JSON.parse(request.responseText);
      } catch {
        reject(new Error("Upload failed; check the server connection"));
        return;
      }
      if (request.status >= 200 && request.status < 300) resolve(data);
      else
        reject(
          new Error(
            typeof data.detail === "string"
              ? data.detail
              : "Archive upload failed",
          ),
        );
    };
    request.onerror = () =>
      reject(new Error("Upload connection lost; choose the archive again"));
    request.onabort = () => reject(new Error("Upload cancelled"));
    if (signal.aborted) {
      reject(new Error("Upload cancelled"));
      return;
    }
    request.send(file);
  });
}
