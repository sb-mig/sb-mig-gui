import { cn } from "@/lib/utils";

export interface FormFieldProps {
  /** Field label */
  label: string;
  /** Form control (input, select, etc.) */
  children: React.ReactNode;
  /** Optional description below the field */
  description?: string;
  /** Optional error message */
  error?: string;
  /** Additional CSS classes for the container */
  className?: string;
}

/**
 * Form field wrapper with label and optional description/error
 */
export function FormField({
  label,
  children,
  description,
  error,
  className,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-1", className)}>
      <label className="block text-sm font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {description && !error && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default FormField;
