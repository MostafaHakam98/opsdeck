import { useState } from "react";
import { ChevronRight, Gauge, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { ThemeToggle } from "../components/ThemeToggle";

export function SignIn({
  onSignIn,
  central = false,
}: {
  onSignIn: (token: string) => void;
  central?: boolean;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="login-brand">
        <Gauge size={38} />
        <span>OpsDeck</span>
        <p>Your infrastructure, in view.</p>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("snapshot", value);
            onSignIn(value);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <ShieldCheck size={24} />
        <h1>Open your workspace</h1>
        <p>
          Use the access token configured on your server. It stays in this
          browser tab for the session.
        </p>
        <label htmlFor="token">Access token</label>
        <input
          id="token"
          type="password"
          autoComplete="off"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Enter your server access token"
        />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Connecting…" : "Connect to OpsDeck"}
          <ChevronRight size={16} />
        </button>
        <small>
          {central ? "Fleet monitoring" : "Single-host monitoring"} ·
          Credentials stay on the server
        </small>
      </form>
    </main>
  );
}
