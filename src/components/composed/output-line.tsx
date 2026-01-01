import { cn } from "@/lib/utils";

export type OutputLineType = "stdout" | "stderr" | "info" | "error" | "complete";

export interface OutputLineData {
  id: number;
  type: OutputLineType;
  data: string;
  timestamp?: number;
}

export interface OutputLineProps {
  /** Output line data */
  line: OutputLineData;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Get color class for output line type
 */
export function getLineColor(type: OutputLineType): string {
  switch (type) {
    case "stdout":
      return "text-foreground";
    case "stderr":
      return "text-yellow-400";
    case "info":
      return "text-blue-400";
    case "error":
      return "text-red-400";
    case "complete":
      return "text-storyblok-green";
    default:
      return "text-muted-foreground";
  }
}

/**
 * Terminal output line with appropriate coloring
 */
export function OutputLine({ line, className }: OutputLineProps) {
  return (
    <div className={cn("whitespace-pre-wrap", getLineColor(line.type), className)}>
      {line.data}
    </div>
  );
}

export default OutputLine;

