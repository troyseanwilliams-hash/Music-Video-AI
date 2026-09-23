import { Film, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PhotoNextActions({
  onAnimate,
  onTellStory,
  className,
}: {
  onAnimate: () => void;
  onTellStory: () => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-2", className)}>
      <Button
        type="button"
        size="sm"
        className="min-h-11 w-full whitespace-normal bg-gradient-electric text-xs text-white shadow-glow"
        onClick={onAnimate}
        data-testid="animate-photo-action"
      >
        <Video className="mr-2 h-4 w-4 shrink-0" />
        Animate this photo
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="min-h-11 w-full whitespace-normal text-xs"
        onClick={onTellStory}
        data-testid="story-photo-action"
      >
        <Film className="mr-2 h-4 w-4 shrink-0" />
        Tell a story with this photo
      </Button>
    </div>
  );
}