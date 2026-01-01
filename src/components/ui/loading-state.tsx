import { memo } from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "./spinner";

export interface LoadingStateProps {
  /** Loading message to display */
  message?: string;
  /** Spinner size */
  size?: "sm" | "md" | "lg" | "xl";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Loading state component with spinner and optional message
 * Memoized to prevent re-renders when props haven't changed
 */
export const LoadingState = memo(function LoadingState({
  message,
  size = "lg",
  className,
}: LoadingStateProps) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <Spinner size={size} />
      {message && <span className="ml-3 text-muted-foreground">{message}</span>}
    </div>
  );
});

export default LoadingState;
