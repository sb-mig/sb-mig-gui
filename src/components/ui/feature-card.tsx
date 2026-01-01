import * as React from "react";
import { cn } from "@/lib/utils";

export interface FeatureCardProps {
  /** Emoji or icon to display */
  icon: string;
  /** Background color for the icon (tailwind color name without bg-) */
  iconBg?: string;
  /** Card title */
  title: string;
  /** Card description */
  description: string;
  /** Whether the card is disabled/coming soon */
  disabled?: boolean;
  /** Content to render below the description (buttons, etc.) */
  children?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Feature card component for displaying action cards in the dashboard
 */
export function FeatureCard({
  icon,
  iconBg = "storyblok-green",
  title,
  description,
  disabled = false,
  children,
  className,
}: FeatureCardProps) {
  // Map common color names to Tailwind classes
  const bgColorMap: Record<string, string> = {
    "storyblok-green": "bg-storyblok-green/20",
    "blue-500": "bg-blue-500/20",
    "purple-500": "bg-purple-500/20",
    "yellow-500": "bg-yellow-500/20",
    "red-500": "bg-red-500/20",
    muted: "bg-muted",
  };

  const bgClass = bgColorMap[iconBg] || `bg-${iconBg}/20`;

  return (
    <div
      className={cn(
        "bg-card border border-border rounded-xl p-6 transition-colors",
        disabled
          ? "opacity-60 bg-card/50 border-border/50"
          : "hover:border-primary/50",
        className
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "w-12 h-12 rounded-lg flex items-center justify-center text-2xl flex-shrink-0",
            bgClass
          )}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground mb-4">{description}</p>
          {children}
        </div>
      </div>
    </div>
  );
}

export default FeatureCard;

