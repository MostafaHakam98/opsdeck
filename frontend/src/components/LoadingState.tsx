import { RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { getRequestActivity, subscribeRequests } from "../lib/request";
import "./loading.css";

export function useRequestActivity() {
  return useSyncExternalStore(
    subscribeRequests,
    getRequestActivity,
    getRequestActivity,
  );
}

/** Indeterminate: network work has no honest percentage to display. */
export function RequestProgress() {
  const { pending, retrying } = useRequestActivity();
  return pending ? (
    <div
      className="request-progress"
      role="progressbar"
      aria-label={retrying ? "Reconnecting to server" : "Updating data"}
    >
      <span />
    </div>
  ) : null;
}

export function LoadingState({
  title = "Loading host data",
  detail = "Connecting to your host and gathering the latest readings.",
  skeleton = true,
}: {
  title?: string;
  detail?: string;
  skeleton?: boolean;
}) {
  const { retrying } = useRequestActivity();
  return (
    <section className="loading-state" aria-busy="true" aria-label={title}>
      <div className="loading-state-heading" role="status">
        <RefreshCw size={20} className="loading-spin" aria-hidden="true" />
        <div>
          <strong>{retrying ? "Reconnecting automatically…" : title}</strong>
          <p>
            {retrying
              ? "The connection was interrupted. Trying again; your place is saved."
              : detail}
          </p>
        </div>
      </div>
      <div className="loading-track" role="progressbar" aria-label={title}>
        <span />
      </div>
      {skeleton && (
        <div className="loading-readings" aria-hidden="true">
          {[0, 1, 2, 3].map((key) => (
            <div key={key}>
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
