import { Component, type ReactNode } from "react";

/** Recover a failed page/chunk load without leaving the operator on a blank screen. */
export class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="login" role="alert">
          <h1>Workspace could not load</h1>
          <p>Refresh to reconnect to OpsDeck.</p>
          <button onClick={() => window.location.reload()}>
            Reload workspace
          </button>
        </main>
      );
    return this.props.children;
  }
}
