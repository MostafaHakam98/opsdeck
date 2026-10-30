import { useEffect, useState } from "react";
import { api as fleetApi, bytes } from "../../lib/api";
import { useHostApi } from "../../lib/HostApi";
import "./image-repair.css";

type Ready = {
  reference: string;
  present: boolean;
  image_id?: string;
  size?: number;
  architecture?: string;
  engine_architecture?: string;
  staging_free: number;
  engine_disk_free: number | null;
  runner: {
    available: boolean;
    message?: string;
    revision?: string;
    facts?: {
      runners: {
        name: string;
        executor: string;
        pull_policy: string | string[];
      }[];
    };
  };
  checks?: { label: string; status: string; detail: string }[];
};
type CopyReview = {
  nonce: string;
  expires_at: number;
  confirmation: string;
  source_name: string;
  destination_name: string;
  reference: string;
  estimated_bytes: number;
  architecture: string;
  source_info: Ready;
  destination_info: Ready;
};
type Transfer = {
  id: string;
  source: string;
  destination: string;
  reference: string;
  source_name: string;
  destination_name: string;
  status: string;
  stage: string;
  message: string;
  offset: number;
  total?: number;
  exported_bytes?: number;
  staging_discarded?: boolean;
  source_archive_retained?: boolean;
};
const stages: Record<string, string> = {
  exporting: "Prepare source archive",
  copying: "Copy archive",
  importing: "Load destination image",
  verifying: "Verify image",
  complete: "Image verified",
};

