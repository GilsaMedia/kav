// What the backend needs from wherever it runs: the Node server on a computer, or the iOS app.

export interface Reply { code: number; headers: Record<string, string>; body: Uint8Array }

export interface Platform {
  // An HTTP request with the headers exactly as given. Header names in the reply are lower case.
  request(method: string, url: string, headers: Record<string, string>, body?: Uint8Array, timeoutMs?: number): Promise<Reply>;
  // The backend's saved state (Moovit sessions, learned stop ids), as one JSON text.
  load(): string | null;
  save(text: string): void;
}

let current: Platform | null = null;
export function setPlatform(p: Platform) { current = p; }
export function platform(): Platform {
  if (!current) throw new Error("No platform set");
  return current;
}
