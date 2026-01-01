import { cn } from "@/lib/utils";

export interface TitleBarProps {
  /** Title text to display */
  title?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * macOS-style title bar for the app window
 */
export function TitleBar({ title = "sb-mig GUI", className }: TitleBarProps) {
  return (
    <div
      className={cn(
        "h-10 bg-app-950 flex items-center justify-center border-b border-border draggable",
        className
      )}
    >
      <span className="text-sm font-medium text-muted-foreground">{title}</span>
    </div>
  );
}

export default TitleBar;

