import { memo } from "react";
import { cn } from "@/lib/utils";
import { PanelHeader } from "./panel-header";

export interface ProgressBarProps {
  /** Current progress value */
  current: number;
  /** Total value (100%) */
  total: number;
  /** Label text for the current item */
  label?: string;
  /** Status text (e.g., "Copying...", "Complete!") */
  status?: string;
  /** Title for the progress section */
  title?: string;
  /** Whether to show as a card with header */
  showCard?: boolean;
  /** Color variant for the progress bar */
  variant?: "primary" | "success" | "warning" | "error";
  /** Additional CSS classes */
  className?: string;
}

const variantColors = {
  primary: "bg-primary",
  success: "bg-storyblok-green",
  warning: "bg-yellow-500",
  error: "bg-red-500",
};

/**
 * Progress bar component with optional card wrapper
 * Memoized to prevent re-renders when props haven't changed
 */
export const ProgressBar = memo(function ProgressBar({
  current,
  total,
  label,
  status,
  title = "Progress",
  showCard = false,
  variant = "success",
  className,
}: ProgressBarProps) {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  const progressContent = (
    <div className={cn("space-y-3", !showCard && className)}>
      {(label || status) && (
        <div className="flex items-center justify-between">
          <span className="text-sm">{status || label}</span>
          {!showCard && (
            <span className="text-sm text-muted-foreground">
              {current} / {total}
            </span>
          )}
        </div>
      )}
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-150",
            variantColors[variant]
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );

  if (!showCard) {
    return progressContent;
  }

  return (
    <div
      className={cn(
        "bg-card border border-border rounded-xl overflow-hidden",
        className
      )}
    >
      <PanelHeader
        title={title}
        rightContent={
          <span className="text-xs text-muted-foreground">
            {current} / {total}
          </span>
        }
      />
      <div className="p-4">{progressContent}</div>
    </div>
  );
});

/**
 * Simplified progress card for copy/sync operations
 */
export interface ProgressCardProps {
  /** Current progress value */
  current: number;
  /** Total value */
  total: number;
  /** Current item being processed */
  currentItem?: string;
  /** Status: pending, processing, done, error */
  status: "pending" | "processing" | "done" | "error";
  /** Optional error message */
  error?: string;
  /** Additional CSS classes */
  className?: string;
}

export const ProgressCard = memo(function ProgressCard({
  current,
  total,
  currentItem,
  status,
  error,
  className,
}: ProgressCardProps) {
  const percentage = total > 0 ? (current / total) * 100 : 0;

  const statusDisplay = {
    pending: "Preparing...",
    processing: currentItem ? `Processing: ${currentItem}` : "Processing...",
    done: "Complete!",
    error: error || "Error occurred",
  };

  const statusColor = {
    pending: "text-muted-foreground",
    processing: "text-yellow-400",
    done: "text-storyblok-green",
    error: "text-red-400",
  };

  return (
    <div className={cn("p-3 bg-card rounded-lg", className)}>
      <div className="flex items-center justify-between mb-2">
        <span className={cn("text-sm", statusColor[status])}>
          {statusDisplay[status]}
        </span>
        <span className="text-sm text-muted-foreground">
          {current} / {total}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full transition-all",
            status === "error" ? "bg-red-500" : "bg-primary"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
});

export default ProgressBar;
