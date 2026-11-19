import { Helmet } from "react-helmet-async";
import { Link } from "wouter";
import { ArrowRight, CalendarDays, Sparkles } from "lucide-react";
import { RELEASE_NOTES } from "@/lib/whatsNew";

export default function WhatsNew() {
  return (
    <div className="flex-1">
      <Helmet>
        <title>What's New | AIBeatSync</title>
        <meta name="description" content="Release notes for AIBeatSync, including commentary and reaction overlays in Creator Studio." />
        <meta property="og:title" content="What's New | AIBeatSync" />
        <meta property="og:description" content="Explore commentary overlays, reaction layouts, text cards, and 30-minute 1080p projects in Creator Studio." />
        <meta property="og:type" content="website" />
      </Helmet>
      <section className="border-b border-border/30 py-14 md:py-20">
        <div className="container mx-auto max-w-3xl px-4">
          <div className="mb-5 inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
            <Sparkles className="mr-2 h-4 w-4" /> Release notes
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl">What's <span className="text-gradient-electric">New</span></h1>
          <p className="mt-4 text-lg text-muted-foreground">What changed in AIBeatSync, and where to find it.</p>
        </div>
      </section>
      <div className="container mx-auto max-w-3xl px-4 py-12">
        {RELEASE_NOTES.map((note) => (
          <article key={note.id} id={note.id} className="relative border-l-2 border-primary/40 pl-6" data-testid={`release-${note.id}`}>
            <span className="absolute -left-[7px] top-1.5 h-3 w-3 rounded-full bg-primary" aria-hidden />
            <time dateTime={note.isoDate} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary" data-testid="text-release-date">
              <CalendarDays className="h-4 w-4" /> {note.date}
            </time>
            <h2 className="mt-2 text-2xl font-bold tracking-tight">{note.title}</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">{note.summary}</p>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              {note.items.map((item) => (
                <div key={item.heading} className="rounded-xl border border-border/60 bg-card p-4">
                  <dt className="font-semibold">{item.heading}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2">
              {note.links.map((l) => (
                <Link key={l.href} href={l.href} className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary hover:underline" data-testid={`link-release-${l.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {l.label} <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
