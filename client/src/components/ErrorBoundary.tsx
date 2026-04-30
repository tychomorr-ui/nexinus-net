import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#050816] px-6 py-12 text-white">
          <div className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-[0_0_80px_rgba(74,36,194,0.2)] backdrop-blur-xl">
            <div className="flex items-center gap-3 text-cyan-200">
              <AlertTriangle className="h-6 w-6" />
              <p className="text-sm uppercase tracking-[0.35em]">Sovereign runtime interruption</p>
            </div>

            <h2 className="mt-6 text-3xl font-semibold">The clarity surface hit an unexpected fault.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">
              The runtime did not fully collapse, but this view needs to be refreshed before the Omni Sphere can continue.
            </p>

            {import.meta.env.DEV && this.state.error ? (
              <details className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300">
                <summary className="cursor-pointer font-medium text-white">Development diagnostics</summary>
                <pre className="mt-4 whitespace-pre-wrap break-words text-xs text-slate-400">
                  {this.state.error.stack ?? this.state.error.message}
                </pre>
              </details>
            ) : null}

            <div className="mt-8 flex flex-wrap gap-3">
              <Button className="bg-cyan-400 text-slate-950 hover:bg-cyan-300" onClick={() => window.location.reload()}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Reload canonical surface
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
