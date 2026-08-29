// src/mcp-app.ts
// UI logic for the video results widget. Runs inside the sandboxed iframe
// the MCP host renders, and talks back to the server via the App bridge.
//
// No search box here: the chat is the search box. The person already
// asked; a second field in the widget would just make them retype it.
// Refining a search happens by talking to the agent again.
import { App } from "@modelcontextprotocol/ext-apps";
import { renderVideos, type VideoResult, type ViewMode } from "./carousel";
import { renderLeadForm, type LeadFormPayload } from "./lead-form";
import { resolveView } from "./view";

interface VideoPayload {
  kind?: "videos"; // optional for back-compat with older tool responses that predate this field
  query: string;
  view: ViewMode;
  videos: VideoResult[];
}

type ToolPayload = VideoPayload | LeadFormPayload;

const root = document.getElementById("root")!;
const statusEl = document.getElementById("status")!;
const fullscreenBar = document.getElementById("fullscreen-bar")!;
const fullscreenToggle = document.getElementById("fullscreen-toggle") as HTMLButtonElement;

const app = new App({ name: "Doctor Video Search", version: "1.0.0" });
app.connect().then(() => {
  canSubmitLeads = Boolean(app.getHostCapabilities()?.serverTools);
});

let currentVideos: VideoResult[] = [];
let currentView: ViewMode = "carousel";
// Only true once we've actually switched to the fullscreen-only "grid"
// layout via requestDisplayMode — lets us tell "grid because we asked for
// fullscreen" apart from "grid because the tool forced it directly".
let inFullscreen = false;

// Fullscreen is a request, not a guarantee — only offer it when the host
// says it's actually available, and only when there's enough to browse to
// make it worthwhile (a handful of results already fit the carousel fine).
const FULLSCREEN_THRESHOLD = 8;

function supportsFullscreen(): boolean {
  return Boolean(app.getHostContext()?.availableDisplayModes?.includes("fullscreen"));
}

function updateFullscreenBar() {
  if (inFullscreen) {
    fullscreenBar.hidden = false;
    fullscreenToggle.textContent = "Done";
  } else if (currentView === "carousel" && currentVideos.length > FULLSCREEN_THRESHOLD && supportsFullscreen()) {
    fullscreenBar.hidden = false;
    fullscreenToggle.textContent = `View all ${currentVideos.length} ⤢`;
  } else {
    fullscreenBar.hidden = true;
  }
}

function render() {
  renderVideos(root, currentVideos, currentView, (url) => {
    void app.openLink({ url });
  });
  updateFullscreenBar();
}

// offer_lead_magnet's form submits via app.callServerTool("submit_lead",
// ...) rather than a host-pushed tool result, so the widget's own code
// gets the outcome directly — no round trip through ontoolresult needed.
// This requires the host to support server-initiated tool calls FROM the
// app (a host capability, not something this app declares) — checked once
// after connect() and used to render a working form vs. a plain fallback
// message, rather than a submit button that would silently fail.
let canSubmitLeads = false;

async function submitLead(data: {
  email: string;
  name: string;
  answers: Record<string, string>;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await app.callServerTool({
      name: "submit_lead",
      arguments: { email: data.email, name: data.name || undefined, answers: data.answers },
    });
    if (result.isError) {
      const text = result.content?.find((c) => c.type === "text")?.text;
      return { ok: false, error: typeof text === "string" ? text : "Could not save — try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the server — try again." };
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  csv: "text/csv",
};

function guessMimeType(url: string): string {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  return (ext && MIME_BY_EXTENSION[ext]) || "application/octet-stream";
}

// Hands the resource straight to the person inside the chat, instead of
// "check your email" — MCP Apps run in a sandboxed iframe where a direct
// <a download> is blocked, so app.downloadFile() asks the host to do it
// (the host typically shows its own confirmation dialog). Falls back to
// just opening the link externally when the host doesn't support
// host-mediated downloads at all, so there's still always a way to get
// the file rather than a silently broken button.
function downloadResource(magnet: { title: string; resourceUrl: string }) {
  if (!app.getHostCapabilities()?.downloadFile) {
    void app.openLink({ url: magnet.resourceUrl });
    return;
  }
  void app
    .downloadFile({
      contents: [
        {
          type: "resource_link",
          uri: magnet.resourceUrl,
          name: magnet.title,
          mimeType: guessMimeType(magnet.resourceUrl),
        },
      ],
    })
    .then((result) => {
      if (result.isError) void app.openLink({ url: magnet.resourceUrl });
    })
    .catch(() => {
      void app.openLink({ url: magnet.resourceUrl });
    });
}

function applyPayload(payload: ToolPayload | undefined | null) {
  if (!payload) return;
  inFullscreen = false;

  if (payload.kind === "lead_form") {
    fullscreenBar.hidden = true;
    statusEl.textContent = "Free resource form loaded.";
    if (canSubmitLeads) {
      renderLeadForm(root, payload, submitLead, () => downloadResource(payload.magnet));
    } else {
      root.innerHTML = `<p class="empty">This chat app can't submit the form directly — reply in the chat with your email and I'll pass it along.</p>`;
    }
    return;
  }

  currentVideos = payload.videos ?? [];
  currentView = payload.view ?? "carousel";
  // Visually silent — the agent's own reply carries the words. This is
  // only for screen readers, which have no other way to know results
  // loaded (there's no visible status line to announce it for them).
  statusEl.textContent = currentVideos.length
    ? `${currentVideos.length} video${currentVideos.length === 1 ? "" : "s"} loaded.`
    : "No videos found.";
  render();
}

fullscreenToggle.addEventListener("click", async () => {
  if (inFullscreen) {
    const result = await app.requestDisplayMode({ mode: "inline" });
    if (result.mode !== "fullscreen") {
      inFullscreen = false;
      currentView = resolveView(undefined, currentVideos.length);
      render();
    }
    return;
  }

  const result = await app.requestDisplayMode({ mode: "fullscreen" });
  if (result.mode === "fullscreen") {
    inFullscreen = true;
    currentView = "grid";
    render();
  }
});

// The host can also change display mode on its own (e.g. the user exits
// fullscreen via host chrome) — stay in sync rather than trusting only our
// own toggle's result.
app.addEventListener("hostcontextchanged", () => {
  const mode = app.getHostContext()?.displayMode;
  if (inFullscreen && mode !== "fullscreen") {
    inFullscreen = false;
    currentView = resolveView(undefined, currentVideos.length);
    render();
  }
});

// Fires when the host pushes the initial (or a fresh) tool result.
app.ontoolresult = (result) => {
  applyPayload(result.structuredContent as ToolPayload | undefined);
};

render();
