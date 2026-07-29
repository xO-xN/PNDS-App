import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
}

/**
 * Error boundary that shows a user-friendly fallback instead of a blank
 * window when the React tree crashes. PNDS keeps no unsaved user data, so
 * there is nothing to persist here — a reload is a full reset.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('Application crashed', {
      error: error.message,
      stack: error.stack,
    })
    this.setState({ errorInfo })
  }

  private handleReload = () => {
    window.location.reload()
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined })
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8">
          <div className="w-full max-w-md text-center">
            <div className="mb-6">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
                <svg
                  className="h-8 w-8 text-destructive"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <h1 className="mb-2 text-2xl font-bold text-foreground">
                Something went wrong
              </h1>
              <p className="mb-6 text-muted-foreground">
                The application encountered an unexpected error.
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={this.handleReload}
                className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Reload Application
              </button>

              <button
                onClick={this.handleReset}
                className="w-full rounded-md bg-secondary px-4 py-2 text-secondary-foreground transition-colors hover:bg-secondary/90"
              >
                Try Again
              </button>
            </div>

            {import.meta.env.DEV && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Error Details (Development Only)
                </summary>
                <div className="mt-2 rounded-md bg-muted p-3 font-mono text-xs">
                  <div className="mb-1 font-semibold text-destructive">
                    {this.state.error.name}: {this.state.error.message}
                  </div>
                  {this.state.error.stack && (
                    <pre className="overflow-auto whitespace-pre-wrap text-muted-foreground">
                      {this.state.error.stack}
                    </pre>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
