import { useEffect, useRef } from "react";
import { importSunoTrack, type ImportedSunoTrack } from "@/lib/sunoImport";

/** One active import per source; stale responses (even from abort-ignoring clients) are ignored. */
export function useSunoImportRequest() {
  const sequence = useRef(0);
  const active = useRef<AbortController | null>(null);

  const cancel = () => {
    ++sequence.current;
    active.current?.abort();
    active.current = null;
  };

  useEffect(() => () => {
    ++sequence.current;
    active.current?.abort();
    active.current = null;
  }, []);

  const start = async (
    url: string,
    callbacks: {
      success: (track: ImportedSunoTrack) => void;
      error: (message: string) => void;
      settled: () => void;
    },
  ) => {
    if (active.current) return false;
    const controller = new AbortController();
    const requestSequence = ++sequence.current;
    active.current = controller;
    try {
      const track = await importSunoTrack(url, controller.signal);
      if (requestSequence === sequence.current && !controller.signal.aborted) callbacks.success(track);
    } catch (error) {
      if (requestSequence === sequence.current && !controller.signal.aborted) {
        callbacks.error(error instanceof Error ? error.message : "Could not import track. Please try again.");
      }
    } finally {
      if (active.current === controller) {
        active.current = null;
        callbacks.settled();
      }
    }
    return true;
  };

  return { start, cancel, isActive: () => active.current !== null };
}