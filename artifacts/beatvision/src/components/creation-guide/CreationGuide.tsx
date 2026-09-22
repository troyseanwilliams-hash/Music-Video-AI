import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/analytics";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlaySquare, Film, Music, BookOpen, Sparkles } from "lucide-react";
import { shouldAutoOpen, setGuideDismissed } from "./utils";
import { buildAuthUrl } from "@/lib/authIntent";

export function CreationGuide() {
  const [isOpen, setIsOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const previousAccount = useRef<string | null>(null);
  const shownThisSession = useRef(new Set<string>());

  useEffect(() => {
    const account = isAuthenticated ? user?.id ?? null : null;
    if (previousAccount.current !== account) {
      setIsOpen(false);
      previousAccount.current = account;
    }
    if (isAuthenticated && user?.id) {
      if (!shownThisSession.current.has(user.id) && shouldAutoOpen(location, isAuthenticated, user.id)) {
        shownThisSession.current.add(user.id);
        setIsOpen(true);
        setGuideDismissed(user.id);
        track("guide_opened", { auto: true });
      }
    }
  }, [location, isAuthenticated, user?.id]);

  const handleOpen = () => {
    setIsOpen(true);
    track("guide_opened", { auto: false });
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && user?.id) {
      setGuideDismissed(user.id);
    }
  };

  const handleSelect = (goal: string, path: string, requiresAuth: boolean = false) => {
    track("goal_selected", { goal });
    setIsOpen(false);
    if (user?.id) {
      setGuideDismissed(user.id);
    }
    
    if (requiresAuth && !isAuthenticated) {
      setLocation(buildAuthUrl("/register", { returnTo: path }));
      return;
    }
    
    if (goal === "montage" && location === "/editor") {
       const currentParams = new URLSearchParams(window.location.search);
       currentParams.set("guide", "montage");
       window.history.replaceState({}, "", `${window.location.pathname}?${currentParams.toString()}`);
       window.dispatchEvent(new CustomEvent("aibeatsync:resume-montage-guide"));
    } else {
      setLocation(path);
    }
  };

  return (
    <>
      <Button 
        onClick={handleOpen}
        aria-label="Help me create"
        className="fixed bottom-6 right-6 z-50 rounded-full shadow-glow gap-2 px-4 sm:px-5 h-14 bg-gradient-electric text-white border-0 hover:opacity-90 transition-opacity"
        size="lg"
        data-testid="button-help-create"
      >
        <Sparkles className="w-5 h-5" />
        <span className="font-semibold sm:hidden">Help</span>
        <span className="hidden sm:inline font-semibold">Help me create</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[600px] max-h-[90dvh] flex flex-col p-0 overflow-hidden" data-testid="dialog-creation-guide">
          <div className="p-6 pb-2">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold">What would you like to create?</DialogTitle>
              <DialogDescription className="text-base mt-2">
                Choose what you want to make. Start with a guided Montage walkthrough, or explore music, narration, and AI visuals. Using this guide is free.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="grid min-h-0 gap-3 p-6 pt-2 overflow-y-auto">
            <GoalCard 
              title="Montage Video"
              badge="Recommended"
              icon={<Film className="w-6 h-6" />}
              description="7-day unlimited trial. Bring your own media. Clean edits free. Optional lyric charges."
              onClick={() => handleSelect("montage", "/editor?guide=montage", true)}
              testId="goal-montage"
            />
            <GoalCard 
              title="AI Generated Video"
              icon={<PlaySquare className="w-6 h-6" />}
              description="Create stunning AI scenes and visuals using credits."
              onClick={() => handleSelect("generate", "/generate", true)}
              testId="goal-generate"
            />
            <GoalCard 
              title="Original Music"
              icon={<Music className="w-6 h-6" />}
              description="Generate custom soundtracks. 3 lifetime instrumentals + 1 vocal included."
              onClick={() => handleSelect("music", "/soundtracks", true)}
              testId="goal-music"
            />
            <GoalCard 
              title="Narrated Story"
              icon={<BookOpen className="w-6 h-6" />}
              description="Generate a narrated story with AI voiceover using credits."
              onClick={() => handleSelect("narration", "/generate?guide=narration", true)}
              testId="goal-narration"
            />
          </div>

          <div className="p-4 border-t bg-muted/30 flex justify-end">
            <Button variant="ghost" onClick={() => handleOpenChange(false)}>Skip for now</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface GoalCardProps {
  title: string;
  badge?: string;
  icon: ReactNode;
  description: string;
  onClick: () => void;
  testId: string;
}

function GoalCard({ title, badge, icon, description, onClick, testId }: GoalCardProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-4 p-4 rounded-xl border bg-card text-card-foreground shadow-sm hover:border-primary hover:ring-1 hover:ring-primary transition-all text-left group w-full"
      data-testid={testId}
    >
      <div className="p-3 bg-primary/10 rounded-lg text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0">
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-lg">{title}</h3>
          {badge && (
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary border border-primary/20">
              {badge}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}
