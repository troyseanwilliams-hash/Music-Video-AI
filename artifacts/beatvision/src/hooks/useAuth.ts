import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password, ...(referralCode ? { referralCode } : {}) }),
      });
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
