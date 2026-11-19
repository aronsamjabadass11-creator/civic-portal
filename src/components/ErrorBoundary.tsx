import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Portal ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F7F5F0] text-[#1C2B39] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-[#D8D3C8] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#1C2B39]">
              <AlertTriangle className="w-6 h-6 text-[#E2A63B] shrink-0" />
              <h1 className="text-lg font-semibold">Portal Session Interrupted</h1>
            </div>
            <p className="text-sm text-[#6B7280] break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2F5D8A] text-white text-sm font-medium rounded-lg hover:bg-[#244A6E] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reload Portal
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
