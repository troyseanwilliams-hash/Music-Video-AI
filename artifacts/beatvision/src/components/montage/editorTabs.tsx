import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Film, Layers, Music, Sparkles } from "lucide-react";

export const EDITOR_TABS = [
  { id: "media", label: "Media", hint: "Clips, photos, transitions", Icon: Film },
  { id: "overlay", label: "Overlay", hint: "Overlays and text", Icon: Layers },
  { id: "audio", label: "Audio", hint: "Music, clips, lyrics", Icon: Music },
  { id: "export", label: "Export", hint: "Name, format, render", Icon: Sparkles },
] as const;

export type EditorTab = (typeof EDITOR_TABS)[number]["id"];

export const REVEAL_EDITOR_TAB_EVENT = "aibeatsync:reveal-editor-tab";

export const tabId = (tab: EditorTab) => `montage-tab-${tab}`;
export const panelId = (tab: EditorTab) => `montage-panel-${tab}`;

export function isEditorTab(value: unknown): value is EditorTab {
  return EDITOR_TABS.some((t) => t.id === value);
}

/**
 * If `el` sits inside an inactive editor tab panel, ask the editor to activate
 * that tab. Returns true when a tab switch was requested.
 */
export function revealEditorTabFor(el: Element): boolean {
  const panel = el.closest<HTMLElement>("[data-editor-tab-panel]");
  if (!panel || !panel.hidden) return false;
  const tab = panel.dataset.editorTabPanel;
  if (!isEditorTab(tab)) return false;
  window.dispatchEvent(new CustomEvent(REVEAL_EDITOR_TAB_EVENT, { detail: { tab } }));
  return true;
}

/**
 * Activates the tab holding a walkthrough target before running `then`
 * (usually scrollIntoView). Waits two frames so React has painted the panel.
 * Returns a cancel function.
 */
export function revealThen(el: Element, then: () => void): () => void {
  if (!revealEditorTabFor(el)) {
    then();
    return () => {};
  }
  let second = 0;
  const first = window.requestAnimationFrame(() => {
    second = window.requestAnimationFrame(then);
  });
  return () => {
    window.cancelAnimationFrame(first);
    if (second) window.cancelAnimationFrame(second);
  };
}

export function useEditorTabReveal(onReveal: (tab: EditorTab) => void) {
  const cb = useRef(onReveal);
  cb.current = onReveal;
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: unknown }>).detail?.tab;
      if (isEditorTab(tab)) cb.current(tab);
    };
    window.addEventListener(REVEAL_EDITOR_TAB_EVENT, handler);
    return () => window.removeEventListener(REVEAL_EDITOR_TAB_EVENT, handler);
  }, []);
}

export function EditorTabList({
  active, onChange, badges = {},
}: {
  active: EditorTab;
  onChange: (tab: EditorTab) => void;
  badges?: Partial<Record<EditorTab, ReactNode>>;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = EDITOR_TABS.findIndex((t) => t.id === active);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % EDITOR_TABS.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + EDITOR_TABS.length) % EDITOR_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = EDITOR_TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const tab = EDITOR_TABS[next]!.id;
    onChange(tab);
    refs.current[tab]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Creator Studio sections"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-muted/40 p-1"
      data-testid="tablist-editor"
    >
      {EDITOR_TABS.map(({ id, label, hint, Icon }) => {
        const selected = id === active;
        return (
          <button
            key={id}
            ref={(node) => { refs.current[id] = node; }}
            type="button"
            role="tab"
            id={tabId(id)}
            aria-selected={selected}
            aria-controls={panelId(id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={`group relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-2 text-center transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:text-left ${
              selected
                ? "bg-card text-foreground shadow-sm ring-1 ring-primary/30"
                : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
            }`}
            data-testid={`tab-editor-${id}`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${selected ? "text-primary" : ""}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block text-xs font-semibold sm:text-sm">{label}</span>
              <span className="hidden truncate text-[11px] font-normal text-muted-foreground lg:block">{hint}</span>
            </span>
            {badges[id] != null && (
              <span className="absolute right-1 top-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold tabular-nums text-primary sm:static sm:ml-auto">
                {badges[id]}
              </span>
            )}
            {selected && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-electric" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/** Always mounted; inactive panels are hidden so in-progress edits and uploads survive tab switches. */
export function EditorTabPanel({ tab, active, children }: { tab: EditorTab; active: EditorTab; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      id={panelId(tab)}
      aria-labelledby={tabId(tab)}
      hidden={tab !== active}
      tabIndex={0}
      data-editor-tab-panel={tab}
      className="pt-4 outline-none"
      data-testid={`panel-editor-${tab}`}
    >
      {children}
    </div>
  );
}
