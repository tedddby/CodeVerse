"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface DemoErrorBoundaryProps {
  /** Called once when the demo fails (chunk load error, WebGL context failure, ...). */
  onError: (error: unknown) => void;
  children: ReactNode;
}

interface DemoErrorBoundaryState {
  failed: boolean;
}

/**
 * Contains failures of the optional 3D demo so they never break the landing
 * page; the static poster stays visible instead.
 */
export class DemoErrorBoundary extends Component<DemoErrorBoundaryProps, DemoErrorBoundaryState> {
  override state: DemoErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): DemoErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[codeverse] landing demo failed to start", error, info.componentStack);
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}
