import { cn } from "@/lib/utils";

export interface ToggleOption<T extends string = string> {
  value: T;
  label: string;
  icon?: string;
}

export interface ToggleGroupProps<T extends string = string> {
  /** Array of toggle options */
  options: ToggleOption<T>[];
  /** Currently selected value */
  value: T;
  /** Callback when value changes */
  onChange: (value: T) => void;
  /** Size variant */
  size?: "sm" | "md";
  /** Additional CSS classes */
  className?: string;
}

/**
 * Toggle group component for switching between options
 */
export function ToggleGroup<T extends string = string>({
  options,
  value,
  onChange,
  size = "sm",
  className,
}: ToggleGroupProps<T>) {
  const sizeClasses = {
    sm: "px-3 py-1 text-xs",
    md: "px-4 py-2 text-sm",
  };

  return (
    <div
      className={cn(
        "flex items-center gap-1 p-1 rounded-lg bg-app-900 border border-border",
        className
      )}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded font-medium transition-all",
              sizeClasses[size],
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.icon && <span className="mr-1">{option.icon}</span>}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default ToggleGroup;

