export function getGuideDismissed(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(`bv-guide-dismissed-v1-${userId}`) === "true";
  } catch {
    return false;
  }
}

export function setGuideDismissed(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(`bv-guide-dismissed-v1-${userId}`, "true");
  } catch {}
}

const SENSITIVE_ROUTES = [
  "/login", 
  "/register", 
  "/forgot-password", 
  "/reset-password",
  "/pricing", 
  "/redeem", 
  "/editor",
  "/generate"
];

export function shouldAutoOpen(
  path: string, 
  isAuthenticated: boolean, 
  userId?: string
): boolean {
  if (!isAuthenticated || !userId) return false;
  
  if (SENSITIVE_ROUTES.some(r => path === r || path.startsWith(r + "/"))) {
    return false;
  }
  
  if (path.startsWith("/jobs/")) {
    return false;
  }
  
  return !getGuideDismissed(userId);
}
