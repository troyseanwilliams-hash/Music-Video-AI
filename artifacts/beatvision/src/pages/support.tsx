import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquare, Plus, ChevronDown, ChevronUp, Clock, CheckCircle2, CircleDot, XCircle } from "lucide-react";

type TicketCategory = "billing" | "technical" | "content" | "other";
type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

interface Ticket {
  id: string;
  subject: string;
  message: string;
  category: TicketCategory;
  status: TicketStatus;
  jobId: string | null;
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: "billing", label: "Billing & Credits" },
  { value: "technical", label: "Technical Issue" },
  { value: "content", label: "Content / Generation" },
  { value: "other", label: "Other" },
];

function statusConfig(status: TicketStatus) {
  switch (status) {
    case "open":        return { label: "Open",        icon: CircleDot,     cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "in_progress": return { label: "In Progress", icon: Clock,         cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" };
    case "resolved":    return { label: "Resolved",    icon: CheckCircle2,  cls: "bg-green-500/15 text-green-400 border-green-500/30" };
    case "closed":      return { label: "Closed",      icon: XCircle,       cls: "bg-muted text-muted-foreground border-border" };
  }
}

function TicketRow({ ticket }: { ticket: Ticket }) {
  const [expanded, setExpanded] = useState(false);
  const { label, icon: Icon, cls } = statusConfig(ticket.status);

  return (
    <div className="border border-border/50 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-muted/10 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-medium text-sm truncate">{ticket.subject}</span>
            <Badge variant="outline" className={`text-xs shrink-0 ${cls}`}>
              <Icon className="h-3 w-3 mr-1" />
              {label}
            </Badge>
            <span className="text-xs text-muted-foreground capitalize shrink-0">{ticket.category}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Submitted {new Date(ticket.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="shrink-0 text-muted-foreground mt-0.5">
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Your message</p>
            <p className="text-sm whitespace-pre-wrap">{ticket.message}</p>
          </div>
          {ticket.jobId && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Related job</p>
              <Link href={`/jobs/${ticket.jobId}`} className="text-xs text-primary hover:underline font-mono">{ticket.jobId}</Link>
            </div>
          )}
          {ticket.adminNotes && (
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
              <p className="text-xs font-medium text-primary mb-1">Response from support</p>
              <p className="text-sm whitespace-pre-wrap">{ticket.adminNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SupportPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ subject: "", message: "", category: "other" as TicketCategory, jobId: "" });

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const { data, isLoading } = useQuery<{ tickets: Ticket[] }>({
    queryKey: ["support", "my"],
    queryFn: async () => {
      const res = await fetch("/api/support/my", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isAuthenticated,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subject: form.subject,
          message: form.message,
          category: form.category,
          jobId: form.jobId || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Failed to submit");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Ticket submitted", description: "We'll get back to you as soon as possible." });
      setForm({ subject: "", message: "", category: "other", jobId: "" });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: ["support", "my"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tickets = data?.tickets ?? [];

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="flex items-start justify-between mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Support</h1>
            <p className="text-sm text-muted-foreground">Get help with billing, technical issues, or anything else.</p>
          </div>
        </div>
        <Button
          className="shrink-0 bg-gradient-electric text-white shadow-glow"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus className="h-4 w-4 mr-2" />
          New ticket
        </Button>
      </div>

      {showForm && (
        <Card className="mb-8 bg-card/60 border-primary/20">
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Submit a support request</CardTitle>
            <CardDescription>Describe your issue and we'll respond as quickly as possible.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      form.category === c.value
                        ? "bg-primary/20 border-primary/50 text-primary font-medium"
                        : "bg-card border-border text-muted-foreground hover:border-primary/30"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Subject</label>
              <Input
                placeholder="Brief summary of your issue"
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                maxLength={200}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Message</label>
              <Textarea
                placeholder="Describe your issue in detail. Include any error messages, steps to reproduce, or other relevant information."
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                rows={5}
                maxLength={5000}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1 text-right">{form.message.length}/5000</p>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Job ID <span className="text-muted-foreground font-normal">(optional — paste from the job URL if relevant)</span>
              </label>
              <Input
                placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
                value={form.jobId}
                onChange={(e) => setForm((f) => ({ ...f, jobId: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                className="bg-gradient-electric text-white"
                disabled={!form.subject.trim() || !form.message.trim() || submit.isPending}
                onClick={() => submit.mutate()}
              >
                {submit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Submit ticket
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          {tickets.length > 0 ? `Your tickets (${tickets.length})` : "Your tickets"}
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-20 border border-dashed border-border rounded-2xl bg-card/30">
            <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <p className="text-muted-foreground text-sm">No support tickets yet.</p>
            <p className="text-muted-foreground text-xs mt-1">Open one if you need help.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {tickets.map((t) => <TicketRow key={t.id} ticket={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}
