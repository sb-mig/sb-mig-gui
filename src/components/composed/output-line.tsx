import { memo } from "react";
import { cn } from "@/lib/utils";
import { getLineColor } from "./output-line.utils";
import type { OutputLineData } from "./output-line.utils";

// Re-export types and utilities for consumers
export type { OutputLineType, OutputLineData } from "./output-line.utils";
// eslint-disable-next-line react-refresh/only-export-components
export { getLineColor } from "./output-line.utils";

export interface OutputLineProps {
  /** Output line data */
  line: OutputLineData;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Terminal output line with appropriate coloring
 * Memoized to prevent re-renders when props haven't changed
 */
export const OutputLine = memo(function OutputLine({
  line,
  className,
}: OutputLineProps) {
  return (
    <div
      className={cn("whitespace-pre-wrap", getLineColor(line.type), className)}
    >
      {line.data}
    </div>
  );
});

export default OutputLine;
