import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Box,
  Check,
  SlidersHorizontal,
  UploadCloud,
} from "lucide-react";
import { api, bytes, uploadArchive, type Upload } from "../../lib/api";
import { Pager } from "../../components/Pager";

type Facts = {
  concurrent: number;
  runners: Array<{ name: string; limit: number; request_concurrency: number }>;
};
type Capabilities = {
  enabled: boolean;
  upload_max_bytes: number;
  runner: {
    available: boolean;
    message?: string;
    revision?: string;
    facts?: Facts;
  };
  build_profiles: Array<{ id: string; label: string; dockerfile: string }>;
  build_profiles_message?: string;
  uploads: Upload[];
};
type Review = {
  nonce: string;
  action: string;
  name: string;
  confirmation: string;
  expires_at: number;
  impact: string;
  before?: Facts;
  after?: Facts;
  archive?: Upload;
  values: Record<string, unknown>;
};
type Job = {
  id: string;
  action: string;
  name: string;
  status: string;
  message: string;
  created_at: number;
  updated_at: number;
  image_id?: string;
  imported_images?: Record<string, string>;
};
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
      </div>
      <div className="operator-body">{children}</div>
    </section>
  );
}

export function OperatorConsole({
  token,
  images,
  onChanged,
}: {
  token: string;
  images: any[];
  onChanged: () => void;
}) {
  const [cap, setCap] = useState<Capabilities>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review>();
  const [confirmation, setConfirmation] = useState("");
  const [now, setNow] = useState(Date.now());
  const [concurrent, setConcurrent] = useState(16);
  const [registration, setRegistration] = useState("");
  const [limit, setLimit] = useState(0);
  const [requests, setRequests] = useState(1);
  const [mode, setMode] = useState("load_image");
  const [profile, setProfile] = useState("");
  const [dockerfile, setDockerfile] = useState("Dockerfile");
  const [reference, setReference] = useState("");
  const [source, setSource] = useState("");
  const [upload, setUpload] = useState<Upload>();
  const [progress, setProgress] = useState<number>();
  const [jobQuery, setJobQuery] = useState("");
  const [jobStatus, setJobStatus] = useState("all");
  const [jobPage, setJobPage] = useState(1);
  const uploadAbort = useRef<AbortController>(undefined);
  const reviewRef = useRef<HTMLElement>(null);
  const initialized = useRef(false);
  async function load(signal?: AbortSignal) {
    const [next, tasks] = await Promise.all([
      api<Capabilities>("operations/capabilities", token, undefined, signal),
      api<Job[]>("operations/jobs", token, undefined, signal),
    ]);
    setCap(next);
    setJobs(tasks);
    if (!initialized.current && next.runner.available && next.runner.facts) {
      setConcurrent(next.runner.facts.concurrent);
      initialized.current = true;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(e.message);
    });
    const timer = window.setInterval(() => {
      void load(controller.signal).catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
      uploadAbort.current?.abort();
    };
  }, [token]);
  useEffect(() => {
    if (!review) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    return () => clearInterval(timer);
  }, [review]);
  const enabled = !!cap?.enabled;
  const blocked = busy || !enabled;
  function changed() {
    setReview(undefined);
    setConfirmation("");
    setMessage("");
  }
  async function preview(action: string, values: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setReview(
        await api<Review>("operations/preview", token, { action, values }),
      );
      setConfirmation("");
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function uploadFile(file?: File) {
    if (!file) return;
    if (cap && file.size > cap.upload_max_bytes) {
      setError(`Choose an archive smaller than ${bytes(cap.upload_max_bytes)}`);
      return;
    }
    changed();
    setError("");
    setProgress(0);
    const controller = new AbortController();
    uploadAbort.current = controller;
    try {
      const result = await uploadArchive(
        token,
        file,
        mode === "load_image" ? "image" : "context",
        setProgress,
        controller.signal,
      );
      setUpload(result);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(undefined);
    }
  }
  const filteredJobs = jobs.filter(
    (job) =>
      (jobStatus === "all" || job.status === jobStatus) &&
      `${job.name} ${job.action} ${job.message}`
        .toLowerCase()
        .includes(jobQuery.toLowerCase()),
  );
  const currentJobPage = Math.min(
    jobPage,
    Math.max(1, Math.ceil(filteredJobs.length / 10)),
  );
  return (
    <>
      <div className="notice">
        <SlidersHorizontal size={19} />
        <div>
          <strong>Operate this node</strong>
          <p>
            Review a change, then confirm its exact target. Image tasks run one
            at a time and keep their results after a page refresh.
          </p>
        </div>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          <Check size={18} />
          {message}
        </div>
      )}
      {cap && !enabled && (
        <div className="notice">
          <div>
            <strong>Operator controls are disabled</strong>
            <p>
              Set OPSDECK_OPERATIONS=true on this instance and recreate the app.
              Container stop/restart uses the separate OPSDECK_ACTIONS setting.
            </p>
          </div>
        </div>
      )}
      <div className="operator-grid">
        <Panel title="Runner capacity">
          <p>
            Set the maximum number of simultaneous jobs across registrations.
            Build/helper containers are not separate worker slots.
          </p>
          {!cap?.runner.available && (
            <div className="operator-hint">
              <strong>Host helper required</strong>
              <p>{cap?.runner.message || "Checking capacity control…"}</p>
              <code>sudo bash deploy/native/install-runner-control.sh</code>
              <p>
                Install on the node, then connect its socket using the
                operator-actions guide. This does not restart the runner.
              </p>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void preview("runner_capacity", {
                concurrent,
                revision: cap?.runner.revision,
                ...(registration
                  ? { runner: registration, limit, requests }
                  : {}),
              });
            }}
          >
            <label>
              Shared job limit
              <input
                aria-label="Shared job limit"
                type="number"
                min={1}
                max={32}
                required
                value={concurrent}
                onChange={(e) => {
                  changed();
                  setConcurrent(Number(e.target.value));
                }}
              />
            </label>
            <label>
              Registration
              <select
                value={registration}
                onChange={(e) => {
                  changed();
                  setRegistration(e.target.value);
                  const row = cap?.runner.facts?.runners.find(
                    (row) => row.name === e.target.value,
                  );
                  setLimit(row?.limit ?? 0);
                  setRequests(row?.request_concurrency ?? 1);
                }}
              >
                <option value="">Keep registration limits unchanged</option>
                {cap?.runner.facts?.runners.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            {registration && (
              <div className="operator-fields">
                <label>
                  Registration job limit
                  <input
                    type="number"
                    min={0}
                    max={32}
                    required
                    value={limit}
                    onChange={(e) => {
                      changed();
                      setLimit(Number(e.target.value));
                    }}
                  />
                  <small>0 shares the global limit.</small>
                </label>
                <label>
                  Request concurrency
                  <input
                    type="number"
                    min={1}
                    max={8}
                    required
                    value={requests}
                    onChange={(e) => {
                      changed();
                      setRequests(Number(e.target.value));
                    }}
                  />
                </label>
              </div>
            )}
            <p className="muted">
              Lowering capacity lets current jobs finish. CPU and memory quotas
              stay unchanged.
            </p>
            <button
              className="primary"
              disabled={blocked || !cap?.runner.available}
            >
              Review worker limits <ArrowRight size={15} />
            </button>
          </form>
        </Panel>
        <Panel title="Local Docker images">
          <p>
            Load an archive from your computer or USB drive, build on this node,
            or add a local tag. Images are added to this machine’s Docker store.
          </p>
          <label>
            Image operation
            <select
              aria-label="Image operation"
              value={mode}
              disabled={progress != null}
              onChange={(e) => {
                changed();
                setMode(e.target.value);
                setUpload(undefined);
              }}
            >
              <option value="load_image">Load saved image archive</option>
              <option value="build_image">Build an image on this node</option>
              <option value="tag_image">Add a local image tag</option>
            </select>
          </label>
          {mode === "build_image" && (
            <label>
              Build source
              <select
                value={profile}
                onChange={(e) => {
                  changed();
                  setProfile(e.target.value);
                  setUpload(undefined);
                }}
              >
                <option value="">Upload a build context archive</option>
                {cap?.build_profiles.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode !== "tag_image" && !(mode === "build_image" && profile) && (
            <div className="archive-picker">
              <label>
                {mode === "load_image"
                  ? "Saved image archive"
                  : "Build context archive"}
                <input
                  aria-label={
                    mode === "load_image"
                      ? "Saved image archive"
                      : "Build context archive"
                  }
                  type="file"
                  accept=".tar,.gz,.tgz"
                  disabled={blocked || progress != null || !!upload}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    void uploadFile(file);
                  }}
                />
              </label>
              <small>
                {mode === "load_image"
                  ? "Use docker save output (.tar or .tar.gz); select the file directly from a connected USB drive."
                  : "Upload a tar archive containing the Dockerfile and its required files. Exclude credentials and unnecessary files."}{" "}
                Limit: {bytes(cap?.upload_max_bytes)}.
              </small>
              {progress != null && (
                <div role="status">
                  <UploadCloud size={16} /> Uploading {progress}%{" "}
                  <progress max={100} value={progress} />
                  <button onClick={() => uploadAbort.current?.abort()}>
                    Cancel upload
                  </button>
                </div>
              )}
              {!upload &&
                cap?.uploads.some(
                  (row) =>
                    row.kind === (mode === "load_image" ? "image" : "context"),
                ) && (
                  <label>
                    Previously uploaded archive
                    <select
                      value=""
                      onChange={(e) => {
                        changed();
                        setUpload(
                          cap.uploads.find((row) => row.id === e.target.value),
                        );
                      }}
                    >
                      <option value="">Choose a staged archive</option>
                      {cap.uploads
                        .filter(
                          (row) =>
                            row.kind ===
                            (mode === "load_image" ? "image" : "context"),
                        )
                        .map((row) => (
                          <option value={row.id} key={row.id}>
                            {row.name} ({bytes(row.bytes)})
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              {upload && (
                <div className="upload-summary">
                  <strong>{upload.name}</strong>
                  <small>
                    {bytes(upload.bytes)} · SHA-256 {upload.sha256}
                  </small>
                  <button
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await api(
                          `operations/uploads/${upload.id}/discard`,
                          token,
                          {},
                        );
                        setUpload(undefined);
                        changed();
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Discard staged archive
                  </button>
                </div>
              )}
            </div>
          )}
          {cap?.build_profiles_message && mode === "build_image" && (
            <p className="muted">{cap.build_profiles_message}</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void preview(
                mode,
                mode === "load_image"
                  ? { upload_id: upload?.id }
                  : mode === "tag_image"
                    ? { source_id: source, reference }
                    : profile
                      ? { profile_id: profile, reference }
                      : { upload_id: upload?.id, reference, dockerfile },
              );
            }}
          >
            {mode === "tag_image" && (
              <label>
                Source image
                <select
                  required
                  aria-label="Source image"
                  value={source}
                  onChange={(e) => {
                    changed();
                    setSource(e.target.value);
                  }}
                >
                  <option value="">Choose a local image</option>
                  {images.map((image) => (
                    <option key={image.id} value={image.id}>
                      {image.tags?.join(", ") || image.id.slice(0, 24)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {mode === "build_image" && !profile && (
              <label>
                Dockerfile path
                <input
                  aria-label="Dockerfile path"
                  value={dockerfile}
                  required
                  onChange={(e) => {
                    changed();
                    setDockerfile(e.target.value);
                  }}
                />
              </label>
            )}
            {mode !== "load_image" && (
              <label>
                New local image tag
                <input
                  aria-label="New local image tag"
                  placeholder="toolchain:base-r3"
                  value={reference}
                  required
                  maxLength={255}
                  onChange={(e) => {
                    changed();
                    setReference(e.target.value);
                  }}
                />
                <small>
                  Choose a new revision tag; existing tags are preserved.
                </small>
              </label>
            )}
            <button
              className="primary"
              disabled={
                blocked ||
                progress != null ||
                (mode === "load_image" && !upload) ||
                (mode === "build_image" && !profile && !upload)
              }
            >
              <Box size={15} /> Review image operation
            </button>
          </form>
        </Panel>
      </div>
      {review && (
        <section
          className="panel operation-review"
          aria-label="Operation preview"
          ref={reviewRef}
        >
          <div className="panel-heading">
            <h2>Review {review.name}</h2>
            <span>
              {Math.max(0, Math.ceil((review.expires_at * 1000 - now) / 1000))}s
              remaining
            </span>
          </div>
          <div className="operator-body">
            <p>{review.impact}</p>
            {review.before && review.after && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Current</th>
                      <th>After change</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Shared job limit</td>
                      <td>{review.before.concurrent}</td>
                      <td>{review.after.concurrent}</td>
                    </tr>
                    {review.after.runners.map((row, index) => (
                      <tr key={row.name}>
                        <td>
                          {row.name}
                          <small>Job limit / request concurrency</small>
                        </td>
                        <td>
                          {review.before!.runners[index].limit} /{" "}
                          {review.before!.runners[index].request_concurrency}
                        </td>
                        <td>
                          {row.limit} / {row.request_concurrency}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {review.archive && (
              <p>
                Archive: {review.archive.name} · {bytes(review.archive.bytes)}
                <small className="archive-digest">
                  SHA-256 {review.archive.sha256}
                </small>
              </p>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  const result = await api<{ message: string }>(
                    "operations/execute",
                    token,
                    { nonce: review.nonce, confirmation },
                  );
                  setMessage(result.message);
                  setReview(undefined);
                  setUpload(undefined);
                  onChanged();
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                  setReview(undefined);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Type <code>{review.confirmation}</code> to confirm
                <input
                  autoComplete="off"
                  aria-label="Operation confirmation"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
              <div className="inline-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setReview(undefined)}
                >
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
                  {busy ? "Applying…" : "Apply reviewed operation"}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}
      <Panel title="Image operation history">
        <div className="table-toolbar">
          <input
            aria-label="Search image operations"
            placeholder="Search image names or results"
            value={jobQuery}
            onChange={(e) => {
              setJobPage(1);
              setJobQuery(e.target.value);
            }}
          />
          <select
            aria-label="Image operation status"
            value={jobStatus}
            onChange={(e) => {
              setJobPage(1);
              setJobStatus(e.target.value);
            }}
          >
            {["all", "queued", "running", "success", "failed", "unknown"].map(
              (status) => (
                <option key={status} value={status}>
                  {status === "all" ? "All results" : status}
                </option>
              ),
            )}
          </select>
        </div>
        {filteredJobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Operation / target</th>
                  <th>Status</th>
                  <th>Result / progress</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs
                  .slice((currentJobPage - 1) * 10, currentJobPage * 10)
                  .map((job) => (
                    <tr key={job.id}>
                      <td>
                        {job.name}
                        <small>{job.action.replaceAll("_", " ")}</small>
                      </td>
                      <td>
                        <span
                          className={`badge ${job.status === "success" ? "good" : job.status === "failed" ? "bad" : "muted"}`}
                        >
                          {job.status}
                        </span>
                      </td>
                      <td>
                        {job.message}
                        {job.image_id && <small>{job.image_id}</small>}
                        {Object.entries(job.imported_images || {}).map(
                          ([tag, id]) => (
                            <small key={tag}>
                              {tag} · {id.slice(0, 24)}
                            </small>
                          ),
                        )}
                      </td>
                      <td>
                        {new Date(job.updated_at * 1000).toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">
            {jobs.length
              ? "No operations match these filters."
              : "Loaded, built, and tagged images will appear here."}
          </p>
        )}
        <Pager
          total={filteredJobs.length}
          page={currentJobPage}
          size={10}
          onPage={setJobPage}
        />
        <p className="muted">
          Latest 50 tasks. Interrupted operations are marked unknown after an
          app restart; inspect live images before retrying. Failed archives
          remain staged for inspection.
        </p>
      </Panel>
    </>
  );
}
