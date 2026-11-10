import { useState } from "react";
import { InstallSteps, Step } from "./InstallSteps";
import type { Credential, Node } from "./types";

export type EnrollValues = { name: string; cluster: string; address: string };

/**
 * Enroll host as a walkthrough: name the host, run one command on it, then
 * watch it connect. The credential exists only in this page's state until the
 * operator finishes, so it is shown once, as before.
 */
export function EnrollWalkthrough({
  clusters,
  busy,
  credential,
  node,
  version,
  onCreate,
  onOpenHost,
  onEnrollAnother,
}: {
  clusters: string[];
  busy: boolean;
  credential: Credential | null;
  /** The live fleet entry for the host being enrolled, once created. */
  node?: Node;
  version?: string;
  onCreate: (values: EnrollValues) => void;
  onOpenHost: () => void;
  onEnrollAnother: () => void;
}) {
  const [name, setName] = useState("");
  const [cluster, setCluster] = useState("");
  const [address, setAddress] = useState("");
  const created = !!credential;
  return (
    <>
      <div className="fleet-title">
        <div>
          <h1>Enroll a runner host</h1>
          <p>
            Three steps, about two minutes. One agent per machine, even when it
            runs several runners.
          </p>
        </div>
      </div>
      <ol className="enroll-steps">
        <Step
          number={1}
          title="Name the host"
          state={created ? "done" : "current"}
        >
          <form
            className="fleet-enroll"
            onSubmit={(e) => {
              e.preventDefault();
              onCreate({ name, cluster, address: address.trim() });
            }}
          >
            <fieldset disabled={created || busy}>
              <label>
                Host name
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="build-runner-01"
                />
              </label>
              <label>
                Cluster or network
                <input
                  required
                  maxLength={120}
                  list="fleet-enroll-clusters"
                  value={cluster}
                  onChange={(e) => setCluster(e.target.value)}
                  placeholder="Cairo build cluster"
                />
                <datalist id="fleet-enroll-clusters">
                  {clusters.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label>
                Access address (optional)
                <input
                  maxLength={253}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="172.16.27.118 or runner-01.example.com"
                  spellCheck={false}
                  autoCapitalize="off"
                />
              </label>
            </fieldset>
            <p>
              The machine only needs outbound HTTPS to this server. Its
              credential can send this host&apos;s telemetry and nothing else.
              Without an access address, the address the agent reports is shown
              when you hover the host&apos;s name.
            </p>
            {!created && (
              <button className="primary" disabled={busy}>
                {busy ? "Creating..." : "Create agent credential"}
              </button>
            )}
          </form>
        </Step>
        <InstallSteps
          first={2}
          credential={credential}
          version={version}
          node={node}
        />
      </ol>
      {created && (
        <div className="enroll-finish">
          <button type="button" className="secondary" onClick={onEnrollAnother}>
            Enroll another host
          </button>
          <button type="button" className="primary" onClick={onOpenHost}>
            {node?.status === "online" ? "Open host" : "Done, open host"}
          </button>
        </div>
      )}
    </>
  );
}
