// src/view.ts
// View-selection logic shared between the MCP tool handler
// (src/mcp-server.ts) and the plain REST search endpoints (api/search.ts,
// and the local /api/search route in server.ts), so "how many results
// gets which layout" lives in exactly one place. No DOM here — safe to
// import from both server and browser code.
//
// Maps onto the presentation categories from OpenAI's Apps SDK guidance:
// "card" and "spotlight" are inline-card layouts (one focused result vs. a
// small stacked set), "carousel" is the inline carousel, and "grid" is the
// fullscreen layout — reached only via the widget's own display-mode
// request (src/mcp-app.ts), never returned directly by the tool, since
// fullscreen availability is a runtime host capability the server can't
// know about. Picture-in-picture isn't modeled here: it's for an embedded
// live video staying visible, and this app has no inline player.

export type ViewMode = "card" | "spotlight" | "list" | "grid";
export type ViewOption = "auto" | ViewMode;

export const VIEW_OPTIONS: readonly ViewOption[] = ["auto", "card", "spotlight", "list", "grid"];

/**
 * 'auto' picks the inline layout that fits the result count: 'card' for a
 * single best match, 'spotlight' for two or three — same large card,
 * shown side by side. Every server-side caller now caps at 3 results on
 * purpose (someone shown a long list doesn't pick, they bounce — see
 * mcp-server.ts), so 'list' below is a defensive fallback for a count
 * that shouldn't occur in practice, not a real fourth tier of the normal
 * flow. An explicit view always wins, so a caller can still force any
 * layout regardless of count (testing/comparing them, and the widget's
 * own fullscreen -> 'grid' transition).
 */
export function resolveView(requested: ViewOption | undefined, resultCount: number): ViewMode {
  if (requested && requested !== "auto") return requested;
  if (resultCount <= 1) return "card";
  if (resultCount <= 3) return "spotlight";
  return "list";
}
