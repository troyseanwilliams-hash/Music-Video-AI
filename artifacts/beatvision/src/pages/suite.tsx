import { useEffect } from "react";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { useSEO } from "@/hooks/useSEO";

const SUITE_HOME = "https://aisyncsuite.com/";

function getSuiteDestination(): string {
  const destination = new URL(SUITE_HOME);
  destination.search = window.location.search;
  destination.hash = window.location.hash;
  return destination.toString();
}

export default function Suite() {
  const destination = getSuiteDestination();

  useSEO({
    title: "AISync Suite has moved",
    description:
      "AISync Suite now has its own home for shared AIBeatSync and AIPodSync subscriptions.",
    canonical: "/suite",
    noindex: true,
  });

  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);

  return (
    <main className="min-h-[70vh] px-4 py-24 flex items-center justify-center">
      <div className="max-w-lg text-center">
        <Loader2
          className="mx-auto mb-6 h-8 w-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <h1 className="text-3xl font-bold tracking-tight">
          AISync Suite has a new home
        </h1>
        <p className="mt-4 text-muted-foreground">
          Taking you to the standalone Suite subscription and account portal.
        </p>
        <a
          href={destination}
          className="mt-7 inline-flex items-center gap-2 font-semibold text-primary hover:underline"
        >
          Continue to AISync Suite
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>
    </main>
  );
}