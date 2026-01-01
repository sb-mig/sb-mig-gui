import { memo } from "react";
import { cn } from "@/lib/utils";

export interface ButtonGroupProps {
  /** Group label */
  label: string;
  /** Buttons to render */
  children: React.ReactNode;
  /** Show divider on the right */
  showDivider?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Labeled button group for toolbar sections
 * Memoized to prevent re-renders when props haven't changed
 */
export const ButtonGroup = memo(function ButtonGroup({
  label,
  children,
  showDivider = true,
  className,
}: ButtonGroupProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1",
        showDivider && "pr-3 border-r border-border",
        className
      )}
    >
      <span className="text-xs text-muted-foreground uppercase mr-2">
        {label}
      </span>
      {children}
    </div>
  );
});

export default ButtonGroup;

