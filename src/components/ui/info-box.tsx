import * as React from "react";
import { cn } from "@/lib/utils";

export interface InfoBoxProps {
  /** Visual variant */
  variant?: "tip" | "warning" | "info" | "success" | "error";
  /** Optional title/label */
  title?: string;
  /** Content to display */
  children: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

const variantStyles = {
  tip: {
    container: "bg-blue-500/10 border-blue-500/20",
    text: "text-blue-400",
    icon: "💡",
  },
  info: {
    container: "bg-blue-500/10 border-blue-500/20",
    text: "text-blue-400",
    icon: "ℹ️",
  },
  warning: {
    container: "bg-yellow-500/10 border-yellow-500/20",
    text: "text-yellow-400",
    icon: "⚠️",
  },
  success: {
    container: "bg-green-500/10 border-green-500/20",
    text: "text-green-400",
    icon: "✅",
  },
  error: {
    container: "bg-red-500/10 border-red-500/20",
    text: "text-red-400",
    icon: "❌",
  },
};

/**
 * Info box component for displaying tips, warnings, and other notices
 */
export function InfoBox({
  variant = "info",
  title,
  children,
  className,
}: InfoBoxProps) {
  const styles = variantStyles[variant];
  const defaultTitle = variant === "tip" ? "Tip" : undefined;
  const displayTitle = title ?? defaultTitle;

  return (
    <div
      className={cn(
        "rounded-xl border p-4",
        styles.container,
        className
      )}
    >
      <p className={cn("text-sm", styles.text)}>
        {displayTitle && (
          <strong>
            {styles.icon} {displayTitle}:{" "}
          </strong>
        )}
        {children}
      </p>
    </div>
  );
}

export default InfoBox;

