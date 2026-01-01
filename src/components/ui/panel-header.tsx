import * as React from "react";
import { cn } from "@/lib/utils";

export interface PanelHeaderProps {
  /** Title text to display */
  title: string;
  /** Optional content to display on the right side */
  rightContent?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Background variant */
  variant?: "default" | "dark";
}

/**
 * Panel header component for consistent section headers
 */
export function PanelHeader({
  title,
  rightContent,
  className,
  variant = "dark",
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between px-4 py-2 border-b border-border",
        variant === "dark" ? "bg-app-950" : "bg-card",
        className
      )}
    >
      <span className="text-xs text-muted-foreground uppercase tracking-wider">
        {title}
      </span>
      {rightContent}
    </div>
  );
}

export default PanelHeader;
