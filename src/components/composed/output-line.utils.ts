export type OutputLineType = "stdout" | "stderr" | "info" | "error" | "complete";

export interface OutputLineData {
  id: number;
  type: OutputLineType;
  data: string;
  timestamp?: number;
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

