import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import type { Credential } from "./types";

export function AgentCredential({
  credential,
  onSaved,
}: {
  credential: Credential;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const configuration = `OPSDECK_SERVER_URL=${window.location.origin}\nOPSDECK_AGENT_TOKEN=${credential.token}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="fleet-dialog-backdrop">
      <section
        ref={dialog}
        className="fleet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-credential-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons =
            dialog.current?.querySelectorAll<HTMLButtonElement>("button");
          if (!buttons?.length) return;
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id="agent-credential-title">Save this agent credential</h2>
        <p>Shown once. Put it in the private environment file on this host.</p>
        <pre>{configuration}</pre>
        <p>
          From the OpsDeck checkout on the runner, save these values in{" "}
          <code>.env.agent</code>, then run:
        </p>
        <pre>.venv/bin/python -m backend.agent</pre>
        <p>
          For a persistent service, follow <code>docs/operations/fleet.md</code>
          .
        </p>
        <div className="fleet-actions">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(configuration);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Copy size={16} />
            {copied ? "Copied" : "Copy configuration"}
          </button>
          <button className="primary" onClick={onSaved}>
            Saved, view host
          </button>
        </div>
      </section>
    </div>
  );
}
