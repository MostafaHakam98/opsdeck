import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

type Step = { text: React.ReactNode; command?: string };
type Guide = { intro: React.ReactNode; steps: Step[]; note?: React.ReactNode };

const workspaceUp = "COMPOSE_PROJECT_NAME=opsdeck-workspace make docker-up";

/** Per-source setup steps shown on Connections; commands run on the monitored host. */
export const setupGuides: Record<string, Guide> = {
  host: {
    intro:
      "Reads CPU, memory, disks and processes from the node itself. Run the workspace with host Compose so it sees the node, not only its own container.",
    steps: [
      {
        text: "Start the local workspace. On NVIDIA hosts use make docker-gpu-up instead.",
        command: workspaceUp,
      },
      {
        text: "Check that it answers on loopback:",
        command: "curl --fail http://127.0.0.1:8080/healthz",
      },
    ],
    note: (
      <>
        Build errors: <code>gpus must be a list</code> means the Docker Compose
        plugin is too old for the GPU override, and{" "}
        <code>--mount option requires BuildKit</code> means the docker buildx
        plugin is missing. Both can be installed per user under{" "}
        <code>~/.docker/cli-plugins</code> without sudo.
      </>
    ),
  },
  docker: {
    intro:
      "Lists containers, images and cache volumes through the Docker socket.",
    steps: [
      {
        text: "Confirm the deployment account can use Docker:",
        command: "docker ps --format '{{.Names}}' | head -3",
      },
      {
        text: "If permission is denied, an administrator adds the account to the docker group. Sign in again afterwards.",
        command: 'sudo usermod -aG docker "$USER"',
      },
      {
        text: "Recreate the workspace so it picks up the socket group:",
        command: workspaceUp,
      },
    ],
    note: (
      <>
        If <code>docker ps</code> is slow, raise{" "}
        <code>OPSDECK_DOCKER_TIMEOUT</code> (2 to 60 seconds) in the workspace
        environment file.
      </>
    ),
  },
  gpu: {
    intro:
      "Reads utilization, VRAM, temperature and power through nvidia-smi. Hosts without an NVIDIA card stay not configured; that is expected.",
    steps: [
      {
        text: "Check that the driver sees the card:",
        command: "nvidia-smi -L",
      },
      {
        text: "Check that Docker lists the nvidia runtime (NVIDIA Container Toolkit):",
        command: "docker info | grep -i runtimes",
      },
      {
        text: "Recreate the workspace and the agent with the GPU override:",
        command: [
          "COMPOSE_PROJECT_NAME=opsdeck-workspace make docker-gpu-up",
          "COMPOSE_PROJECT_NAME=opsdeck-agent make docker-agent-up COMPOSE_EXTRA=deploy/docker/compose.gpu.yaml",
        ].join("\n"),
      },
    ],
  },
  runner: {
    intro:
      "Reads GitLab Runner's local Prometheus listener and a sanitized summary of its configuration. Registration tokens are never read.",
    steps: [
      {
        text: "Check whether the listener already answers:",
        command: "curl --fail --silent http://127.0.0.1:9252/metrics | head",
      },
      {
        text: "If it does not, an administrator enables it for the gitlab-runner system service. The runner restarts gracefully: running jobs finish first, which can take up to an hour.",
        command: "sudo bash scripts/runner/tune-runner-host.sh metrics",
      },
      {
        text: (
          <>
            That also writes <code>data/runner-facts.json</code>. Load it with
            the System services override, or copy it into the workspace:
          </>
        ),
        command:
          "docker cp data/runner-facts.json opsdeck-workspace-opsdeck-1:/data/runner-facts.json",
      },
    ],
    note: "Run the same command again after changing the runner configuration; once metrics are on, it only refreshes the facts. Hosts with Python older than 3.11 run the helper in a Python 3.12 container automatically.",
  },
  gitlab: {
    intro:
      "Adds confirmed pipeline status, duration and queue time. OpsDeck only sends GET requests to GitLab.",
    steps: [
      {
        text: (
          <>
            Create a token with only the <strong>read_api</strong> scope.
            Personal token: avatar menu, <strong>Edit profile</strong>,{" "}
            <strong>Access tokens</strong>, <strong>Add new token</strong>.
            Group token (needs the group Owner role): the group's{" "}
            <strong>Settings</strong>, <strong>Access tokens</strong>, role
            Reporter.
          </>
        ),
      },
      { text: "Copy the token right away; GitLab shows it only once." },
      {
        text: (
          <>
            In <strong>GitLab pipeline results</strong> above, enter the GitLab
            URL and the token, keep{" "}
            <strong>Include repositories observed on this runner</strong>{" "}
            checked, then <strong>Save and validate</strong>.
          </>
        ),
      },
    ],
    note: "Each host keeps its own connection, so repeat this on every host. The same token can be reused.",
  },
  services: {
    intro:
      "Shows the state of docker.service and gitlab-runner.service. Containers usually cannot reach the host's systemd bus, so the host exports that state to a file every minute.",
    steps: [
      {
        text: "Add a cron entry for the deployment account. It records the checkout path at install time.",
        command:
          '(crontab -l 2>/dev/null; echo "* * * * * cd $PWD && /usr/bin/python3 -m deploy.export_services --output data/service-status.json --services docker.service,gitlab-runner.service") | crontab -',
      },
      {
        text: "After a minute, confirm the export is fresh:",
        command: "ls -l data/service-status.json",
      },
      {
        text: "Recreate the workspace and the agent with the services override. It also loads data/runner-facts.json.",
        command: [
          "COMPOSE_PROJECT_NAME=opsdeck-workspace make docker-up COMPOSE_EXTRA=deploy/docker/compose.services.yaml",
          "COMPOSE_PROJECT_NAME=opsdeck-agent make docker-agent-up COMPOSE_EXTRA=deploy/docker/compose.services.yaml",
        ].join("\n"),
      },
    ],
    note: (
      <>
        On NVIDIA hosts use <code>make docker-gpu-up</code> for the workspace
        and give the agent both overrides:{" "}
        <code>
          COMPOSE_EXTRA="deploy/docker/compose.services.yaml -f
          deploy/docker/compose.gpu.yaml"
        </code>
        . Exports older than about two minutes count as stale.
      </>
    ),
  },
  findings: {
    intro:
      "Optional. Shows imported benchmark results and optimization evidence for this host. Not configured is normal until a survey is imported.",
    steps: [
      {
        text: (
          <>
            Write the survey as JSON following the version 1 schema in{" "}
            <code>backend/findings.py</code>.
          </>
        ),
      },
      {
        text: "Import it into the running workspace. It is validated first and needs no restart.",
        command:
          "COMPOSE_PROJECT_NAME=opsdeck-workspace make docker-import-survey SURVEY=/path/to/survey.json",
      },
    ],
  },
};

function Command({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="command">
      <pre>{command}</pre>
      <button
        type="button"
        className="icon-button"
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy command"}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(command);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/** Collapsible setup steps; opens by default while the source is not healthy. */
export function SetupHelp({
  source,
  healthy,
}: {
  source: string;
  healthy: boolean;
}) {
  const guide = setupGuides[source];
  if (!guide) return null;
  const hasCommands = guide.steps.some((step) => step.command);
  return (
    <details className="setup-help" open={!healthy}>
      <summary>How to set this up</summary>
      <div className="setup-help-body">
        <p>{guide.intro}</p>
        <ol>
          {guide.steps.map((step, index) => (
            <li key={index}>
              {step.text}
              {step.command && <Command command={step.command} />}
            </li>
          ))}
        </ol>
        {guide.note && <p className="setup-help-note">{guide.note}</p>}
        {hasCommands && (
          <p className="setup-help-note">
            Run commands on this host, from its OpsDeck checkout (
            <code>~/opsdeck</code> in the standard install). Use the Compose
            project names this host already runs under.
          </p>
        )}
      </div>
    </details>
  );
}
