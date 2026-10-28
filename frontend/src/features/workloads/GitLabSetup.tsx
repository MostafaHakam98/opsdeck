import { useHostApi } from "../../lib/HostApi";
import { useEffect, useState } from "react";
type Connection = {
  enabled: boolean;
  url: string;
  token_configured: boolean;
  projects: string[];
  auto_observed: boolean;
  project_limit: number;
};
export function GitLabSetup({
  token,
  onChanged,
}: {
  token: string;
  onChanged: () => void;
}) {
  const { api } = useHostApi();
  const [connection, setConnection] = useState<Connection>(),
    [url, setUrl] = useState(""),
    [secret, setSecret] = useState(""),
    [projects, setProjects] = useState(""),
    [observed, setObserved] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setConnection(undefined);
    setError("");
    void api<Connection>(
      "integrations/gitlab",
      token,
      undefined,
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setConnection(value);
        setUrl(value.url);
        setProjects(value.projects.join("\n"));
        setObserved(value.auto_observed);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, api, loadAttempt]);
  async function save(enabled = true) {
    if (loading || !connection || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const value = await api<Connection>("integrations/gitlab", token, {
        enabled,
        url,
        token: secret,
        projects: projects
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
        auto_observed: observed,
      });
      setConnection(value);
      setSecret("");
      setMessage(
        enabled
          ? "Read-only connection saved. Pipeline polling starts now and repeats every minute."
          : "GitLab polling disabled. Previously retained evidence remains available.",
      );
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>GitLab pipeline results</h2>
        <span>
          {connection?.enabled
            ? "Read-only connection configured"
            : "Optional read-only connection"}
        </span>
      </div>
      <div className="operator-body">
        <p>
          Connect GitLab for confirmed pipeline pass/fail, duration and queue
          data across selected repositories. Local worker and image observation
          continues independently.
        </p>
        {loading && <p role="status">Loading saved GitLab settings…</p>}
        {!loading && !connection && (
          <button
            type="button"
            onClick={() => setLoadAttempt((value) => value + 1)}
          >
            Retry loading GitLab settings
          </button>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset
            className="connection-fields"
            disabled={loading || !connection || busy}
          >
            <label>
              GitLab URL
              <input
                type="url"
                required
                aria-label="GitLab URL"
                value={url}
                maxLength={1024}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://gitlab.example.com"
              />
            </label>
            <label>
              Dedicated read_api token
              <input
                type="password"
                aria-label="GitLab read-only token"
                autoComplete="new-password"
                maxLength={512}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={
                  connection?.token_configured
                    ? "Saved on server; leave blank to keep it"
                    : "Enter a dedicated read_api token"
                }
              />
              <small>
                Stored privately on this node. Saved credentials are never
                returned by the API or included in checkpoints. To create one,
                open How to set this up under GitLab projects below.
              </small>
            </label>
            <label>
              Additional project IDs or namespace/project paths
              <textarea
                aria-label="GitLab project scope"
                rows={3}
                maxLength={6400}
                value={projects}
                onChange={(e) => setProjects(e.target.value)}
                placeholder="One repository per line, or comma-separated"
              />
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={observed}
                onChange={(e) => setObserved(e.target.checked)}
              />{" "}
              Include repositories observed on this runner automatically
            </label>
            <p className="muted">
              Up to 32 projects per poll. Only GET requests are sent to GitLab.
              Recent and active pipelines are retained; use Projects & pipelines
              to read older history pages. Accessible GitLab results may include
              jobs run on other machines.
            </p>
            <div className="inline-actions">
              <button
                className="primary"
                disabled={
                  busy || !url || (!secret && !connection?.token_configured)
                }
              >
                {busy
                  ? "Checking connection…"
                  : "Save and validate read-only connection"}
              </button>
              {connection?.enabled && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save(false)}
                >
                  Disable GitLab polling
                </button>
              )}
            </div>
          </fieldset>
        </form>
      </div>
    </section>
  );
}
