// src/storage.ts
// Uploads product photos to Supabase Storage. Plain REST calls via Node's
// built-in fetch — no @supabase/supabase-js needed for one upload
// endpoint. Uses the service-role key, which bypasses the bucket's RLS
// policies — that key must never reach the browser; this only ever runs
// from the admin dashboard's server-side product-save handler.
//
// Why upload at all rather than just storing the merchant's own image
// URL: the widget's CSP allowlist (RESOURCE_DOMAINS in src/mcp-server.ts)
// is fixed when the resource is registered and can't enumerate every
// retailer CDN a creator might link to. Routing every photo through one
// bucket means one origin on the allowlist instead of an open-ended list
// that silently renders blank the first time someone links a new store.
//
// Requires a public bucket named below, created once outside this repo:
//   insert into storage.buckets (id, name, public) values
//     ('product-images', 'product-images', true)
//   on conflict (id) do nothing;
// plus a policy allowing public SELECT on it. See README.md.
const BUCKET = "product-images";

function requireSupabaseUrl(): string {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Set SUPABASE_URL in the environment to upload product photos — it's your Supabase project's " +
        "API URL, e.g. https://<project-ref>.supabase.co (see .env.example).",
    );
  }
  return url.replace(/\/+$/, "");
}

function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new Error(
      "Set SUPABASE_SERVICE_ROLE_KEY in the environment to upload product photos — copy it from " +
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
 * Uploads `data` to the product-images bucket under a unique,
 * collision-proof path and returns its public URL, ready to store as a
 * product's image_url.
 */
export async function uploadImageFile(data: Buffer, filename: string, mimetype: string): Promise<string> {
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
