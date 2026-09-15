import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ANALYTICS_ANON_ID_HEADER } from "../lib/analytics";

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  subscriptionStatus: "trial" | "active" | "cancelled" | "none";
  trialEndsAt: string | null;
  isAdmin: boolean;
}

export const AUTH_QUERY_KEY = ["auth", "user"] as const;

export const AUTH_TRANSPORT_ERROR = "AuthTransportError";

export class AuthTransportError extends Error {
  constructor() {
    super("We couldn't reach the authentication service. Please try again.");
    this.name = AUTH_TRANSPORT_ERROR;
  }
}

export function isAuthTransportError(error: unknown): error is AuthTransportError {
  return error instanceof AuthTransportError;
}

export function buildSignupAttributionHeaders(
  value: unknown,
): Record<string, string> {
  if (typeof value !== "string") return {};
  const anonId = value.trim();
  return /^[a-zA-Z0-9-]{1,64}$/.test(anonId)
    ? { [ANALYTICS_ANON_ID_HEADER]: anonId }
    : {};
}

function getSignupAnalyticsAnonId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem("bv-anon")?.trim() ?? "";
    return /^[a-zA-Z0-9-]{1,64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function fetchCurrentUser(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/user", { credentials: "include" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.user ?? null;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
    [queryClient],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, referralCode?: string): Promise<void> => {
      const anonId = getSignupAnalyticsAnonId();
      let res: Response;
      try {
        res = await fetch("/api/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...buildSignupAttributionHeaders(anonId),
          },
          credentials: "include",
          body: JSON.stringify({ name, email, password, ...(referralCode ? { referralCode } : {}) }),
        });
      } catch {
        // HTTP errors are surfaced below for the server's authoritative
        // signup failure event. Only a request that never received a response
        // is a client-side transport failure.
        throw new AuthTransportError();
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
    [queryClient],
  );

  const logout = useCallback(() => {
    queryClient.setQueryData(AUTH_QUERY_KEY, null);
    queryClient.clear();
    window.location.href = "/api/logout";
  }, [queryClient]);

  const deleteAccount = useCallback(
    async (password: string): Promise<void> => {
      const res = await fetch("/api/auth/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Couldn't delete your account");
      }
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      queryClient.clear();
    },
    [queryClient],
  );

  return {
    user: user ?? null,
    isAuthenticated: user != null,
    isLoading,
    login,
    register,
    logout,
    deleteAccount,
  };
}
