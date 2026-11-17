// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AUTH_QUERY_KEY, useAuth } from "./useAuth";

afterEach(() => vi.unstubAllGlobals());
it("does not refresh authenticated state until the second factor succeeds", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ requiresTwoFactor: true })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: { id: "fixture" } })));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(AUTH_QUERY_KEY, null);
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
  let auth: ReturnType<typeof useAuth>;
  function Harness() { auth = useAuth(); return null; }
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await act(async () => expect(await auth.login("fixture@example.invalid", "fixture-password")).toEqual({ requiresTwoFactor: true }));
  expect(invalidate).not.toHaveBeenCalled();
  await act(async () => expect(await auth.login("fixture@example.invalid", "fixture-password", "123456")).toEqual({ requiresTwoFactor: false }));
  expect(invalidate).toHaveBeenCalledOnce();
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ email: "fixture@example.invalid", password: "fixture-password", code: "123456" });
  await act(async () => root.unmount());
  client.clear();
});
