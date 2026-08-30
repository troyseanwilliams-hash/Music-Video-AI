import { useGetCurrentAuthUser } from "@workspace/api-client-react";

export function useAuth() {
  const { data, isLoading, error } = useGetCurrentAuthUser();
  return {
    user: data?.user,
    isAuthenticated: !!data?.user,
    isLoading,
    error
  };
}
