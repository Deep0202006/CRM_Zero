"use client";

import { Component, ErrorInfo, ReactNode } from "react";
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
        <section className="alert-panel alert-panel--danger my-4" role="alert" aria-live="assertive">
          <span className="alert-panel__icon" aria-hidden="true"><AlertCircle size={19} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">
              {this.props.fallbackTitle || "This section could not be loaded"}
            </h3>
            <p className="mt-1 max-w-2xl break-words text-[12px] leading-5 text-[var(--text-secondary)]">
              {this.state.error?.message || "An unexpected rendering error occurred."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={this.handleReset}
            icon={<RefreshCw size={14} />}
          >
            Try again
          </Button>
        </section>
      );
    }

    return this.props.children;
  }
}
