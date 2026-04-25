/**
 * React Error Boundary
 *
 * 자식 컴포넌트에서 throw 된 에러를 캐치하여 fallback UI 를 렌더합니다.
 * NFR Availability: crash 없는 복구 가능한 UI
 */

import React, { Component, ErrorInfo, ReactNode } from "react";
import { logger } from "@/lib/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // 에러 로그 출력
    logger.error("React error boundary caught error", {
      code: "REACT_ERROR",
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex min-h-screen items-center justify-center bg-gray-100">
            <div className="rounded-lg bg-white p-6 shadow-lg">
              <h1 className="text-xl font-bold text-gray-900">
                문제가 발생했습니다
              </h1>
              <p className="mt-2 text-gray-600">
                페이지를 새로고침하거나 나중에 다시 시도해주세요.
              </p>
            </div>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
