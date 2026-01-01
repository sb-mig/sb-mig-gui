import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Emoji or icon to display */
  icon: string;
  /** Optional title above the message */
  title?: string;
  /** Main message text */
  message: string;
  /** Optional secondary message */
  submessage?: string;
  /** Optional action button or content */
  action?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

/**
 * Empty state component for displaying when there's no content
 */
export function EmptyState({
  icon,
  title,
  message,
  submessage,
  action,
  className,
  size = "md",
}: EmptyStateProps) {
  const sizeClasses = {
    sm: {
      container: "py-4",
      icon: "text-3xl mb-2",
      title: "text-base",
      message: "text-sm",
    },
    md: {
      container: "py-8",
      icon: "text-4xl mb-4",
      title: "text-lg",
      message: "text-base",
    },
    lg: {
      container: "py-12",
      icon: "text-6xl mb-4",
      title: "text-xl",
      message: "text-base",
    },
  };

  const sizes = sizeClasses[size];

  return (
    <div className={cn("text-center text-muted-foreground", sizes.container, className)}>
      <span className={cn("block", sizes.icon)}>{icon}</span>
      {title && (
        <h3 className={cn("font-semibold text-foreground mb-2", sizes.title)}>
          {title}
        </h3>
      )}
      <p className={sizes.message}>{message}</p>
      {submessage && (
        <p className="text-sm mt-1 text-muted-foreground">{submessage}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default EmptyState;

