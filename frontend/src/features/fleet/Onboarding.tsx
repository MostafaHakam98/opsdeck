import { ChevronRight } from "lucide-react";

/** First-run panel: the three steps of the Enroll host walkthrough. */
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
            Name the host and its cluster or network. OpsDeck creates a
            credential for this host and shows it once.
          </span>
          <button className="primary" onClick={onEnroll}>
            Enroll host
            <ChevronRight size={16} />
          </button>
        </li>
        <li>
          <strong>Run one command on the host</strong>
          <span>
            The walkthrough shows a command that downloads the installer from
            this server&apos;s version of the OpsDeck repository on GitHub.
            Paste it into a shell on the machine, then paste the credential when
            it asks. Docker and a native service are both supported.
          </span>
        </li>
        <li>
          <strong>Watch it connect</strong>
          <span>
            The walkthrough turns green after the first sample. Hover a
            host&apos;s name anywhere on the fleet page to see its address. Full
            host pages also need a local OpsDeck API; see{" "}
            <code>docs/operations/adding-machines.md</code>.
          </span>
        </li>
      </ol>
    </section>
  );
}
