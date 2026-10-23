import { useState, type CSSProperties } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import { api } from "../lib/api";
import { ThemeToggle } from "../components/ThemeToggle";
import { BrandMark } from "../components/AppSidebar";

/** Deterministic load pattern for the decorative pulse strip (no data):
 * a calm fleet with one host running hot for a few minutes. */
const incident = [3, 4, 5, 5, 5, 4, 3];
const pulse = Array.from({ length: 6 }, (_, row) =>
  Array.from({ length: 24 }, (_, col) => {
    if (row === 2 && col >= 14 && col < 14 + incident.length)
      return incident[col - 14];
    const wave =
      Math.sin((col + row * 5) / 3.3) * 0.9 +
      Math.sin((col * 0.7 - row) / 2.1) * 0.6;
    return Math.max(0, Math.min(3, Math.round(1.2 + wave)));
  }),
);

function signInError(err: unknown) {
  const message = (err as Error)?.message || "";
  if (/invalid or expired/i.test(message))
    return "That token was not accepted. Check the access token configured on the server, then try again.";
  if (err instanceof TypeError)
    return "Could not reach the OpsDeck server. Check your connection, then try again.";
  return message || "Sign in failed. Try again.";
}

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
  const [visible, setVisible] = useState(false);
  return (
    <main className="login sign-in">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <section className="login-brand" aria-label="About OpsDeck">
        <div className="login-wordmark">
          <BrandMark size={22} />
          <span>OpsDeck</span>
        </div>
        <p className="login-purpose">
          Health and capacity for your CI runner hosts.
        </p>
        <div className="login-pulse" aria-hidden="true">
          {pulse.map((row, r) => (
            <div key={r}>
              {row.map((level, c) => (
                <i
                  key={c}
                  style={
                    {
                      background: `var(--heat-${level})`,
                      "--c": c,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          ))}
        </div>
        <p className="login-mode">
          {central
            ? "Fleet monitoring: every enrolled host on one board."
            : "Single-host monitoring: this server's runners and workloads."}
        </p>
      </section>
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("snapshot", value);
            onSignIn(value);
          } catch (err) {
            setError(signInError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1>Open your workspace</h1>
        <p>Use the access token configured on your OpsDeck server.</p>
        <label htmlFor="token">Access token</label>
        <div className="token-field">
          <input
            id="token"
            type={visible ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste your server access token"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "token-error" : "token-note"}
          />
          <button
            type="button"
            className="token-reveal"
            aria-label={visible ? "Hide access token" : "Show access token"}
            aria-pressed={visible}
            title={visible ? "Hide access token" : "Show access token"}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && (
          <p className="error" id="token-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Connecting…" : "Connect to OpsDeck"}
          <ArrowRight size={16} />
        </button>
        <small className="login-note" id="token-note">
          <LockKeyhole size={14} aria-hidden="true" />
          Remembered for this browser tab only. Credentials stay on the server.
        </small>
      </form>
    </main>
  );
}
