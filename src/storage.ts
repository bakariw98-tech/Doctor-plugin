// src/storage.ts
// Uploads the lead-magnet file to Supabase Storage. Plain REST calls via
// Node's built-in fetch — no @supabase/supabase-js needed for one upload
// endpoint. Uses the service-role key, which bypasses the bucket's RLS
// policies (see the lead_magnet_storage_bucket migration) — that key must
// never reach the browser; this only ever runs from the admin dashboard's
// server-side save-config handler.
const BUCKET = "lead-magnets";

function requireSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Set SUPABASE_URL in the environment to upload the lead-magnet file — it's your Supabase project's " +
        "API URL, e.g. https://<project-ref>.supabase.co (see .env.example).",
    );
  }
  return url.replace(/\/+$/, "");
}

function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error(
      "Set SUPABASE_SERVICE_ROLE_KEY in the environment to upload the lead-magnet file — copy it from " +
        "Supabase: Project Settings -> API -> service_role secret (see .env.example). Keep it secret; it " +
        "bypasses every access rule in the database.",
    );
  }
  return key;
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_") || "file";
}

/**
 * Uploads `data` to the lead-magnets bucket under a unique, collision-proof
 * path and returns its public URL — the same shape offer_lead_magnet
 * already hands to the widget for app.downloadFile(), so nothing else
 * needs to change once this URL is stored as resourceUrl.
 */
export async function uploadResourceFile(data: Buffer, filename: string, mimetype: string): Promise<string> {
  const supabaseUrl = requireSupabaseUrl();
  const key = requireServiceRoleKey();
  const path = `${Date.now()}-${safeFileName(filename)}`;

  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      "Content-Type": mimetype || "application/octet-stream",
      "x-upsert": "true",
    },
    body: new Uint8Array(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload to Supabase Storage failed (${res.status}): ${text || res.statusText}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(path)}`;
}
