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
 * single best match, 'spotlight' for two or three, and 'list' — a vertical
 * stack of compact rows, each carrying its own one-liner — once there are
 * enough that the answer has to be scannable rather than narrated. An
 * explicit view always wins, so a caller can force any layout regardless of
 * count (useful for testing/comparing them, and for the widget's own
 * fullscreen -> 'grid' transition).
 */
export function resolveView(requested: ViewOption | undefined, resultCount: number): ViewMode {
  if (requested && requested !== "auto") return requested;
  if (resultCount <= 1) return "card";
  if (resultCount <= 3) return "spotlight";
  return "list";
}
