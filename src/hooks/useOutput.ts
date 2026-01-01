import { useState, useRef, useCallback } from "react";

/**
 * Output line from sb-mig command or API operation
 */
export interface OutputLine {
  id: number;
  type: "stdout" | "stderr" | "info" | "error" | "complete";
  data: string;
  timestamp: number;
}

export type OutputLineType = OutputLine["type"];

/** Maximum number of output lines to retain (prevents memory bloat) */
const MAX_OUTPUT_LINES = 1000;

/**
 * Hook for managing terminal/log output state
 * Replaces repetitive setOutput patterns throughout the app
 */
export function useOutput() {
  const [output, setOutput] = useState<OutputLine[]>([]);
  const lineIdRef = useRef(0);

  /**
   * Add a single line to the output (capped at MAX_OUTPUT_LINES)
   */
  const addLine = useCallback((type: OutputLineType, data: string) => {
    setOutput((prev) => {
      const newLines = [
        ...prev,
        {
          id: lineIdRef.current++,
          type,
          data,
          timestamp: Date.now(),
        },
      ];
      return newLines.length > MAX_OUTPUT_LINES
        ? newLines.slice(-MAX_OUTPUT_LINES)
        : newLines;
    });
  }, []);

  /**
   * Add multiple lines at once (capped at MAX_OUTPUT_LINES)
   */
  const addLines = useCallback(
    (lines: { type: OutputLineType; data: string }[]) => {
      setOutput((prev) => {
        const newLines = [
          ...prev,
          ...lines.map((line) => ({
            id: lineIdRef.current++,
            type: line.type,
            data: line.data,
            timestamp: Date.now(),
          })),
        ];
        return newLines.length > MAX_OUTPUT_LINES
          ? newLines.slice(-MAX_OUTPUT_LINES)
          : newLines;
      });
    },
    []
  );

  /**
   * Clear all output
   */
  const clear = useCallback(() => {
    setOutput([]);
    lineIdRef.current = 0;
  }, []);

  /**
   * Add an info line
   */
  const info = useCallback(
    (data: string) => {
      addLine("info", data);
    },
    [addLine]
  );

  /**
   * Add an error line
   */
  const error = useCallback(
    (data: string) => {
      addLine("error", data);
    },
    [addLine]
  );

  /**
   * Add a complete/success line
   */
  const complete = useCallback(
    (data: string) => {
      addLine("complete", data);
    },
    [addLine]
  );

  /**
   * Add a warning/stderr line
   */
  const warn = useCallback(
    (data: string) => {
      addLine("stderr", data);
    },
    [addLine]
  );

  return {
    output,
    setOutput,
    addLine,
    addLines,
    clear,
    // Convenience methods
    info,
    error,
    complete,
    warn,
    // Expose the ref for edge cases
    lineIdRef,
  };
}

export default useOutput;
