// src/creator.ts
// Who this deployment answers as. Every string that identifies the creator
// — the name the model says, the pronouns it uses for them, the voice it
// borrows, the affiliate disclosure, the accent on the card — resolves
// from the single object below.
//
// TO CLONE THIS PLUGIN FOR A NEW CREATOR: edit this file, and nothing
// else. Anything outside it that has to know whose plugin this is belongs
// in here instead.
//
// Checked-in TypeScript rather than env vars, deliberately: one deployment
// serves exactly one creator, forever, and each creator gets their own
// repo and their own Vercel project. Identity belongs where it shows up in
// a diff and gets reviewed before it ships. A missing env var here
// wouldn't degrade a feature quietly — it would have the plugin answer as
// the wrong person, in production, with nothing to notice.

/** The third-person forms the tool descriptions actually need. */
export interface Pronouns {
  /** she / he / they */
  subject: string;
  /** her / him / them */
  object: string;
  /** her / his / their */
  possessive: string;
  /** Verb agreement — "they use", but "she uses". See `verb()`. */
  plural: boolean;
}

export type PronounSet = "she/her" | "he/him" | "they/them";

const PRONOUN_SETS: Record<PronounSet, Pronouns> = {
  "she/her": { subject: "she", object: "her", possessive: "her", plural: false },
  "he/him": { subject: "he", object: "him", possessive: "his", plural: false },
  "they/them": { subject: "they", object: "them", possessive: "their", plural: true },
};

export interface CreatorConfig {
  /** What the model calls them, and the name in the disclosure: "Kristina". */
  displayName: string;

  /** Social handle, shown on /admin so the right dashboard is obvious. */
  handle?: string;

  /**
   * A named set, or a full Pronouns object for anything the three presets
   * don't cover. Never inferred from the name anywhere in this codebase: a
   * confident wrong guess about a real person is worse than the they/them
   * default, which is correct for everyone until someone says otherwise.
   */
  pronouns?: PronounSet | Pronouns;

  /**
   * One or two sentences of persona, injected into the tool descriptions so
   * the plugin sounds like this creator rather than like software. Written
   * as an instruction to the model: "You're answering as X. She's blunt,
   * hates fluff, and only recommends things she actually uses."
   */
  voice?: string;

  /**
   * URL-safe id for the widget's `ui://` resource URI. Defaults to the
   * display name; set it only when that would collide or read badly.
   */
  slug?: string;

  /** Branding on the widget resource, the MCP server, and /admin. */
  appName?: string;

  /**
   * The FTC affiliate disclosure. Every buy link this plugin hands out is
   * affiliate-tagged, so this ships in the tool text and on the card; the
   * default is honest and generic, but a creator whose income depends on it
   * should set the wording their own lawyer or network signed off on.
   */
  disclosure?: string;

  /**
   * Accent hex for the buy button, promo chip and focus ring. Omit to keep
   * the built-in accent, which is a light/dark PAIR tuned per colour scheme
   * — one hex here replaces both, so pick one that survives a dark ground.
   */
  accent?: string;
}

// ─── The one thing to edit ───────────────────────────────────────────────
export const config: CreatorConfig = {
  displayName: "Miss Meat",
  handle: "@missmeatt",
  pronouns: "she/her",
  // Drawn from how she actually writes in her own catalog ("This is the
  // salt I actually keep in my kitchen", "no anti-caking junk, no
  // fillers"), not invented — the model should sound like the blurbs it's
  // handed, not like a second person talking over them.
  voice:
    "You're answering as Miss Meat. She's direct and unglossy — first person, no hype adjectives, " +
    "no spec sheets. She cares about clean ingredients and says what's NOT in a thing as readily " +
    "as what is. She only recommends what she actually uses, and she says how she uses it in " +
    "specifics ('on steak right before it comes off the heat'), never in generalities.",
  // Predates this file; kept verbatim so the live deployment's ui:// URI
  // doesn't move under hosts that are already talking to it.
  slug: "creator-picks",
};
// ─────────────────────────────────────────────────────────────────────────

/** `config`, with every default filled in — this is what the app reads. */
export interface Creator {
  displayName: string;
  handle: string | null;
  pronouns: Pronouns;
  voice: string;
  slug: string;
  appName: string;
  disclosure: string;
  /** null means "keep the built-in light/dark pair" — see CreatorConfig.accent. */
  accent: string | null;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolve(input: CreatorConfig): Creator {
  const name = input.displayName.trim();
  const pronouns = typeof input.pronouns === "string"
    ? PRONOUN_SETS[input.pronouns]
    : input.pronouns ?? PRONOUN_SETS["they/them"];

  return {
    displayName: name,
    handle: input.handle?.trim() || null,
    pronouns,
    voice: input.voice?.trim() || `You're answering as ${name}.`,
    // A name with nothing URL-safe in it (non-Latin script, punctuation
    // only) would otherwise produce "ui:///mcp-app.html", which registers
    // fine and then never matches the tool's outputTemplate.
    slug: input.slug?.trim() || slugify(name) || "creator-picks",
    appName: input.appName?.trim() || `${name}'s Picks`,
    disclosure: input.disclosure?.trim()
      || `Some links are affiliate links — ${name} may earn a commission.`,
    accent: input.accent?.trim() || null,
  };
}

export const creator: Creator = resolve(config);

/**
 * The verb form that agrees with the configured pronoun — "she uses" against
 * "they use". Both forms are spelled out rather than derived by adding an
 * "s", because the words this is needed for are the irregular ones
 * ("does"/"do", "has"/"have").
 *
 * Only for verbs whose subject is the PRONOUN. A name is always singular,
 * even for a they/them creator: "they don't have a pan", but "Ash doesn't
 * have a pan".
 */
export function verb(singular: string, plural: string): string {
  return creator.pronouns.plural ? plural : singular;
}
