// A return notification is only a UI hint. Credits always come from the API.
export const GENERATE_CREDIT_RETURN_KEY = "bv-generate-credit-return";

export function notifyGenerateCreditReturn(search: string): void {
  const params = new URLSearchParams(search);
  const token = params.get("creditReturn");
  const status = params.get("status");
  if (!token || (status !== "success" && status !== "cancelled")) return;
  try {
    localStorage.setItem(GENERATE_CREDIT_RETURN_KEY, JSON.stringify({ token, status }));
    localStorage.removeItem(GENERATE_CREDIT_RETURN_KEY);
  } catch {
    // Storage may be blocked; Generate also refreshes on focus and manually.
  }
}