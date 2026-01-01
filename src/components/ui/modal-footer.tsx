import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface ModalFooterProps {
  /** Content to display on the left side */
  leftContent?: React.ReactNode;
  /** Cancel button callback */
  onCancel?: () => void;
  /** Submit button callback */
  onSubmit?: () => void;
  /** Submit button label */
  submitLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Whether submit button is disabled */
  submitDisabled?: boolean;
  /** Whether cancel button is disabled */
  cancelDisabled?: boolean;
  /** Custom submit button content (overrides submitLabel) */
  submitContent?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Standard modal footer with cancel and submit buttons
 */
export function ModalFooter({
  leftContent,
  onCancel,
  onSubmit,
  submitLabel = "Submit",
  cancelLabel = "Cancel",
  submitDisabled,
  cancelDisabled,
  submitContent,
  className,
}: ModalFooterProps) {
  return (
    <div
      className={cn("flex gap-3 pt-4 border-t border-border mt-4", className)}
    >
      {leftContent && <div className="flex-1">{leftContent}</div>}
      {!leftContent && <div className="flex-1" />}
      {onCancel && (
        <Button variant="ghost" onClick={onCancel} disabled={cancelDisabled}>
          {cancelLabel}
        </Button>
      )}
      {onSubmit && (
        <Button onClick={onSubmit} disabled={submitDisabled}>
          {submitContent ?? submitLabel}
        </Button>
      )}
    </div>
  );
}

export default ModalFooter;
