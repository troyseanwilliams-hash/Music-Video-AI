import { Link } from "wouter";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { STORAGE_RETENTION_MESSAGE } from "@/components/StorageRetentionNotice";

const EFFECTIVE_DATE = "October 26, 2026";
const COMPANY_NAME = "AIBeatSync";
const SITE_URL = "https://aibeatsync.com";
const CONTACT_EMAIL = "legal@aibeatsync.com";

export default function Terms() {
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
          <FileText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
          <p className="text-sm text-muted-foreground">Effective date: {EFFECTIVE_DATE}</p>
        </div>
      </div>

      <div className="prose prose-invert max-w-none space-y-8 text-sm leading-relaxed text-foreground/90">

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">1. Acceptance of Terms</h2>
          <p>
            By accessing or using {COMPANY_NAME} ("{SITE_URL}"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service. These Terms apply to all users, including visitors, registered users, and paying subscribers.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">2. Description of Service</h2>
          <p>
            {COMPANY_NAME} is an AI-powered music video generation platform. You upload or link audio content, and our AI creates beat-synced video clips ("Generated Content"). Generated Content is created algorithmically and may not always match your expectations. We do not guarantee any specific output quality, style, or result.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">3. User Content and Copyright</h2>
          <p className="font-medium text-foreground">
            You are solely responsible for all audio files and other content you upload to the Service ("User Content").
          </p>
          <p>
            By uploading User Content, you represent and warrant that:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>You own the User Content, or have obtained all necessary licenses, permissions, and rights from the copyright owner to upload and use it on this Service.</li>
            <li>Your User Content does not infringe any third-party intellectual property rights, including but not limited to copyright, trademark, or trade secret rights.</li>
            <li>You have the right to grant {COMPANY_NAME} the limited license described in Section 4 below.</li>
            <li>Your User Content does not violate any applicable law or regulation.</li>
          </ul>
          <p>
            Uploading music or audio you do not own or have a license to use — including commercially released tracks — is strictly prohibited and may result in account termination and legal liability. {COMPANY_NAME} is not responsible for any copyright infringement committed by users.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">4. License Grant</h2>
          <p>
            By uploading User Content, you grant {COMPANY_NAME} a limited, non-exclusive, royalty-free, worldwide license to use, process, and store your User Content solely for the purpose of providing the Service to you. This license terminates when you delete your content or close your account. We do not sell or share your uploaded audio with third parties.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">5. Prohibited Conduct</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Upload content that infringes any third party's intellectual property rights.</li>
            <li>Upload content that is illegal, obscene, defamatory, threatening, or harmful.</li>
            <li>Use the Service to generate content that infringes on any rights or violates any law.</li>
            <li>Attempt to reverse engineer, hack, or disrupt the Service.</li>
            <li>Resell, sublicense, or distribute access to the Service without our written consent.</li>
            <li>Use automated tools or bots to access the Service beyond what is enabled through our official API.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">6. DMCA and Copyright Takedown Policy</h2>
          <p>
            {COMPANY_NAME} respects intellectual property rights and complies with the Digital Millennium Copyright Act ("DMCA"). If you believe content on the Service infringes your copyright, please submit a takedown notice as described on our <Link href="/dmca" className="text-primary hover:underline">DMCA Policy page</Link>.
          </p>
          <p>
            We have a repeat infringer policy. Users who repeatedly infringe the intellectual property rights of others will have their accounts terminated.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">7. Credits and Payments</h2>
          <p>
            Access to video generation requires credits. Credits are purchased through subscription plans or one-time top-up packs. All payments are final and non-refundable except as required by applicable law. Subscription plan credits reset each billing cycle and do not carry over. Top-up credits never expire. Prices are subject to change with notice.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">8. Ownership of Generated Content</h2>
          <div id="file-storage" className="space-y-3 scroll-mt-24">
            <h3 className="font-semibold text-foreground">File storage after membership expiration</h3>
            <p>{STORAGE_RETENTION_MESSAGE}</p>
            <p>Do not rely on the Service as your only backup. Videos, images, and audio are permanently deleted after the 30-day period following the end of a paid membership or free trial.</p>
          </div>
          <p>
            Subject to your compliance with these Terms and payment of applicable fees, you own the Generated Content produced from your User Content. {COMPANY_NAME} claims no ownership over your Generated Content. However, you acknowledge that similar outputs may be generated for other users and that {COMPANY_NAME} retains rights to the underlying AI models and technology.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">9. Disclaimer of Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND. TO THE FULLEST EXTENT PERMITTED BY LAW, {COMPANY_NAME.toUpperCase()} DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">10. Limitation of Liability</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY LAW, {COMPANY_NAME.toUpperCase()} SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE. OUR TOTAL LIABILITY TO YOU SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">11. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless {COMPANY_NAME} and its operators, officers, and affiliates from any claims, liabilities, damages, losses, or expenses (including reasonable attorneys' fees) arising from: (a) your use of the Service; (b) your User Content; (c) your violation of these Terms; or (d) your infringement of any third-party rights.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">12. Account Termination</h2>
          <p>
            We reserve the right to suspend or terminate your account at any time for violation of these Terms, suspected copyright infringement, fraudulent activity, or any other reason at our sole discretion. Unused credits are non-refundable upon termination for cause.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">13. Changes to Terms</h2>
          <p>
            We may update these Terms from time to time. We will notify you of material changes by updating the effective date above and, where appropriate, by sending an email notice. Continued use of the Service after changes constitutes your acceptance of the updated Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">14. Governing Law</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of the United States, without regard to conflict of law principles. Any disputes shall be resolved through binding arbitration or in a court of competent jurisdiction.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">15. Contact</h2>
          <p>
            For questions about these Terms, contact us at:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary hover:underline">{CONTACT_EMAIL}</a>
          </p>
        </section>

      </div>
    </div>
  );
}
