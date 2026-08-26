import { Component, isValidElement, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  label?: string;
  compact?: boolean;
  /** Change this after a shell rewrite so a stuck error panel remounts. */
  resetKey?: string | number;
}

interface State {
  error?: Error;
}

function sameElementType(left: ReactNode, right: ReactNode): boolean {
  const a = Array.isArray(left) ? left : [left];
  const b = Array.isArray(right) ? right : [right];
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    if (isValidElement(item) && isValidElement(other)) return item.type === other.type;
    return true;
  });
}

export class ViewErrorBoundary extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${this.props.label ?? "View"} crashed`, error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (!this.state.error) return;
    if (prev.label !== this.props.label || prev.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined });
      return;
    }
    // Fast Refresh replaces the child function; retry instead of keeping a
    // stale ReferenceError on screen (the Inspector `dir` crash).
    if (!sameElementType(prev.children, this.props.children)) {
      this.setState({ error: undefined });
    }
  }

  private retry = () => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const error = this.state.error;
    if (!error) return this.props.children;
    if (this.props.compact) {
      return (
        <div className="notice">
          {this.props.label ?? "This panel"} hit an error: {error.message}{" "}
          <button className="chip" type="button" onClick={this.retry}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <section className="panel">
        <div className="panel-inner">
          <div className="card">
            <h3>{this.props.label ?? "This panel"} hit an error</h3>
            <p className="muted">
              The rest of Capsule is still running. Retry this panel or switch views from the
              sidebar.
            </p>
            <pre className="mono">{error.stack ?? error.message}</pre>
            <div className="actions">
              <button className="send" type="button" onClick={this.retry}>
                Retry
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }
}
