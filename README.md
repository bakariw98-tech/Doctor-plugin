# Creator Picks MCP App

An [MCP App](https://modelcontextprotocol.io/extensions/apps) (the open
standard that ChatGPT's Apps SDK is built on) that answers the question a
creator's audience actually asks — *"what do you use for this?"* — with the
creator's own curated pick and a link to buy it.

Someone asks "what knife do you use for everyday cooking" or "what do you
use to stay lean." The plugin answers with the product, a short line in the
creator's own words about why they use it and who it's for, and a **Get it**
button that goes straight to the purchase link.

There is no email gate, no free guide, and nothing collected from the person
asking. The recommendation and the purchase link are the entire payoff,
delivered the moment they ask.

It works as a remote MCP server, so it can be added as a connector in any
MCP-Apps-capable host (Claude, ChatGPT, etc.).

## Product doctrine

This is the canonical framing for the business this repo is a piece of —
positioning, product decisions, landing pages, onboarding, and creator
acquisition all read from this. It governs every per-client deployment
cloned from this repo, not just this one; when in doubt about a product
decision, this section is the source of truth.

### 1. The core idea

We are building infrastructure that makes the recommendations of trusted
authorities directly accessible through AI agents.

The target is not simply "influencers." The ideal creator is **the person
you go to when you want to get better at X** — deep expertise, a track
record, and an audience that looks to them as a reference point. The chef
people go to become better chefs. The photographer people go to become
better photographers. The doctor people trust for a specific area of
health. The mechanic people go to learn how to work on cars. The fitness
coach people follow to transform their physique. The carpenter people
learn woodworking from. The filmmaker people study to improve their
filmmaking. The business operator people study to build a company. The
financial educator people trust to understand investing.

Authority is the underlying asset. The product turns that authority into
something an AI agent can reliably retrieve when a user asks *"What does
this person recommend?"*

### 2. The fundamental user behavior

People don't only ask "what's the best product?" They ask **"what does
this person recommend?"** That distinction is everything.

Someone might search "best chef's knife." But someone who follows a
particular chef may instead think "what knife does [chef] recommend?"
Someone learning photography might ask "what camera does [photographer]
recommend?" Someone following a doctor might ask "what does [doctor]
recommend for X?" Someone learning business might ask "what software does
[expert] use?"

The user isn't merely looking for information. They're looking for the
judgment of someone they trust.

### 3. Authority > attention

Do not confuse an influencer with an authority. A person can have millions
of followers because they are entertaining, attractive, charismatic,
interesting, controversial, or good at making content. That does not
automatically mean their audience treats their recommendations as
authoritative.

The strongest target is someone whose audience thinks *"I want to become
better at what this person has mastered."* The audience isn't simply
watching them — they're learning from them. That creates a much stronger
recommendation relationship:

Creator knows → audience wants to know
Creator has mastered → audience wants to master
Creator recommends → audience considers adopting

A relatively small but highly respected expert can be a better customer
than a massive entertainment influencer.

### 4. The product's job

The product should not primarily be thought of as an affiliate-link
manager, a Linktree replacement, a YouTube search engine, a chatbot, or a
content-search product. Those can be components or capabilities. The
fundamental job is:

**Make an authority's recommendations directly retrievable when their
audience needs them.**

The creator supplies the authority. The system supplies the retrieval
layer. The agent handles the conversation and personalization.

### 5. Why this is different from Linktree / Amazon / storefronts

Creators already have links — Linktree, an Amazon storefront, ShopMy,
individual affiliate links, discount codes, sponsor links, product pages,
YouTube descriptions, an Instagram bio link. That's not the problem.

The problem is that these systems are primarily browse-oriented. Imagine a
creator has 17 mice listed: Mouse 1, Mouse 2, Mouse 3, … Mouse 17. The
user doesn't know which one the creator actually recommends for their
situation. The creator's expertise gets flattened into a list of products.

Our system changes the interaction to *"What are you trying to
accomplish?"* — then the agent determines which recommendation from that
authority is relevant. This transforms a giant catalog of links into a
personalized recommendation from someone the user trusts.

### 6. Recommendations are bigger than products

The underlying data model should not be limited to affiliate products. An
authority can recommend products, tools, software, books, services, tests,
educational resources, restaurants, techniques, routines, protocols,
courses, businesses, websites, other experts, content, equipment,
suppliers, brands, or their own products.

Products are particularly valuable because they create an obvious commerce
event. But **recommendation is the primitive. Commerce is one
monetization layer on top of it.**

### 7. The commerce opportunity

Recommendations that can lead to purchases are especially valuable, across
a few economic models:

- **Affiliate / commission recommendation** — creator recommends a
  third-party product and earns a commission: recommendation → purchase →
  commission. This gives the creator an incentive to maintain and expand
  their recommendations.
- **Commission-based brand partnerships** — the terminology doesn't
  matter; the important question is *does the creator have an economic
  reason to keep generating sales for this recommendation?* If yes, the
  recommendation has persistent economic value.
- **Creator-owned products** — the most powerful case. If an expert
  recommends their own product, the economics are direct: recommendation →
  sale → creator owns the revenue. A chef who owns a knife company. A
  fitness expert who owns a supplement brand. A photographer selling their
  own preset. A doctor with their own educational program. The system
  becomes a distribution channel for the creator's own business.

### 8. "Promotion doesn't have to die"

Traditional sponsorship/content promotion is tied to a specific piece of
content: the creator makes the video, the link lives underneath it, the
campaign generates attention, then the attention decays.

If the creator's recommendation becomes permanently retrievable, the
relationship can keep producing value — someone could discover it months
later just by asking. The recommendation becomes **persistent inventory**
rather than a temporary placement. Especially powerful when the creator
earns commission or owns the product, because they have a reason to keep
the recommendation available.

### 9. "Stop selling so hard"

Creators normally have to repeatedly push: "Buy this." "Use my code."
"Link in bio." "Go check this out." If recommendations are available on
demand, the creator can focus more on creating desire, curiosity,
education, and authority instead.

Instead of "BUY THIS KNIFE," they can simply use the knife, teach with it,
talk about cooking, show the result. Someone later thinks *"wait, what
knife does this person use?"* — they ask, the recommendation is retrieved.

Authority → curiosity → question → recommendation → purchase

replaces

Authority → aggressive sales pitch → click

Commerce feels more natural while the creator's economic incentive stays
intact.

### 10. The free utility is critical

The product should not only be useful when someone is ready to spend
money — that creates a weak mental association ("I only use this when I
need to buy something"). Free utility keeps the system mentally available.

For a cooking authority — **free**: search recipes, find old recipes, ask
for recipes based on ingredients, find recipes by goal, adapt recipes,
retrieve cooking techniques, find videos/content. **Commerce**: ask what
knife/pan/equipment/ingredients/kitchen tools they recommend.

Free utility → repeated use → authority stays top-of-mind → user
encounters a need → asks for a recommendation → commerce

Content stays useful even though content retrieval isn't the fundamental
product — it's what keeps the loop alive between purchases.

### 11. Existing content is the onboarding raw material

The creator shouldn't manually build hundreds of recommendations. Their
existing content already contains enormous amounts of information — a
YouTube channel can supply questions they answer, topics they teach,
products they mention, techniques they recommend, recurring problems,
resources they reference, the language their audience uses, and their
areas of expertise. The system uses that material to generate candidate
recommendations and candidate questions; the creator validates them.

### 12. Creator onboarding philosophy

The creator should feel *"you already built this for me,"* not *"here's
another platform I have to maintain."*

1. **Connect existing sources** — YouTube channel, website, existing
   recommendation pages, storefronts, etc.
2. **System generates candidates** — "We found 86 potential
   recommendations."
3. **Creator approves/corrects** — approve / edit / reject. They're
   confirming the system's understanding of their expertise, not writing
   it from scratch.
4. **Add monetization info** — purchase URL, affiliate URL, discount
   code, creator-owned product, booking URL, resource URL, where
   applicable.
5. **Publish** — the recommendations become available to the agent.

This is workshop tooling (see *Cloning it for another creator* above) —
it runs once, per client, in Claude Code. It never ships inside the
deployed server itself.

### 13. Don't build around hundreds of questions upfront

Don't predict every possible question. Start with the authority's core
recommendation graph, then let real audience behavior fill the gaps.
Someone asks "what thermometer does he recommend?" — there isn't one. The
system records the demand. The dashboard says "47 people asked about
thermometers this month. You don't currently have a recommendation." The
creator adds one.

Existing expertise → recommendations → audience questions → unmet demand
→ new recommendations

Audience demand determines what gets added next, not guesswork. This is
exactly what `/admin`'s gap report (see *What it does and doesn't do*
above) already does for every deployment.

### 14. The creator dashboard

`/admin` should eventually provide more than link management:

- **Recommendations** — everything the creator has approved.
- **Audience questions** — what people are asking.
- **Unmet demand** — questions where no recommendation currently exists.
- **Opportunities** — potential products/services/brands the creator
  could add.

"Best knife for beginners — 842 requests, no recommendation currently
available" is valuable information on its own, and it can become sponsor
intelligence: real demand data a creator can bring to a brand instead of
a guess.

### 15. The product loop

Creator adds recommendation → audience asks questions → system matches
question to recommendation → audience clicks / buys / acts → creator sees
demand → creator discovers unmet demand → creator adds more
recommendations → more questions can be answered → more commerce.

The recommendation catalog gets better from actual audience intent, not
guesses.

### 16. The ideal customer profile

Not "influencer." Instead: **an authority in a specific domain whose
audience actively seeks their judgment.** The strongest prospects have
authority, a teaching relationship with their audience, an aspirational
relationship (the audience wants to achieve what they've achieved), an
existing audience, existing recommendations, monetizable recommendations,
and a contactable business channel.

### 17. Best initial creator categories

Prioritize authorities where recommendations naturally influence
decisions: professional educators, specialist doctors / health educators,
professional chefs / culinary educators, photography educators, filmmaking
educators, fitness coaches, woodworking / trades experts, automotive
experts, technology educators, outdoor / gear experts, business operators,
financial educators.

The common denominator isn't the category — it's *"people go to this
person specifically to become better at X."*

### 18. Prospecting rule

Don't ask "who has the most followers?" Ask **"who is the person people
go to when they want to get better at this?"** Then: how large is their
audience, how strong is their authority, what do they recommend, how
often does their audience ask what they use, do they already monetize
recommendations, do they sell their own products/services, can we build a
compelling personalized demo?

The ideal first creator may be famous — but doesn't have to be. Authority
is more important than fame.

### 19. The core positioning

*"You already earned your audience's trust. We make your expertise and
recommendations directly retrievable when they need them."*

*"Your audience asks. You recommend. They get the answer. Make your
recommendations available on demand. When your audience asks what you
recommend, give them the answer — not another list of links. Turn your
expertise into recommendations your audience can actually retrieve."*

Avoid positioning the company primarily around AI, chatbots,
affiliate-link management, a Linktree replacement, or content search —
those describe implementation details, not the fundamental value.

### 20. The most important product principle

**The creator's expertise is the source of truth.** The system should
never invent a recommendation just because something appears relevant. If
the authority doesn't have one: say there is no recommendation. Trust is
the product — a user should be able to believe *"if this system says this
person recommends it, they actually recommend it."* Especially important
for doctors, educators, and other high-authority figures. (This is
implemented today: see *It never invents a product, a reason, or a price*
above.)

### 21. The UI philosophy

The interface should not become a giant advertisement. The conversational
model handles the explanation; the UI's job is to make the recommendation
actionable. A compact card — product image, product name, "Get it →",
copy code if applicable — is potentially enough. The model's response
explains *"I'd go with X because you're looking for…"* The creator's
detailed onboarding information is context for the system, not
necessarily text dumped onto the card. The card's job: *here is the thing
you were looking for.*

### 22. The core technical architecture

```
Authority
  → expertise / content / recommendations
Structured recommendation layer
  → products, resources, services, creator-owned offers, contextual info
Agent retrieval
  → understand the user's situation, identify the relevant authority,
    retrieve the appropriate recommendation, personalize the explanation
Action
  → purchase, affiliate click, promo code, booking, resource, creator offer
```

The agent is the conversational interface. The recommendation layer is the
authoritative source behind it.

### 23. The long-term vision

Not "make affiliate links easier to find." It's **building the
recommendation infrastructure for trusted experts inside the agent
ecosystem.** Today, an agent may search the web and try to reconstruct
what an expert recommends from scattered pages, old videos, storefronts,
and social posts. The opportunity is to give the agent a direct,
structured, authoritative source instead — the authority has a dedicated
recommendation layer.

### 24. The business thesis, in one paragraph

People increasingly use agents to decide what to do, what to buy, and how
to solve problems. When they trust an authority, they naturally want that
person's judgment — not a generic answer. We provide the infrastructure
that makes an authority's recommendations directly retrievable by agents.
We use the creator's existing content and knowledge to build the
recommendation layer, minimize their ongoing work, and let their audience
ask for personalized recommendations on demand. Products and
creator-owned offers can turn those recommendations into measurable
commerce, while free utilities such as content and knowledge retrieval
keep the system useful between purchases.

### 25. The one sentence every agent should remember

*"We are building for the person you go to when you want to get better at
X — an authority whose audience trusts their judgment — and we're making
that person's expertise and recommendations directly retrievable by AI
agents when their audience needs them."*

And the second sentence: *"The goal is not to replace their content,
storefront, or existing links; it is to create a new, low-friction path
from audience intent → trusted recommendation → action or purchase."*

## What it does and doesn't do

- **It never comes up empty.** If someone asks about something the catalog
  doesn't cover, the tool still returns the closest real thing and flags the
  match as weak — so the model says plainly that there's no specific pick and
  steers to something the creator actually uses ("he doesn't have a pan he
  recommends, but he does swear by this knife for prep") instead of either
  inventing a product or saying "I don't know."
- **It never invents a product, a reason, or a price.** Everything the model
  speaks comes from the catalog. The blurb on each card is the creator's own
  words, written by them in `/admin`, and nothing is generated for them.
- **Every answer discloses the affiliate relationship.** Every buy link is
  affiliate-tagged, so the disclosure ships in two places: under the cards in
  the widget, and inside the tool result, where the model is told to say it.
  The second one is the one that matters — on a host that doesn't render the
  widget, the model's reply is the whole answer. Wording is
  `disclosure` in `src/creator.ts`.
- **Every unanswered question is recorded.** A question with no good match is
  the most valuable row in the database: it's a product the audience already
  wants and the creator isn't recommending yet. `/admin` surfaces those as a
  gap list.

## How it works

- **`src/creator.ts`** — who this deployment answers as: display name,
  pronouns, voice, affiliate disclosure, accent, and the slug the widget's
  `ui://` resource is built from. One deployment serves one creator, so this
  is checked-in config rather than env vars — see *Cloning it for another
  creator* below.
- **`src/mcp-server.ts`** — builds the MCP server. Two tools:
  `recommend_product` (the main one — takes the person's question verbatim,
  returns the pick plus a tracked buy link) and `list_recommendations` (browse
  a category, for "what does he recommend for the kitchen"). Both are linked
  to the UI resource via `_meta.ui.resourceUri` and the
  `openai/outputTemplate` alias, for ChatGPT's Apps SDK.
- **`src/recommend.ts`** — turning a question into a pick, shared by the MCP
  tool and the REST endpoint so the browser preview exercises the same
  matching the real thing does.
- **`src/match.ts`** — the matcher. TF-IDF-style scoring over the catalog, so
  a rare, specific word ("creatine") outweighs one that appears across every
  product. No embeddings, no external service: a catalog is small enough to
  scan per request. It also reports what *share* of the question it matched,
  which is what separates a real answer from a steer.
- **`src/db.ts`** — the Postgres client (the plain
  [`postgres`](https://github.com/porsager/postgres) driver against a
  [Supabase](https://supabase.com) connection string). Owns the schema
  (`products`, `product_questions`, `product_clicks`) and creates it
  idempotently on first use.
- **`src/admin.ts`** — the `/admin` dashboard: catalog CRUD, a bulk import for
  pasting an existing affiliate list, and the insight panel (most-asked
  questions, the gap list, clicks per product). Plain server-rendered HTML
  behind a shared-token cookie (`ADMIN_TOKEN`).
- **`api/redirect.ts`** — `GET /r/<productId>?q=<questionId>`: counts the
  click, then redirects to the stored buy link. The destination is always
  looked up by id and never read from the request, so this can't be used as
  an open redirect.
- **`mcp-app.html` / `src/mcp-app.ts` / `src/product-card.ts`** — the widget
  that renders inside a chat host, and the card rendering it shares with the
  demo page. Two densities across four layouts — see `design/README.md`.
- **`index.html` / `src/demo.ts`** — a standalone browser demo (talking to
  `/api/recommend` instead of the MCP bridge, with a question box and a
  view dropdown since there's no chat agent here to supply either), deployed
  at the site root so it's testable without a chat client.
- **`server.ts`** — local dev entry point: Express serving `/mcp`,
  `/api/recommend`, `/r/:id`, `/admin` and the static demo page from one
  process. **`api/*.ts`** are the same endpoints as Vercel serverless
  functions, used in production.

## Setup

### 1. Create a Supabase project

At [supabase.com](https://supabase.com) — free tier is fine. This is a
manual, one-time step; nothing in this repo can do it for you.

Copy `.env.example` to `.env` and fill in `DATABASE_URL` and `ADMIN_TOKEN`
(see that file for exactly where each value comes from).

```bash
cp .env.example .env
# then edit .env
```

**Just want to see it work first?** Set `DEMO_MODE=1` and skip straight to
step 2 — everything runs against an in-process store instead of Postgres.
Nothing is saved (it resets on restart), so this is for previewing the flow
only.

### 2. Install, build, and run

```bash
npm install
npm run build   # bundles the widget (dist/) and demo page (public/)
npm run serve   # starts the server: /mcp, /api/recommend, /r/:id, /admin
```

(`npm run dev` does both in one step.) Open `http://localhost:3001/` for the
browser demo, `http://localhost:3001/admin` to fill in your catalog, or point
a chat client at `http://localhost:3001/mcp`.

### 3. Fill in the catalog

Visit `/admin`, log in with your `ADMIN_TOKEN`, and add what you recommend.
Each product takes a name, a buy link, and — the part that matters — **your
own line about why you use it**, which is what the card shows and what the
model speaks. Nothing is written for you.

If you already have an affiliate list (Amazon storefront, LTK, a notes file),
paste it into the **Import a list** box: one URL per line, or
`name, url, category`. Everything imports as a draft with no description, and
drafts are never recommended — so an unfinished import can't produce a
recommendation with no words behind it. Write your line, hit publish.

### Optional: product photo uploads

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (see `.env.example`) to let
`/admin` upload photos directly. This needs a one-time public storage bucket,
created from the Supabase SQL editor:

```sql
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public read product-images" on storage.objects
  for select using (bucket_id = 'product-images');
```

Uploading is the recommended path rather than pasting a merchant's image URL:
the widget's CSP allowlist is fixed when the resource is registered and can't
enumerate every retailer CDN, so a pasted URL from an unlisted host renders
blank with no error. Routing every photo through one bucket means one origin
on the allowlist.

## Cloning it for another creator

Each creator gets their own repo, their own Vercel project and their own
database — there is no tenancy here and there isn't meant to be. To stand up
the next one: fork the repo, then **edit `src/creator.ts` and nothing else.**

```ts
export const config: CreatorConfig = {
  displayName: "Ash",
  handle: "@ashcooks",
  pronouns: "they/them",        // she/her · he/him · they/them, or a custom set
  voice: "You're answering as Ash. Dry, unfussy, allergic to hype.",
  accent: "#2f6f4e",
};
```

Everything else follows: the MCP server and widget names, the `ui://` resource
URI, the `/admin` header, the affiliate disclosure, the accent on the buy
button, and every mention of the creator in the two tool descriptions the
model reads. Pronouns default to they/them and are **never** guessed from the
name — set them, or the model uses the safe default.

Then give the new deployment its own `DATABASE_URL`, `ADMIN_TOKEN` and
Supabase storage bucket, and fill the catalog at `/admin`. Nothing about one
creator's deployment is shared with another's.

## Deploying to Vercel

The repo deploys as-is (`vercel.json` wires the build + serverless functions):
`npm run build` runs as the build command, `public/index.html` becomes the
site root, and `api/mcp.ts` / `api/recommend.ts` / `api/admin.ts` /
`api/redirect.ts` become functions at `/api/mcp` (also `/mcp`),
`/api/recommend`, `/api/admin` (also `/admin`), and `/r/:id`.

**Environment variables are per-platform** — GitHub repo secrets are not
visible to Vercel. Set `DATABASE_URL` and `ADMIN_TOKEN` (plus the two Supabase
storage vars if you want uploads) under the Vercel project's **Settings →
Environment Variables**, then redeploy. Env var changes don't take effect
until the next deploy.

Once deployed:

- Visit the deployment URL for the live browser demo.
- Use `https://<your-deployment>.vercel.app/mcp` as the connector URL in
  Claude or ChatGPT developer mode.

## Upgrading from the lead-capture version

Earlier versions of this app searched a YouTube channel and offered a free
guide in exchange for an email. All of that is gone: `search_doctor_videos`,
`offer_lead_magnet`, `submit_lead`, the transcript dataset, the YouTube API
client, and the `leads` / `lead_magnet_config` / `lead_form_questions` tables.

Those three tables are **not** dropped automatically — a deploy that silently
destroyed a collected email list would be unrecoverable. Retire them
deliberately, in two steps:

```bash
npm run retire-leads            # exports every lead to leads-export.csv
# check the file, then:
npm run retire-leads -- --drop  # drops the three tables
```

You can also drop `YOUTUBE_API_KEY`, `YOUTUBE_CHANNEL_ID`,
`YOUTUBE_CHANNEL_HANDLE` and `SUPADATA_API_KEY` from `.env` and from Vercel —
nothing reads them any more.

## Testing it in a chat client

MCP Apps need a host that understands the UI extension.

**Claude (web/desktop):** add your deployment's `/mcp` URL (or a tunneled
local server, e.g. `npx cloudflared tunnel --url http://localhost:3001`) as a
[custom connector](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
under Settings → Connectors. Then ask it what the creator uses for something.

**ChatGPT (developer mode):** enable developer mode, add the same URL as a
connector, and ask the same kind of question — ChatGPT will call
`recommend_product` and render the widget via the `openai/outputTemplate` link.

**Local basic-host:** the
[`ext-apps`](https://github.com/modelcontextprotocol/ext-apps) repo ships a
minimal test host if you'd rather not tunnel anything while iterating on the
widget UI.

## Next steps / ideas

- Let a product carry more than one buy link (different retailers/regions).
- Track which questions convert best per product, not just totals.
- A "what's new" tool for recently added recommendations.
