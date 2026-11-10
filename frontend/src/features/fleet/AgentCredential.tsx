import { useEffect, useRef } from "react";
import { InstallSteps } from "./InstallSteps";
import type { Credential, Node } from "./types";

const FOCUSABLE = "button, input, a[href]";

/**
 * After Rotate credential: the same install steps as Enroll host, in a dialog,
 * because the new credential is shown once and the old agent is now cut off.
 */
export function AgentCredential({
  credential,
  version,
  node,
  onSaved,
}: {
  credential: Credential;
  /** Server build version; the installer checks out the same commit. */
  version?: string;
  node?: Node;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="fleet-dialog-backdrop">
      <section
        ref={dialog}
        className="fleet-dialog enroll-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-credential-title"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items =
            dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
          if (!items?.length) return;
          const first = items[0],
            last = items[items.length - 1];
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
        <h2 id="agent-credential-title">
          Reconnect {credential.name || "this host"} with its new credential
        </h2>
        <p>
          The previous credential no longer works. Run the installer on the
          machine again; it updates the existing checkout and replaces its{" "}
          <code>.env.agent</code>.
        </p>
        <ol className="enroll-steps">
          <InstallSteps
            first={1}
            credential={credential}
            version={version}
            node={node}
          />
        </ol>
        <div className="fleet-actions">
          <button type="button" className="primary" onClick={onSaved}>
            Done, view host
          </button>
        </div>
      </section>
    </div>
  );
}
