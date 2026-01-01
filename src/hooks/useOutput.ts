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

/**
 * Hook for managing terminal/log output state
 * Replaces repetitive setOutput patterns throughout the app
 */
export function useOutput() {
  const [output, setOutput] = useState<OutputLine[]>([]);
  const lineIdRef = useRef(0);

  /**
   * Add a single line to the output
   */
  const addLine = useCallback((type: OutputLineType, data: string) => {
    setOutput((prev) => [
      ...prev,
      {
        id: lineIdRef.current++,
        type,
        data,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  /**
   * Add multiple lines at once
   */
  const addLines = useCallback(
    (lines: { type: OutputLineType; data: string }[]) => {
      setOutput((prev) => [
        ...prev,
        ...lines.map((line) => ({
          id: lineIdRef.current++,
          type: line.type,
          data: line.data,
          timestamp: Date.now(),
        })),
      ]);
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
