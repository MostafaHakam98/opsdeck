import React, { useState } from "react";
import { Check, Copy, Eye, EyeOff, ExternalLink } from "lucide-react";
import { Segmented, Status } from "./FleetComponents";
import { accessAddress } from "./fleetModel";
import {
  AGENT_DIRECTORY,
  bootstrapSourceUrl,
  installCommand,
  sourceRef,
  type InstallMethod,
} from "./installScript";
import type { Credential, Node } from "./types";

const METHODS: Array<{ value: InstallMethod; label: string }> = [
  { value: "docker", label: "Docker" },
  { value: "native", label: "Native service" },
];
const NEEDS: Record<InstallMethod, string> = {
  docker:
    "git, GNU Make, Python 3, and Docker Engine with Compose v2 that this account can use.",
  native:
    "git, GNU Make, Python 3.12+, and a systemd user session. No Docker needed.",
};

export type StepState = "done" | "current" | "upcoming";

export function Step({
  number,
  title,
  state,
  children,
}: {
  number: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <li className="enroll-step" data-state={state}>
      <h2>
        <span className="enroll-step-number" aria-hidden="true">
          {state === "done" ? <Check size={14} /> : number}
        </span>
        <span>
          <span className="visually-hidden">Step {number}: </span>
          {title}
        </span>
      </h2>
      <div className="enroll-step-body">{children}</div>
    </li>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Copied" : label}
    </button>
  );
}

/** The credential is masked until asked for, and only ever copied, never put in a command. */
function CredentialField({ token }: { token: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="enroll-credential">
      <input
        readOnly
        aria-label="Agent credential"
        type={visible ? "text" : "password"}
        value={token}
        spellCheck={false}
        autoComplete="off"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className="fleet-icon-button"
        aria-label={visible ? "Hide credential" : "Show credential"}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
      <CopyButton text={token} label="Copy credential" />
    </div>
  );
}

/**
 * The two steps after a credential exists: run the installer on the machine,
 * then watch this host connect. `node` is the live fleet entry for the host.
 */
export function InstallSteps({
  first,
  credential,
  version,
  node,
}: {
  first: number;
  credential: Credential | null;
  version?: string;
  node?: Node;
}) {
  const [method, setMethod] = useState<InstallMethod>("docker");
  const command = installCommand({
    method,
    origin: window.location.origin,
    version,
  });
  const connected =
    !!node && (node.status === "online" || node.status === "stale");
  const address = node ? accessAddress(node) : null;
  return (
    <>
      <Step
        number={first}
        title="Run the installer on the machine"
        state={!credential ? "upcoming" : connected ? "done" : "current"}
      >
        <p>
          Open a shell on the machine as the account that should run the agent,
          for example over SSH, and paste this command. It contains no secret.
        </p>
        <Segmented
          label="Install method"
          value={method}
          options={METHODS}
          onChange={setMethod}
        />
        <p className="fleet-hint">
          <span>Needs {NEEDS[method]}</span>
        </p>
        <pre className="enroll-command" aria-label="Install command">
          {command}
        </pre>
        <div className="enroll-actions">
          <CopyButton text={command} label="Copy command" />
          <a
            className="enroll-source"
            href={bootstrapSourceUrl(version)}
            target="_blank"
            rel="noreferrer"
          >
            Read the script on GitHub
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <p className="fleet-hint">
          <span>
            It downloads <code>deploy/bootstrap-agent.sh</code> at{" "}
            <code>{sourceRef(version)}</code>, the version this server runs,
            checks out OpsDeck in <code>{AGENT_DIRECTORY}</code>, writes a
            private <code>.env.agent</code>, and starts the agent. Rerunning it
            later updates the same checkout.
          </span>
        </p>
        <h3>When the installer asks, paste this credential</h3>
        {credential ? (
          <>
            <CredentialField token={credential.token} />
            <p className="fleet-hint">
              <span>
                Shown once and stored only as a hash. If it is lost, rotate the
                credential from the host&apos;s Agent access panel. The input on
                the machine stays hidden while you paste.
              </span>
            </p>
          </>
        ) : (
          <p className="fleet-na">
            Create the agent credential first; it appears here.
          </p>
        )}
      </Step>
      <Step
        number={first + 1}
        title="Wait for the first sample"
        state={!credential ? "upcoming" : connected ? "done" : "current"}
      >
        {!credential ? (
          <p className="fleet-na">
            The host connects after the installer runs.
          </p>
        ) : connected ? (
          <p className="enroll-connected" role="status">
            <Status value={node!.status} />
            <span>
              Connected as <code>{node!.hostname || node!.name}</code>
              {address ? (
                <>
                  {" "}
                  at <code>{address}</code>
                </>
              ) : null}
              .
            </span>
          </p>
        ) : (
          <p className="enroll-waiting" role="status">
            <span className="enroll-pulse" aria-hidden="true" />
            Waiting for the agent. This updates by itself, usually within a
            minute of the installer finishing.
          </p>
        )}
      </Step>
    </>
  );
}
