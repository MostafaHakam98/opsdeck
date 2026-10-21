import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FleetApp } from "../features/fleet/FleetApp";
import { HostWorkspace, SignIn } from "./HostWorkspace";
import { applyTheme, storedTheme } from "../components/ThemeToggle";
applyTheme(storedTheme());

function Deployment() {
  const [mode, setMode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/healthz", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Server unavailable");
        return response.json();
      })
      .then((data) => setMode(data.mode || "standalone"))
      .catch((err) => {
        if (!controller.signal.aborted) setError((err as Error).message);
      });
    return () => controller.abort();
  }, [retry]);
  if (!mode)
    return (
      <main className="login">
        <p>{error || "Connecting to OpsDeck..."}</p>
        {error && (
          <button
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            Retry connection
          </button>
        )}
      </main>
    );
  return mode === "central" ? (
    <FleetApp signIn={(callback) => <SignIn central onSignIn={callback} />} />
  ) : (
    <HostWorkspace />
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Deployment />
  </React.StrictMode>,
);
