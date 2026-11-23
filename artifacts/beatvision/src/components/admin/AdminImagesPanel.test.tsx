// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminImagesPanel from "./AdminImagesPanel";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("@tanstack/react-query", () => ({ useQuery: useQueryMock }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

describe("admin generated image review", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({
      data: {
        assets: [{
          id: "image-1",
          userId: "user-1",
          email: "creator@example.com",
          jobId: "job-1",
          assetIndex: 0,
          objectPath: "/objects/image-packs/job-1/0.jpg",
          prompt: "A red fox in a snowy forest",
          isPublic: false,
          style: "cinematic",
          createdAt: "2026-11-23T12:00:00.000Z",
        }],
        total: 1,
        page: 1,
        limit: 24,
      },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<AdminImagesPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("refreshes on entry and polls while the image review tab is open", () => {
    expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
    }));
  });

  it("renders generated images on mobile-sized layouts and explains failed previews", () => {
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/api/storage/objects/image-packs/job-1/0.jpg");
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.parentElement?.className).toContain("min-h-48");

    act(() => image?.dispatchEvent(new Event("error")));
    expect(container.textContent).toContain("Preview unavailable");

    const previewButton = container.querySelector<HTMLButtonElement>("button[aria-label='Inspect image from creator@example.com']");
    act(() => previewButton?.click());
    expect(container.textContent).toContain("Generation prompt");
    expect(container.textContent).toContain("A red fox in a snowy forest");
  });
});
