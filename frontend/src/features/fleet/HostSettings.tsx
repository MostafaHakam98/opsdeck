import { useState } from "react";
import { api } from "../../lib/api";
import { Section } from "./FleetComponents";
import type { Node } from "./types";

const NOTES_MAX = 500;

type Values = {
  name: string;
  cluster: string;
  notes: string;
  maintenance: boolean;
};
function values(node: Node): Values {
  return {
    name: node.name,
    cluster: node.cluster,
    notes: node.notes || "",
    maintenance: Boolean(node.maintenance),
  };
}

/** Rename, move, annotate or pause alerts for one host. */
export function HostSettings({
  node,
  token,
  clusters,
  onSaved,
}: {
  node: Node;
  token: string;
  clusters: string[];
  onSaved: (node: Node) => void;
}) {
  // Changes are measured against what this form loaded, not the polled node,
  // so saving one field never reverts another operator's newer change.
  const [base, setBase] = useState(() => values(node));
  const [name, setName] = useState(base.name);
  const [cluster, setCluster] = useState(base.cluster);
  const [notes, setNotes] = useState(base.notes);
  const [maintenance, setMaintenance] = useState(base.maintenance);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const changes: Partial<
    Pick<Node, "name" | "cluster" | "notes" | "maintenance">
  > = {};
  if (name.trim() !== base.name) changes.name = name.trim();
  if (cluster.trim() !== base.cluster) changes.cluster = cluster.trim();
  if (notes !== base.notes) changes.notes = notes;
  if (maintenance !== base.maintenance) changes.maintenance = maintenance;
  const dirty = Object.keys(changes).length > 0;
  const valid = name.trim().length > 0 && cluster.trim().length > 0;
  async function save() {
    setBusy(true);
    setResult(null);
    try {
      const updated = await api<Node>(
        `fleet/nodes/${node.id}/settings`,
        token,
        changes,
      );
      const saved = values(updated);
      setBase(saved);
      setName(saved.name);
      setCluster(saved.cluster);
      setNotes(saved.notes);
      setMaintenance(saved.maintenance);
      setResult({ ok: true, text: "Settings saved." });
      onSaved(updated);
    } catch (err) {
      setResult({
        ok: false,
        text: `Settings were not saved: ${(err as Error).message}`,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Host settings" className="fleet-settings">
      <form
        className="fleet-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && valid) void save();
        }}
      >
        <label>
          Name
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Cluster
          <input
            required
            maxLength={120}
            list="fleet-cluster-options"
            value={cluster}
            onChange={(e) => setCluster(e.target.value)}
          />
          <datalist id="fleet-cluster-options">
            {clusters.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="fleet-form-wide">
          Notes
          <textarea
            rows={3}
            maxLength={NOTES_MAX}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Rack, owner, hardware quirks or planned work"
          />
          <small>
            {notes.length} of {NOTES_MAX} characters. Notes are searchable on
            the fleet page.
          </small>
        </label>
        <label className="fleet-switch fleet-form-wide">
          <input
            type="checkbox"
            role="switch"
            checked={maintenance}
            onChange={(e) => setMaintenance(e.target.checked)}
          />
          <span>
            <strong>Maintenance mode</strong>
            <small>
              While on, this host raises no alerts and shows as maintenance.
              Telemetry is still recorded.
            </small>
          </span>
        </label>
        <div className="fleet-actions fleet-form-wide">
          <button
            type="submit"
            className="primary"
            disabled={busy || !dirty || !valid}
          >
            {busy ? "Saving..." : "Save settings"}
          </button>
          {dirty && !busy && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                // Discard reloads the latest server values.
                const latest = values(node);
                setBase(latest);
                setName(latest.name);
                setCluster(latest.cluster);
                setNotes(latest.notes);
                setMaintenance(latest.maintenance);
                setResult(null);
              }}
            >
              Discard changes
            </button>
          )}
          {result && (
            <span
              role={result.ok ? "status" : "alert"}
              className={result.ok ? "tone-good" : "tone-bad"}
            >
              {result.text}
            </span>
          )}
        </div>
      </form>
    </Section>
  );
}

/** Credential rotation and revocation, behind a typed host-name check. */
export function DangerZone({
  node,
  confirm,
  onConfirm,
  busy,
  onRotate,
  onRevoke,
}: {
  node: Node;
  confirm: string;
  onConfirm: (value: string) => void;
  busy: boolean;
  onRotate: () => void;
  onRevoke: () => void;
}) {
  const matches = confirm === node.name;
  return (
    <Section title="Agent access" className="fleet-danger">
      <p className="fleet-context">
        Danger zone. Rotate replaces this host's credential and disconnects the
        running agent until it has the new one. Revoke stops it from sending
        telemetry. Retained observations remain available.
      </p>
      <label>
        Type the host name to confirm
        <input
          aria-label="Confirm host name"
          value={confirm}
          onChange={(e) => onConfirm(e.target.value)}
          placeholder={node.name}
          autoComplete="off"
        />
      </label>
      <div className="fleet-actions">
        <button
          className="secondary"
          disabled={busy || !matches}
          onClick={onRotate}
        >
          Rotate credential
        </button>
        <button
          className="danger"
          disabled={busy || !matches || node.status === "revoked"}
          onClick={onRevoke}
        >
          Revoke agent
        </button>
      </div>
    </Section>
  );
}
