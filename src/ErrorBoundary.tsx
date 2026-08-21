import { Component, type ErrorInfo, type ReactNode } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

/**
 * React unmounts the whole tree when a render throws and nothing catches it.
 * For a desktop window that reads as the application vanishing: no message, no
 * menu, nothing to copy, and no way back short of quitting — which is what a
 * single malformed record from the local host used to cost.
 *
 * This keeps the failure the size of the failure. It reports what broke, and
 * offers to rebuild the workspace, because the host holds the queue and the
 * library — a remount asks for both again rather than resuming from state that
 * has already proven unsound.
 */
type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept local, like everything else Philon records. The component trace is
    // the half that says which surface failed, and it is not in `error`.
    console.error("Philon: a workspace surface failed to render.", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="render-failure" role="alert">
        <WarningCircle size={30} weight="fill" />
        <h1>This part of the workspace could not be shown</h1>
        <p>
          Philon stopped drawing rather than show something it could not stand behind. Your documents and
          their conversions are untouched — nothing was written and nothing was sent anywhere.
        </p>
        <pre>{error.message || String(error)}</pre>
        <button className="primary-button" type="button" onClick={() => this.setState({ error: null })}>
          <ArrowClockwise size={17} /> Reload the workspace
        </button>
      </section>
    );
  }
}
