import { cn } from "@/lib/utils";

export interface SpaceCardSpace {
  id: string;
  name: string;
  spaceId: string;
  workingDir?: string;
}

export interface SpaceCardProps {
  /** Space data */
  space: SpaceCardSpace;
  /** Whether this space is active */
  isActive: boolean;
  /** Click handler */
  onClick: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Space card for sidebar space selection
 */
export function SpaceCard({
  space,
  isActive,
  onClick,
  className,
}: SpaceCardProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg border cursor-pointer transition-all",
        isActive
          ? "bg-primary/10 border-primary/30 text-primary"
          : "bg-card border-border text-card-foreground hover:border-muted-foreground",
        className
      )}
      onClick={onClick}
    >
      <div className="font-medium text-sm">{space.name}</div>
      <div className="text-xs text-muted-foreground mt-0.5">
        ID: {space.spaceId}
      </div>
      {space.workingDir && (
        <div
          className="text-xs text-muted-foreground truncate mt-1"
          title={space.workingDir}
        >
          📁 {space.workingDir.split("/").slice(-2).join("/")}
        </div>
      )}
    </div>
  );
}

export default SpaceCard;

