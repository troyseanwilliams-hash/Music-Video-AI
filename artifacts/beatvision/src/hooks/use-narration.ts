import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type NarrationVoice = {
  id: string;
  label: string;
  isDefault: boolean;
  previewPath: string;
};

export type NarrationEstimate = {
  scriptCharacters: number;
  estimatedCost: number;
  musicCost: number;
};

export type NarrationResultHandoff = {
  audioSourceType: "upload";
  audioObjectPath: string;
  audioAnalysis: any;
};

export type NarrationJob = {
  id: string;
  status: string;
  progressPercent: number;
  error?: string | null;
  estimatedCost: number;
  chargedCost: number;
  refunded: boolean;
  createdAt: string;
  updatedAt: string;
  result?: {
    audioObjectPath: string;
    audioAnalysis: any;
    downloadPath: string;
    handoff: NarrationResultHandoff;
  };
};

export function getNarrationRefetchInterval(status: string | undefined): number | false {
  return status && ["queued", "generating", "analyzing", "stitching"].includes(status) ? 2000 : false;
}

export function isNarrationGenerating(status: string | undefined): boolean {
  return !!status && ["queued", "generating", "analyzing", "stitching"].includes(status);
}

export function useNarrationVoices() {
  return useQuery({
    queryKey: ["narration-voices"],
    queryFn: async () => {
      const res = await fetch("/api/narrations/voices", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load voices");
      return res.json() as Promise<{ voices: NarrationVoice[]; defaultVoiceId: string }>;
    },
  });
}

export function useNarrationJob(id: string | null) {
  return useQuery({
    queryKey: ["narration-job", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/narrations/${id}`, { credentials: "include" });
      if (!res.ok) {
        let msg = "Failed to load narration job";
        try {
          const errData = await res.json();
          if (errData.error) msg = errData.error;
        } catch {}
        throw new Error(msg);
      }
      return res.json() as Promise<{ narration: NarrationJob }>;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.narration?.status;
      return getNarrationRefetchInterval(status);
    },
  });
}

export type EstimateNarrationParams = {
  script: string;
  voiceId?: string;
  musicSource?: "none" | "generated" | "soundtrack" | "upload" | "suno";
  musicPrompt?: string;
  soundtrackId?: string;
  musicObjectPath?: string;
  musicTitle?: string;
};

export function useEstimateNarration() {
  return useMutation({
    mutationFn: async (params: EstimateNarrationParams) => {
      const res = await fetch("/api/narrations/estimate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Estimation failed");
      }
      return res.json() as Promise<NarrationEstimate>;
    },
  });
}

export function useCreateNarration() {
  return useMutation({
    mutationFn: async (params: EstimateNarrationParams & { idempotencyKey: string }) => {
      const { idempotencyKey, ...body } = params;
      const res = await fetch("/api/narrations", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // Attach full error info for insufficient credits dialog
        const error = new Error(err.error || "Failed to create narration");
        Object.assign(error, err);
        throw error;
      }
      return res.json() as Promise<{ narration: NarrationJob; idempotentReplay: boolean }>;
    },
  });
}

export function useSaveNarrationToSoundtracks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/narrations/${id}/save-to-soundtracks`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save narration to My Music");
      }
      return res.json() as Promise<{
        soundtrack: { id: string; title: string; objectPath: string };
      }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["soundtracks"] });
    },
  });
}
