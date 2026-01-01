import { memo } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps {
  /** Visual variant */
  variant?: "default" | "success" | "error" | "warning" | "info";
  /** Badge content */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

const variantStyles = {
  default: "bg-muted text-muted-foreground",
  success: "bg-storyblok-green/20 text-storyblok-green",
  error: "bg-destructive/20 text-destructive",
  warning: "bg-yellow-500/20 text-yellow-400",
  info: "bg-blue-500/20 text-blue-400",
};

/**
 * Badge/pill component for status indicators
 * Memoized to prevent re-renders when props haven't changed
 */
export const Badge = memo(function Badge({
  variant = "default",
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "px-3 py-1 rounded-lg text-sm inline-flex items-center gap-2",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
});

export default Badge;

