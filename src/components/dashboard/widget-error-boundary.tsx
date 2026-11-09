"use client";

import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; retryLabel: string };
type State = { failed: boolean };

export class WidgetErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <section className="analytics-widget-error" role="alert">
        <span>—</span><button type="button" onClick={() => window.location.reload()}>{this.props.retryLabel}</button>
      </section>;
    }
    return this.props.children;
  }
}
