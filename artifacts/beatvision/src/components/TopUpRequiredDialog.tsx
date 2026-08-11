import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CreditCard } from "lucide-react";

interface TopUpRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditsRequired: number;
  creditsRemaining: number;
  title?: string;
  message?: string;
}

/**
 * Shared "not enough credits" modal, shown proactively before a submission
 * would fail on the backend. Visual pattern mirrors the INSUFFICIENT_CREDITS
 * branch of the errorDialog in generate.tsx (icon-in-circle header, bordered
 * cost breakdown box, Dismiss + View Plans footer) — kept here as one shared
 * component so every credit-costing flow looks and behaves the same way.
 */
export default function TopUpRequiredDialog({
  open,
  onOpenChange,
  creditsRequired,
  creditsRemaining,
  title = "More credits needed",
  message = "This will cost more credits than you currently have available.",
}: TopUpRequiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="h-10 w-10 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
              <CreditCard className="h-5 w-5 text-yellow-500" />
            </div>
            <DialogTitle className="text-left">{title}</DialogTitle>
          </div>
          <DialogDescription className="text-left text-sm leading-relaxed">
            {message}
          </DialogDescription>

          <div className="mt-3 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Credits needed</span>
              <span className="font-medium">{creditsRequired}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your balance</span>
              <span className="font-medium text-destructive">{creditsRemaining}</span>
            </div>
          </div>
        </DialogHeader>

        <DialogFooter className="flex-col sm:flex-row gap-2 mt-2">
          <Button
            variant="outline"
            className="sm:order-1"
            onClick={() => onOpenChange(false)}
          >
            Maybe later
          </Button>

          <Link href="/pricing">
            <Button
              className="w-full sm:w-auto bg-gradient-electric text-white shadow-glow border-0 sm:order-2"
              onClick={() => onOpenChange(false)}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              View Plans
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
