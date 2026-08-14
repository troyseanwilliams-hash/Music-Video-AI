import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const DMCA_AGENT_EMAIL = "legal@aibeatsync.com";
const COMPANY_NAME = "AIBeatSync";

export default function Dmca() {
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
          <ShieldAlert className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DMCA Policy</h1>
          <p className="text-sm text-muted-foreground">Copyright Infringement Takedown Procedure</p>
        </div>
      </div>

      <div className="space-y-8 text-sm leading-relaxed text-foreground/90">

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Our Commitment</h2>
          <p>
            {COMPANY_NAME} respects the intellectual property rights of others and expects our users to do the same. In accordance with the Digital Millennium Copyright Act of 1998 ("DMCA"), we will respond expeditiously to valid claims of copyright infringement that comply with the DMCA.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Designated DMCA Agent</h2>
          <Card className="bg-card/50 border-card-border">
            <CardContent className="pt-5 space-y-1">
              <p className="font-medium">{COMPANY_NAME} — DMCA Agent</p>
              <p>
                Email:{" "}
                <a href={`mailto:${DMCA_AGENT_EMAIL}`} className="text-primary hover:underline font-medium">
                  {DMCA_AGENT_EMAIL}
                </a>
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                This is the only designated channel for DMCA notices. We cannot process notices sent through other channels.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Filing a Takedown Notice</h2>
          <p>
            If you believe that content available on {COMPANY_NAME} infringes your copyright, you may submit a written notice of infringement to our designated agent. To be valid under the DMCA (17 U.S.C. § 512(c)(3)), your notice must include <strong>all</strong> of the following:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong>Identification of the copyrighted work</strong> — a description of the copyrighted work you claim has been infringed, or a list of such works if multiple are covered by a single notice.
            </li>
            <li>
              <strong>Identification of the infringing material</strong> — a description of the material you claim is infringing and its location on our Service (e.g., URL), sufficient for us to locate the material.
            </li>
            <li>
              <strong>Your contact information</strong> — your name, address, telephone number, and email address.
            </li>
            <li>
              <strong>Good faith statement</strong> — a statement that you have a good faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.
            </li>
            <li>
              <strong>Accuracy statement</strong> — a statement that the information in your notice is accurate and, under penalty of perjury, that you are the copyright owner or authorized to act on the copyright owner's behalf.
            </li>
            <li>
              <strong>Signature</strong> — your physical or electronic signature.
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            Warning: Submitting a false or fraudulent DMCA takedown notice may expose you to legal liability under 17 U.S.C. § 512(f), including damages and attorneys' fees.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Counter-Notification</h2>
          <p>
            If you believe your content was removed as a result of a mistake or misidentification, you may file a counter-notification with our DMCA agent. A valid counter-notification under 17 U.S.C. § 512(g)(3) must include:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>Your physical or electronic signature.</li>
            <li>Identification of the material that was removed and its location before removal.</li>
            <li>A statement under penalty of perjury that you have a good faith belief the material was removed or disabled as a result of a mistake or misidentification.</li>
            <li>Your name, address, telephone number, and a statement that you consent to the jurisdiction of the federal court in your district, and that you will accept service of process from the person who provided the original notification.</li>
          </ol>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Repeat Infringer Policy</h2>
          <p>
            In accordance with the DMCA and other applicable law, {COMPANY_NAME} has adopted a policy of terminating the accounts of users who are repeat copyright infringers. We may also, at our sole discretion, limit access to the Service for users who infringe on the intellectual property rights of others, even if there is no formal DMCA notice filed.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">User Responsibility</h2>
          <p>
            All users of {COMPANY_NAME} agree — as a condition of service — that they will only upload audio content they own or have the legal right to use. Uploading copyrighted music without authorization is a violation of our Terms of Service and may result in immediate account termination. You accept full legal responsibility for the content you upload.
          </p>
        </section>

      </div>
    </div>
  );
}
