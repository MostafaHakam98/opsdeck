import { ChevronRight } from "lucide-react";

/** First-run panel: the three real steps from docs/operations/fleet.md. */
export function Onboarding({ onEnroll }: { onEnroll: () => void }) {
  return (
    <section className="fleet-onboarding" aria-labelledby="fleet-onboarding">
      <h2 id="fleet-onboarding">Connect your first runner host</h2>
      <p>
        Each runner host runs one outbound agent. It needs HTTPS access to this
        server and no inbound ports. Hosts appear here after their first sample.
      </p>
      <ol>
        <li>
          <strong>Enroll the host</strong>
          <span>
            Name the host and its cluster or network. OpsDeck shows a credential
            for this host once.
          </span>
          <button className="primary" onClick={onEnroll}>
            Enroll host
            <ChevronRight size={16} />
          </button>
        </li>
        <li>
          <strong>Save the credential on the host</strong>
          <span>
            In the OpsDeck checkout on the runner, put the displayed{" "}
            <code>OPSDECK_SERVER_URL</code> and <code>OPSDECK_AGENT_TOKEN</code>{" "}
            in a private <code>.env.agent</code> file, then restrict it:
          </span>
          <pre>chmod 600 .env.agent</pre>
        </li>
        <li>
          <strong>Install the agent service</strong>
          <span>
            With the backend dependencies installed in <code>.venv</code>, run
            the installer. It validates <code>.env.agent</code> and starts a
            persistent user service.
          </span>
          <pre>make agent-install</pre>
          <span>
            Check it with <code>make agent-status</code>. Full steps are in{" "}
            <code>docs/operations/fleet.md</code>.
          </span>
          <span>
            Full host pages also need a local OpsDeck API and the agent’s{" "}
            <code>OPSDECK_WORKSPACE_URL</code> and{" "}
            <code>OPSDECK_WORKSPACE_TOKEN</code>. An online telemetry agent
            alone does not connect those pages.
          </span>
        </li>
      </ol>
    </section>
  );
}
