"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "./Button";

interface Props {
  children?: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught UI Exception:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center p-6 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 rounded-[var(--radius-xl)] text-center space-y-3 my-4">
          <AlertCircle size={32} className="text-[var(--status-danger)]" />
          <h3 className="text-sm font-black text-[var(--status-danger)]">
            {this.props.fallbackTitle || "Something went wrong loading this component"}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] font-mono max-w-md break-words bg-[var(--surface-primary)] p-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)]">
            {this.state.error?.message || "An unexpected rendering error occurred."}
          </p>
          <Button
            variant="danger"
            size="sm"
            onClick={this.handleReset}
            icon={<RefreshCw size={14} />}
          >
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
