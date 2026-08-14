import { Link } from "wouter";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

const EFFECTIVE_DATE = "August 14, 2026";
const COMPANY_NAME = "AIBeatSync";
const CONTACT_EMAIL = "legal@aibeatsync.com";

export default function Privacy() {
  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-8">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Lock className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Effective date: {EFFECTIVE_DATE}</p>
        </div>
      </div>

      <div className="prose prose-invert max-w-none space-y-8 text-sm leading-relaxed text-foreground/90">

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">1. What This Covers</h2>
          <p>
            This Privacy Policy describes what information {COMPANY_NAME} collects when you use our Service, why we collect it, and who we share it with. It's written to reflect what the Service actually does — if anything here seems out of date with how the product works, please contact us.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">2. Information You Provide</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Account information:</strong> email address and password (stored as a salted hash, never in plain text), and an optional display name.</li>
            <li><strong>Content you submit:</strong> songs or audio you upload, Suno links you paste, lyrics, prompts, and any videos, canvases, or clips you generate or share to Explore. This is the content the Service processes to generate beat-synced videos, soundtracks, and lyric visuals.</li>
            <li><strong>Payment information:</strong> handled entirely by Stripe. We never receive or store your card number — only a Stripe customer/subscription reference so we can associate your account with your billing status.</li>
            <li><strong>Support requests:</strong> anything you submit through the Support page, including message content.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">3. Information Collected Automatically</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Session cookie:</strong> a single httpOnly cookie that identifies your logged-in session. It contains no tracking payload — just a reference to a session record on our server.</li>
            <li><strong>Signup IP address:</strong> recorded at account creation to prevent abuse of free-tier signup bonuses. Not used for tracking or shared with advertisers.</li>
            <li><strong>Usage analytics:</strong> basic usage data (page views, feature usage) used to understand how the product is used — not sold or shared with advertisers.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">4. Who We Share Data With</h2>
          <p>We use a small number of subprocessors, strictly to provide the Service:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>AI/media generation providers</strong> — your uploaded audio, lyrics, or prompts are sent to these providers solely to generate the video, soundtrack, or visual you requested. They do not use your content to train their own models under our agreements with them.</li>
            <li><strong>Stripe</strong> — for billing and subscription management. Stripe's own privacy policy governs how they handle your payment details.</li>
            <li><strong>Email/SMS providers</strong> — used for account-related emails (like password resets) and our own internal admin alerts.</li>
            <li><strong>Cloud infrastructure</strong> — our hosting and storage providers, who store your uploaded and generated files on our behalf.</li>
          </ul>
          <p>
            We do not sell your personal information, and we do not share it with advertisers.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">5. Public Content</h2>
          <p>
            If you choose to share a video or soundtrack to Explore, that content — along with the display name you choose to show — becomes publicly visible and playable by anyone. Everything starts private; nothing is shared publicly unless you take an explicit action to make it so. You can unpublish shared content at any time.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">6. Data Retention and Deletion</h2>
          <p>
            We retain your account and content for as long as your account is active. You can delete individual videos and clips yourself at any time. To delete your account entirely, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>{" "}
            or through the <Link href="/support" className="text-primary hover:underline">Support page</Link>, and we'll remove your account and associated content, except where we're required to retain records (e.g., billing history) for legal or accounting purposes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">7. Security</h2>
          <p>
            Passwords are hashed, never stored in plain text. Payment details never touch our servers. We use standard safeguards (encrypted connections, access controls) to protect your data, but no system is 100% secure — if you believe your account has been compromised, contact us immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">8. Children's Privacy</h2>
          <p>
            The Service is not directed at children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided us information, contact us and we will delete it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">9. Your Rights</h2>
          <p>
            Depending on where you live, you may have rights to access, correct, export, or delete your personal information. To exercise any of these, contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We'll update the effective date above when we do, and notify you by email for material changes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">11. Contact</h2>
          <p>
            Questions about this policy? Reach us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>.
          </p>
        </section>

      </div>
    </div>
  );
}
