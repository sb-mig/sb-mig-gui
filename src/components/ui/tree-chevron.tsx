import { cn } from "@/lib/utils";

export interface TreeChevronProps {
  /** Whether the tree node is expanded */
  expanded: boolean;
  /** Click handler */
  onClick?: (e: React.MouseEvent) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Expand/collapse chevron button for tree views
 */
export function TreeChevron({ expanded, onClick, className }: TreeChevronProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors",
        className
      )}
    >
      {expanded ? "▼" : "▶"}
    </button>
  );
}

export default TreeChevron;

