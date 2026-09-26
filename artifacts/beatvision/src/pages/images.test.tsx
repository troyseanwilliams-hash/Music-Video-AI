// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateImages from "./images";

const navigate = vi.fn();
const plan = vi.fn();
const create = vi.fn();
const video = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/images", navigate],
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { isAdmin: false } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [], isLoading: false }) }));
vi.mock("@workspace/api-client-react", () => ({
  VideoStyle: { realistic: "realistic", anime: "anime", cinematic: "cinematic", abstract: "abstract", neon: "neon", vintage: "vintage", fantasy: "fantasy", documentary: "documentary" },
  getGetDashboardStatsQueryKey: () => ["stats"],
  useGetDashboardStats: () => ({ data: { creditsRemaining: 10000 } }),
  usePlanImagePack: () => ({ mutate: plan, isPending: false }),
  useCreateImagePack: () => ({ mutate: create, isPending: false }),
  useCreateJob: () => ({ mutate: video }),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("Create Images submission", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState({}, "", "/images?prompt=A%20red%20fox&imageCount=2&style=anime");
    plan.mockReset();
    create.mockReset();
    video.mockReset();
    navigate.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<CreateImages />));
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it("reviews then submits approved image scenes only through the image pack API", () => {
    expect(create).not.toHaveBeenCalled(); // deep links must never auto-submit
    const review = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Review Image Pack"))!;
    act(() => review.click());
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ prompt: "A red fox", style: "anime", imageCount: 2 }),
    }), expect.any(Object));
    act(() => plan.mock.calls[0][1].onSuccess({ scenes: [{ index: 0, prompt: "Fox portrait" }, { index: 1, prompt: "Fox in forest" }] }));
    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm & Generate Images"))!;
    act(() => confirm.click());
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ imageCount: 2, approvedScenes: [{ index: 0, prompt: "Fox portrait" }, { index: 1, prompt: "Fox in forest" }] }),
    }), expect.any(Object));
    expect(video).not.toHaveBeenCalled();
  });

  it("does not submit before a valid scene plan is approved", () => {
    const review = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Review Image Pack"))!;
    act(() => review.click());
    expect(create).not.toHaveBeenCalled();
    act(() => plan.mock.calls[0][1].onSuccess({ scenes: [{ index: 0, prompt: "Only one scene" }] }));
    const confirm = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Confirm & Generate Images"))! as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(video).not.toHaveBeenCalled();
  });
});