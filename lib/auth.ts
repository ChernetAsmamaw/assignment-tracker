export const COOKIE = "tracker_auth";

// Cookie value is a hash of the password, so the password itself never sits in the browser.
export async function authToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`assignment-tracker:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
