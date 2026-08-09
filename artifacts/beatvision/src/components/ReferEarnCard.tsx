import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gift, Copy, Check, Users, Coins, Share2 } from "lucide-react";

interface ReferralInfo {
  code: string;
  referredCount: number;
  creditsEarned: number;
  rewardPerReferral: number;
  referredBonus: number;
  maxCreditedReferrals: number;
}

async function fetchReferralInfo(): Promise<ReferralInfo> {
  const res = await fetch("/api/referrals/me", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load referral info");
  return res.json();
}

/** "Refer & Earn" panel: share link + lifetime referral stats. */
export default function ReferEarnCard() {
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({
    queryKey: ["referrals", "me"],
    queryFn: fetchReferralInfo,
    staleTime: 5 * 60 * 1000,
  });

  if (!data) return null;

  const shareLink = `${window.location.origin}/register?ref=${data.code}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — user can select the text manually
    }
  }

  async function handleShare() {
    const text = `I'm making AI music videos on AIBeatSync — join with my link and we both get free credits: ${shareLink}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "AIBeatSync", text, url: shareLink });
        return;
      }
    } catch {
      return; // user cancelled the share sheet
    }
    handleCopy(); // desktop fallback
  }

  return (
    <Card className="bg-card/50 border-card-border" data-testid="card-refer-earn">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Gift className="h-4 w-4 text-primary" />
          Refer &amp; Earn
        </CardTitle>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5" title="Friends who joined">
            <Users className="h-3.5 w-3.5" />
            {data.referredCount}
          </span>
          <span className="flex items-center gap-1.5 text-accent font-medium" title="Credits earned">
            <Coins className="h-3.5 w-3.5" />
            {data.creditsEarned}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Earn <span className="font-semibold text-foreground">{data.rewardPerReferral} credits</span> for
          every friend who signs up — they get {data.referredBonus} bonus credits too.
        </p>
        <div className="flex items-center gap-2">
          <code
            className="flex-1 truncate rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
            data-testid="text-referral-link"
          >
            {shareLink}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            className="shrink-0"
            data-testid="button-copy-referral"
          >
            {copied ? (
              <><Check className="mr-1.5 h-3.5 w-3.5 text-green-500" /> Copied</>
            ) : (
              <><Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link</>
            )}
          </Button>
          <Button
            size="sm"
            onClick={handleShare}
            className="shrink-0 bg-gradient-electric text-white border-0"
            data-testid="button-share-referral"
          >
            <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
