// src/view.ts
// View-selection logic shared between the MCP tool handler
// (src/mcp-server.ts) and the plain REST search endpoints (api/search.ts,
// and the local /api/search route in server.ts), so "how many results
// gets which layout" lives in exactly one place. No DOM here — safe to
// import from both server and browser code.

export type ViewMode = "carousel" | "spotlight";
export type ViewOption = "auto" | ViewMode;

export const VIEW_OPTIONS: readonly ViewOption[] = ["auto", "carousel", "spotlight"];

/**
 * 'auto' picks 'spotlight' for a small number of best matches — each
 * video gets more room (larger thumbnail, description snippet) — and
 * 'carousel' for a broader set to skim at a glance. An explicit
 * 'carousel' or 'spotlight' always wins, so a caller can force either
 * view regardless of result count (useful for testing/comparing them).
 */
export function resolveView(requested: ViewOption | undefined, resultCount: number): ViewMode {
  if (requested && requested !== "auto") return requested;
  return resultCount <= 3 ? "spotlight" : "carousel";
}
