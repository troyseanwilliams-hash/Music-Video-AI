import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { track } from "@/lib/analytics";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlaySquare, Film, Music, BookOpen, Sparkles, Image as ImageIcon, Mic2 } from "lucide-react";
import { shouldAutoOpen, setGuideDismissed } from "./utils";
import { buildAuthUrl } from "@/lib/authIntent";
import { FREE_OFFER_COPY } from "@/lib/freeOffer";

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
    } else if (goal === "commentary" && location === "/editor") {
       window.dispatchEvent(new CustomEvent("aibeatsync:open-commentary-guide"));
    } else {
      setLocation(path);
    }
  };

  return (
    <>
      <Button 
        onClick={handleOpen}
        aria-label="Help me create"
        className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 sm:bottom-6 sm:right-6 z-50 rounded-full shadow-glow gap-1.5 sm:gap-2 px-3 sm:px-5 h-11 sm:h-14 min-w-[44px] bg-gradient-electric text-white border-0 hover:opacity-90 transition-opacity"
        size="lg"
        data-testid="button-help-create"
      >
        <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 shrink-0" />
        <span className="font-semibold text-sm sm:hidden">Help</span>
        <span className="hidden sm:inline font-semibold">Help me create</span>
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="top-auto bottom-0 translate-y-0 sm:top-[50%] sm:bottom-auto sm:-translate-y-1/2 rounded-b-none sm:rounded-xl sm:max-w-[600px] max-h-[90dvh] flex flex-col p-0 overflow-hidden w-full m-0 [&>button]:h-11 [&>button]:w-11 [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:bg-background/50 [&>button]:rounded-full [&>button]:backdrop-blur-sm sm:[&>button]:bg-transparent sm:[&>button]:backdrop-blur-none"
          data-testid="dialog-creation-guide"
        >
          <div className="p-4 sm:p-6 pb-2 sm:pb-2 shrink-0 [@media(max-height:500px)]:p-3 [@media(max-height:500px)]:pb-0">
            <DialogHeader>
              <DialogTitle className="text-xl sm:text-2xl font-bold pr-10 [@media(max-height:500px)]:text-lg">What would you like to create?</DialogTitle>
              <DialogDescription className="text-sm sm:text-base mt-1.5 sm:mt-2 [@media(max-height:500px)]:sr-only">
                 Choose what you want to make. The guide is free; {FREE_OFFER_COPY.short} {FREE_OFFER_COPY.example} {FREE_OFFER_COPY.expiry} Generation uses credits and existing plan rules.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="grid min-h-0 gap-3 p-4 pt-2 sm:p-6 sm:pt-2 overflow-y-auto">
            <GoalCard
              title="Montage Video"
              badge="Recommended"
              icon={<Film className="w-5 h-5 sm:w-6 sm:h-6" />}
              description={`${FREE_OFFER_COPY.headline} ${FREE_OFFER_COPY.expiry} Bring your own media; clean exports during your active trial within trial limits. Lyric burns and Auto-sync use credits. After trial: 10 clean exports/month, then 15 credits each.`}
              onClick={() => handleSelect("montage", "/editor?guide=montage", true)}
              testId="goal-montage"
            />
            <GoalCard
              title="Commentary or Podcast Video"
              badge="New"
              icon={<Mic2 className="w-5 h-5 sm:w-6 sm:h-6" />}
              description="Add a reaction or commentary clip and text cards over your main video in Montage Studio. An optional walkthrough points to each control; it never saves, exports, or spends credits for you."
              onClick={() => handleSelect("commentary", "/editor?guide=commentary", true)}
              testId="goal-commentary"
            />
            <GoalCard 
              title="Generate Video"
              icon={<PlaySquare className="w-5 h-5 sm:w-6 sm:h-6" />}
              description={`Create AI scenes and visuals using credits, subject to plan rules. ${FREE_OFFER_COPY.short} ${FREE_OFFER_COPY.example} ${FREE_OFFER_COPY.expiry}`}
              onClick={() => handleSelect("generate", "/generate?guide=starter", true)}
              testId="goal-generate"
            />
            <GoalCard
              title="Create Images"
              icon={<Film className="w-5 h-5 sm:w-6 sm:h-6" />}
              description="Create standalone image packs from a prompt or scene script. Credits and plan rules apply."
              onClick={() => handleSelect("images", "/images", true)}
              testId="goal-images"
            />
            <GoalCard 
              title="Original Music"
              icon={<Music className="w-5 h-5 sm:w-6 sm:h-6" />}
              description={FREE_OFFER_COPY.music}
              onClick={() => handleSelect("music", "/soundtracks", true)}
              testId="goal-music"
            />
            <GoalCard 
              title="Narrated Story"
              icon={<BookOpen className="w-5 h-5 sm:w-6 sm:h-6" />}
              description="Generate a narrated story with AI voiceover using credits and subject to plan rules."
              onClick={() => handleSelect("narration", "/generate?guide=narration", true)}
              testId="goal-narration"
            />
            <GoalCard 
              title="Animate a Photo"
              icon={<ImageIcon className="w-5 h-5 sm:w-6 sm:h-6" />}
              description="Bring a single image to life. Uses credits."
              onClick={() => handleSelect("animate_photo", "/gallery?tab=images&action=animate", true)}
              testId="goal-animate-photo"
            />
          </div>

          <div className="p-3 sm:p-4 border-t bg-muted/30 flex justify-end pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4 shrink-0 [@media(max-height:500px)]:py-1">
            <Button variant="ghost" onClick={() => handleOpenChange(false)} className="min-h-[44px]">Skip for now</Button>
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
      className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border bg-card text-card-foreground shadow-sm hover:border-primary hover:ring-1 hover:ring-primary transition-all text-left group w-full"
      data-testid={testId}
    >
      <div className="p-2 sm:p-3 bg-primary/10 rounded-lg text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors shrink-0 flex items-center justify-center min-w-[40px] min-h-[40px] sm:min-w-[48px] sm:min-h-[48px]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-0">
          <h3 className="font-semibold text-base sm:text-lg">{title}</h3>
          {badge && (
            <span className="px-1.5 py-0.5 rounded text-[10px] sm:text-xs font-medium bg-primary/10 text-primary border border-primary/20 whitespace-nowrap">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}
