import { useState } from "react";
import { Check, X, RotateCcw, AlertTriangle, ShieldCheck, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";

interface Job {
  id: string;
  email: string;
  prompt: string;
  style: string;
  duration: string;
  audioType: string;
  submittedAt: string;
  errorMessage?: string;
  retryCount?: number;
}

const PENDING: Job[] = [
  {
    id: "a1b2c3d4",
    email: "sarah@example.com",
    prompt: "Epic cinematic sunset over city skyline with pulsing electronic beat",
    style: "cinematic",
    duration: "30s",
    audioType: "upload",
    submittedAt: "2m ago",
  },
  {
    id: "e5f6g7h8",
    email: "mike@example.com",
    prompt: "Neon anime dance sequence synchronized to hip hop rhythm",
    style: "anime",
    duration: "60s",
    audioType: "youtube",
    submittedAt: "8m ago",
  },
];

const FAILED: Job[] = [
  {
    id: "x9y0z1w2",
    email: "jordan@example.com",
    prompt: "Abstract particle flow matching bass drops",
    style: "abstract",
    duration: "full",
    audioType: "upload",
    submittedAt: "1h ago",
    errorMessage: "Runway 429: rate limit exceeded",
    retryCount: 3,
  },
];

function JobCard({
  job,
  onApprove,
  onReject,
}: {
  job: Job;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl overflow-hidden">
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-mono text-purple-400">{job.id}…</p>
            <p className="text-xs text-white/50 mt-0.5">{job.email}</p>
          </div>
          <span className="text-xs text-white/40 shrink-0">{job.submittedAt}</span>
        </div>

        {/* Prompt */}
        <button
          className="w-full text-left"
          onClick={() => setExpanded(!expanded)}
        >
          <p className={`text-sm text-white font-medium leading-snug ${!expanded ? "line-clamp-2" : ""}`}>
            {job.prompt}
          </p>
          {job.prompt.length > 80 && (
            <span className="text-xs text-purple-400 mt-1 flex items-center gap-0.5">
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Less" : "More"}
            </span>
          )}
        </button>

        {/* Tags */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full capitalize">{job.style}</span>
          <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full">{job.duration === "full" ? "Full track" : job.duration}</span>
          <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full capitalize">{job.audioType}</span>
        </div>
      </div>

      {/* Action buttons — full width, thumb-friendly */}
      <div className="flex border-t border-white/10">
        <button
          onClick={onReject}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold text-red-400 active:bg-red-500/10 transition-colors border-r border-white/10"
        >
          <X className="h-4 w-4" />
          Reject
        </button>
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-sm font-semibold text-green-400 active:bg-green-500/10 transition-colors"
        >
          <Check className="h-4 w-4" />
          Approve
        </button>
      </div>
    </div>
  );
}

function FailedCard({
  job,
  onRetry,
}: {
  job: Job;
  onRetry: () => void;
}) {
  return (
    <div className="bg-[#1a1a2e] border border-red-500/20 rounded-2xl overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-mono text-purple-400">{job.id}…</p>
            <p className="text-xs text-white/50 mt-0.5">{job.email}</p>
          </div>
          <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full shrink-0">
            {job.retryCount} retries
          </span>
        </div>

        <p className="text-sm text-white font-medium leading-snug line-clamp-2">{job.prompt}</p>

        {job.errorMessage && (
          <p className="text-xs font-mono text-red-400/80 bg-red-500/10 rounded-lg px-3 py-2 line-clamp-2">
            {job.errorMessage}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full capitalize">{job.style}</span>
          <span className="text-xs bg-white/10 text-white/70 px-2 py-0.5 rounded-full">{job.duration === "full" ? "Full track" : job.duration}</span>
        </div>
      </div>

      <div className="border-t border-white/10">
        <button
          onClick={onRetry}
          className="w-full flex items-center justify-center gap-2 py-4 text-sm font-semibold text-white/70 active:bg-white/5 transition-colors"
        >
          <RotateCcw className="h-4 w-4" />
          Retry Job
        </button>
      </div>
    </div>
  );
}

export function JobApprovals() {
  const [pending, setPending] = useState<Job[]>(PENDING);
  const [failed, setFailed] = useState<Job[]>(FAILED);
  const [toast, setToast] = useState<string | null>(null);
  const [showFailed, setShowFailed] = useState(true);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function approve(id: string) {
    setPending((p) => p.filter((j) => j.id !== id));
    showToast("Job approved ✓");
  }

  function reject(id: string) {
    setPending((p) => p.filter((j) => j.id !== id));
    showToast("Job rejected");
  }

  function retry(id: string) {
    setFailed((f) => f.filter((j) => j.id !== id));
    showToast("Job requeued ↺");
  }

  return (
    <div className="min-h-screen bg-[#0d0d1a] text-white font-sans">
      {/* Status bar */}
      <div className="flex justify-between items-center px-5 pt-4 pb-1">
        <span className="text-xs font-medium text-white/40">9:41</span>
        <div className="flex gap-1 items-center">
          <div className="w-4 h-2 border border-white/30 rounded-sm relative"><div className="absolute inset-[1px] right-1 bg-white/50 rounded-sm" /></div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-3 pb-4">
        <div>
          <h1 className="text-xl font-bold">Job Approvals</h1>
          <p className="text-xs text-white/50 mt-0.5">AIBeatSync Admin</p>
        </div>
        <button className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20">
          <RefreshCw className="h-4 w-4 text-white/70" />
        </button>
      </div>

      <div className="px-4 pb-10 space-y-6">
        {/* Pending section */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-purple-400" />
            <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
              Pending
            </h2>
            {pending.length > 0 && (
              <span className="ml-auto text-xs bg-purple-500/30 text-purple-300 px-2 py-0.5 rounded-full font-medium">
                {pending.length}
              </span>
            )}
          </div>

          {pending.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-white/10 rounded-2xl">
              <ShieldCheck className="h-8 w-8 text-green-500/40 mx-auto mb-2" />
              <p className="text-sm text-white/40">All clear — no pending jobs</p>
            </div>
          ) : (
            pending.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onApprove={() => approve(job.id)}
                onReject={() => reject(job.id)}
              />
            ))
          )}
        </section>

        {/* Failed section */}
        {failed.length > 0 && (
          <section className="space-y-3">
            <button
              className="flex items-center gap-2 w-full"
              onClick={() => setShowFailed(!showFailed)}
            >
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider">
                Failed
              </h2>
              <span className="ml-auto text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full font-medium">
                {failed.length}
              </span>
              {showFailed ? (
                <ChevronUp className="h-4 w-4 text-white/40" />
              ) : (
                <ChevronDown className="h-4 w-4 text-white/40" />
              )}
            </button>

            {showFailed && failed.map((job) => (
              <FailedCard
                key={job.id}
                job={job}
                onRetry={() => retry(job.id)}
              />
            ))}
          </section>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white/90 text-black text-sm font-medium px-5 py-2.5 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
