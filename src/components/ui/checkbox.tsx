import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  /** Whether the checkbox is checked */
  checked?: boolean;
  /** Whether the checkbox is in a partial/indeterminate state */
  partial?: boolean;
  /** Callback when checkbox is clicked */
  onChange?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Disable the checkbox */
  disabled?: boolean;
  /** Size variant */
  size?: "sm" | "md";
}

/**
 * Checkbox component with support for checked, partial (indeterminate), and unchecked states
 */
export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      checked = false,
      partial = false,
      onChange,
      className,
      disabled = false,
      size = "md",
    },
    ref
  ) => {
    const sizeClasses = {
      sm: "w-3.5 h-3.5",
      md: "w-4 h-4",
    };

    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={partial ? "mixed" : checked}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          "rounded border transition-colors flex-shrink-0 flex items-center justify-center",
          sizeClasses[size],
          checked
            ? "bg-primary border-primary text-primary-foreground"
            : partial
              ? "bg-primary/50 border-primary text-primary-foreground"
              : "border-muted-foreground hover:border-foreground",
          disabled && "opacity-50 cursor-not-allowed",
          !disabled && "cursor-pointer",
          className
        )}
      >
        {checked && (
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
        {partial && !checked && (
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
          </svg>
        )}
      </button>
    );
  }
);

Checkbox.displayName = "Checkbox";

export default Checkbox;