export function ImageRepair({
  token,
  enabled,
  retryEnabled,
  preview,
}: {
  token: string;
  enabled: boolean;
  retryEnabled: boolean;
  preview: (action: string, values: Record<string, unknown>) => Promise<void>;
}) {
  const { api, fleet } = useHostApi();
  const [reference, setReference] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [ready, setReady] = useState<Ready>();
  const [runner, setRunner] = useState("");
  const [policy, setPolicy] = useState("if-not-present");
  const [emulation, setEmulation] = useState(false);
  const [review, setReview] = useState<CopyReview>();
  const [confirmation, setConfirmation] = useState("");
  const [jobs, setJobs] = useState<Transfer[]>([]);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState("");
  const [job, setJob] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!fleet.node) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const rows = await fleetApi<Transfer[]>(
          `fleet/image-transfers?destination=${encodeURIComponent(fleet.node)}`,
          token,
          undefined,
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setJobs(rows.filter((r) => r.destination === fleet.node));
          setHistoryError("");
        }
      } catch (e) {
        if (!controller.signal.aborted) setHistoryError((e as Error).message);
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 3000);
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [fleet.node, token]);
  useEffect(() => {
    if (!source) {
      setTags([]);
      return;
    }
    const controller = new AbortController();
    setTags([]);
    void fleetApi<{
      sources: { docker?: { data?: { images?: { tags?: string[] }[] } } };
    }>(
      `fleet/nodes/${source}/workspace/snapshot`,
      token,
      undefined,
      controller.signal,
    )
      .then((snapshot) => {
        if (!controller.signal.aborted)
          setTags(
            [
              ...new Set(
                (snapshot.sources.docker?.data?.images || []).flatMap(
                  (i) => i.tags || [],
                ),
              ),
            ].sort(),
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, [source, token]);
  useEffect(() => {
    if (!review) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [review]);

  async function check() {
    setBusy(true);
    setError("");
    setReady(undefined);
    try {
      const info = await api<Ready>(
        `operations/readiness?reference=${encodeURIComponent(reference)}`,
        token,
      );
      setReady(info);
      setRunner(
        info.runner.facts?.runners.find((r) => r.executor === "docker")?.name ||
          "",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel image-repair"
      aria-label="Image transfer and runner readiness"
    >
      <div className="panel-heading">
        <h2>Prepare a runner image</h2>
        <span>Check · copy · verify</span>
      </div>
      <div className="operator-body">
        <p>
          Check the exact image tag from a failed job. Copy an existing image
          from another host, or use the import and build controls below.
        </p>
        <form
          className="image-check"
          onSubmit={(e) => {
            e.preventDefault();
            void check();
          }}
        >
          <label>
            Required image tag
            <input
              aria-label="Required image tag"
              required
              placeholder="team-toolchain:latest"
              list="source-image-tags"
              value={reference}
              maxLength={255}
              onChange={(e) => {
                setReference(e.target.value);
                setReady(undefined);
                setReview(undefined);
              }}
            />
          </label>
          <datalist id="source-image-tags">
            {tags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <button disabled={busy || !reference}>Check runner readiness</button>
        </form>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {ready && (
          <div className="image-readiness" aria-live="polite">
            <strong>
              {ready.present
                ? "Image is available locally"
                : "Image is missing from this Docker engine"}
            </strong>
            <dl>
              <div>
                <dt>Image architecture</dt>
                <dd>{ready.architecture || "Not available"}</dd>
              </div>
              <div>
                <dt>Engine architecture</dt>
                <dd>{ready.engine_architecture || "Not available"}</dd>
              </div>
              <div>
                <dt>Archive staging free</dt>
                <dd>{bytes(ready.staging_free)}</dd>
              </div>
              <div>
                <dt>Docker storage free</dt>
                <dd>
                  {ready.engine_disk_free == null
                    ? "Not reported by this engine"
                    : bytes(ready.engine_disk_free)}
                </dd>
              </div>
            </dl>
            {ready.image_id && (
              <small className="archive-digest">{ready.image_id}</small>
            )}
            {ready.checks?.map((check) => (
              <p key={check.label}>
                <strong>
                  {check.label}: {check.status}
                </strong>{" "}
                — {check.detail}
              </p>
            ))}
            {ready.runner.available ? (
              <form
                className="image-policy"
                onSubmit={(e) => {
                  e.preventDefault();
                  void preview("runner_image_policy", {
                    runner,
                    pull_policy: policy,
                    revision: ready.runner.revision,
                  });
                }}
              >
                <label>
                  Docker registration
                  <select
                    aria-label="Image policy registration"
                    required
                    value={runner}
                    onChange={(e) => setRunner(e.target.value)}
                  >
                    <option value="">Choose a registration</option>
                    {ready.runner.facts?.runners
                      .filter((r) => r.executor === "docker")
                      .map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.name} — {String(r.pull_policy)}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Image pull policy
                  <select
                    aria-label="Image pull policy"
                    value={policy}
                    onChange={(e) => setPolicy(e.target.value)}
                  >
                    <option value="if-not-present">
                      Use local image when present
                    </option>
                    <option value="always">Always pull from registry</option>
                  </select>
                </label>
                <button disabled={busy || !enabled || !runner}>
                  Review image policy
                </button>
                <small>
                  A local-only image needs “Use local image when present”.
                  Review creates a backup before changing the runner.
                </small>
              </form>
            ) : (
              <p className="muted">
                {ready.runner.message} Image availability can still be checked.
              </p>
            )}
          </div>
        )}

        {fleet.node && (
          <div className="fleet-image-copy">
            <h3>Copy from another host</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                setReview(undefined);
                try {
                  setReview(
                    await fleetApi<CopyReview>(
                      "fleet/image-transfers/preview",
                      token,
                      {
                        source,
                        destination: fleet.node,
                        reference,
                        allow_emulation: emulation,
                      },
                    ),
                  );
                  setConfirmation("");
                  setNow(Date.now());
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="image-copy-route">
                <label>
                  Source host
                  <select
                    aria-label="Source image host"
                    required
                    value={source}
                    onChange={(e) => {
                      setSource(e.target.value);
                      setReview(undefined);
                      setError("");
                    }}
                  >
                    <option value="">Choose a source</option>
                    {fleet.hosts
                      .filter((h) => h.id !== fleet.node)
                      .map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                  </select>
                </label>
                <span aria-hidden="true">→</span>
                <div>
                  <small>Destination host</small>
                  <strong>
                    {fleet.hosts.find((h) => h.id === fleet.node)?.name ||
                      "Selected host"}
                  </strong>
                </div>
              </div>
              <label className="image-emulation">
                <input
                  type="checkbox"
                  checked={emulation}
                  onChange={(e) => {
                    setEmulation(e.target.checked);
                    setReview(undefined);
                  }}
                />
                Allow a different CPU architecture; I have verified that this
                destination supports emulation.
              </label>
              <button
                className="primary"
                disabled={busy || !enabled || !reference || !source}
              >
                Review image copy
              </button>
            </form>
            {review && (
              <form
                className="image-copy-review"
                aria-label="Image copy review"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  try {
                    const result = await fleetApi<Transfer>(
                      "fleet/image-transfers/execute",
                      token,
                      { nonce: review.nonce, confirmation },
                    );
                    setJobs((old) => [result, ...old]);
                    setReview(undefined);
                  } catch (e) {
                    setError((e as Error).message);
                    setReview(undefined);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h3>
                  {review.source_name} → {review.destination_name}
                </h3>
                <p>
                  <strong>{review.reference}</strong> ·{" "}
                  {bytes(review.estimated_bytes)} before archive overhead ·{" "}
                  {review.architecture}
                </p>
                <p>
                  Source staging free: {bytes(review.source_info.staging_free)}.
                  Destination staging free:{" "}
                  {bytes(review.destination_info.staging_free)}.
                </p>
                {review.destination_info.engine_disk_free == null && (
                  <p>
                    Docker disk free space is not reported. Check engine storage
                    before copying a large image.
                  </p>
                )}
                <p>
                  The background task exports, copies, imports, and verifies
                  image layers and runtime configuration. It continues after you
                  leave this page. Existing destination tags are preserved.
                </p>
                <label>
                  Type <code>{review.confirmation}</code> to start
                  <input
                    aria-label="Image copy confirmation"
                    autoComplete="off"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </label>
                <div className="inline-actions">
                  <button type="button" onClick={() => setReview(undefined)}>
                    Cancel review
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      confirmation !== review.confirmation ||
                      now >= review.expires_at * 1000
                    }
                  >
                    Start image copy
                  </button>
                </div>
              </form>
            )}
            {historyError && (
              <p className="notice error">
                {historyError} Transfer history will reconnect automatically.
              </p>
            )}
            {jobs.length > 0 && (
              <div
                className="image-copy-history"
                aria-label="Image transfer history"
              >
                {jobs.map((task) => (
                  <article key={task.id}>
                    <div>
                      <strong>{task.reference}</strong>
                      <small>
                        {task.source_name} → {task.destination_name}
                      </small>
                    </div>
                    <div>
                      <strong>
                        {stages[task.stage] || task.stage} · {task.status}
                      </strong>
                      <p>{task.message}</p>
                      {task.status === "running" || task.status === "queued" ? (
                        task.stage === "copying" ? (
                          <>
                            <progress
                              aria-label={`Transfer ${task.reference}`}
                              value={task.offset}
                              max={task.total || 1}
                            />
                            <small>
                              {bytes(task.offset)} / {bytes(task.total)}
                            </small>
                          </>
                        ) : (
                          <>
                            <progress
                              aria-label={`Transfer ${task.reference}`}
                            />
                            <small>
                              {task.exported_bytes
                                ? `${bytes(task.exported_bytes)} exported`
                                : "Waiting for Docker or the host agent"}
                            </small>
                          </>
                        )
                      ) : null}
                      {!["running", "queued"].includes(task.status) &&
                        !task.staging_discarded &&
                        (task.status !== "success" ||
                          task.source_archive_retained) && (
                          <button
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              setError("");
                              try {
                                await fleetApi(
                                  `fleet/image-transfers/${task.id}/discard`,
                                  token,
                                  {},
                                );
                                setJobs((old) =>
                                  old.map((row) =>
                                    row.id === task.id
                                      ? { ...row, staging_discarded: true }
                                      : row,
                                  ),
                                );
                              } catch (e) {
                                setError((e as Error).message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Discard staged archives
                          </button>
                        )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
        <details className="image-job-retry">
          <summary>Retry a failed GitLab job</summary>
          <p>
            Review and retry the latest failed job after checking the image and
            runner policy. Job scripts run again.
          </p>
          {!retryEnabled && (
            <p className="muted">
              Configure a separate OPSDECK_GITLAB_RETRY_TOKEN with api access on
              this host to enable retries. The monitoring token remains
              read-only.
            </p>
          )}
          <form
            className="image-policy"
            onSubmit={(e) => {
              e.preventDefault();
              void preview("retry_gitlab_job", { project, job: Number(job) });
            }}
          >
            <label>
              Configured project ID or path
              <input
                aria-label="Retry project"
                required
                value={project}
                onChange={(e) => setProject(e.target.value)}
              />
            </label>
            <label>
              Failed job ID
              <input
                aria-label="Retry job ID"
                required
                type="number"
                min={1}
                value={job}
                onChange={(e) => setJob(e.target.value)}
              />
            </label>
            <button disabled={!enabled || !retryEnabled || busy}>
              Review job retry
            </button>
          </form>
        </details>
      </div>
    </section>
  );
}
