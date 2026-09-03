# Business Plan / Product Doctrine

## Authority Recommendation Infrastructure for AI Agents

> **Canonical source of truth.** This document defines positioning, product
> decisions, landing pages, onboarding, and creator acquisition for this
> product. Any agent or contributor working on this codebase, its marketing
> site, or its go-to-market should treat this as the reference — read it
> before making decisions that touch positioning, the recommendation data
> model, onboarding flow, or the UI philosophy for recommendation cards.

---

## 1. The Core Idea

We are building infrastructure that makes the recommendations of trusted
authorities directly accessible through AI agents.

The target is not simply "influencers."

The ideal creator is:

> The person you go to when you want to get better at X.

They have deep expertise, a track record, and an audience that looks to
them as a reference point.

Examples:

- The chef people go to become better chefs
- The photographer people go to become better photographers
- The doctor people trust for a specific area of health
- The mechanic people go to learn how to work on cars
- The fitness coach people follow to transform their physique
- The carpenter people learn woodworking from
- The filmmaker people study to improve their filmmaking
- The business operator people study to build a company
- The financial educator people trust to understand investing

Authority is the underlying asset.

The product turns that authority into something an AI agent can reliably
retrieve when a user asks:

> "What does this person recommend?"

---

## 2. The Fundamental User Behavior

The key behavior already exists.

People don't only ask:

> "What's the best product?"

They ask:

> "What does this person recommend?"

That distinction is everything.

Someone might search "Best chef's knife" — but someone who follows a
particular chef may instead think "What knife does [chef] recommend?"
Someone learning photography might ask "What camera does [photographer]
recommend?" Someone following a doctor might ask "What does [doctor]
recommend for X?" Someone learning business might ask "What software does
[expert] use?"

The user isn't merely looking for information. They're looking for the
judgment of someone they trust.

---

## 3. Authority > Attention

Do not confuse an influencer with an authority.

A person can have millions of followers because they are entertaining,
attractive, charismatic, interesting, controversial, or good at making
content. That does not automatically mean their audience treats their
recommendations as authoritative.

The strongest target is someone whose audience thinks:

> "I want to become better at what this person has mastered."

The audience isn't simply watching them. They're learning from them. That
creates a much stronger recommendation relationship.

The ideal audience relationship is:

**Creator knows → audience wants to know**
**Creator has mastered → audience wants to master**
**Creator recommends → audience considers adopting**

This is why a relatively small but highly respected expert can potentially
be a better customer than a massive entertainment influencer.

---

## 4. The Product's Job

The product should not primarily be thought of as:

- an affiliate-link manager
- a Linktree replacement
- a YouTube search engine
- a chatbot
- a content-search product

Those can be components or capabilities.

The fundamental job is:

> Make an authority's recommendations directly retrievable when their
> audience needs them.

The creator supplies the authority. The system supplies the retrieval
layer. The agent handles the conversation and personalization.

---

## 5. Why This Is Different From Linktree / Amazon / Storefronts

Creators already have links. That's not the problem.

A creator might have a Linktree, an Amazon storefront, ShopMy, individual
affiliate links, discount codes, sponsor links, product pages, YouTube
descriptions, Instagram bio links.

The problem is that these systems are primarily browse-oriented.

Imagine a creator has 17 mice listed. The user sees Mouse 1, Mouse 2, Mouse
3 … Mouse 17. But the user doesn't know: which one does the creator
actually recommend for my situation? The creator's expertise gets
flattened into a list of products.

Our system changes the interaction to:

> "What are you trying to accomplish?"

Then the agent can determine which recommendation from that authority is
relevant. The user gets the appropriate product, resource, service, or
recommendation.

This transforms **a giant catalog of links** into **a personalized
recommendation from someone the user trusts.**

---

## 6. Recommendations Are Bigger Than Products

The underlying data model should not be limited to affiliate products.

An authority can recommend: products, tools, software, books, services,
tests, educational resources, restaurants, techniques, routines,
protocols, courses, businesses, websites, other experts, content,
equipment, suppliers, brands, their own products.

Products are particularly valuable because they create an obvious commerce
event. But **recommendation is the primitive.** Commerce is one
monetization layer on top of it.

---

## 7. The Commerce Opportunity

Recommendations that can lead to purchases are especially valuable. There
are several economic models.

**Affiliate / commission recommendation** — Creator recommends a
third-party product and receives commission. Recommendation → purchase →
creator earns commission. This creates an incentive for the creator to
maintain and expand their recommendations.

**Commission-based brand partnerships** — A creator may have a brand
relationship where they receive compensation based on resulting sales.

The important thing is not the terminology. The important question is:

> Does the creator have an economic reason to continue generating sales
> for this recommendation?

If yes, the recommendation has persistent economic value.

**Creator-owned products** — This can be even more powerful. If an expert
recommends their own product, the economics are direct: Recommendation →
sale → creator owns the revenue. For example: a chef owns a knife company,
a fitness expert owns a supplement/product brand, a photographer sells
their own preset or equipment product, a doctor has their own educational
program. The system becomes a distribution channel for the creator's own
business.

---

## 8. The "Promotion Doesn't Have to Die" Insight

Traditional sponsorship/content promotion is often tied to a specific piece
of content. The creator makes the video, the link/code lives underneath
the video, the campaign generates attention, then the attention decays.

But if the creator's recommendation becomes permanently retrievable, the
relationship can continue producing value. Someone could discover a
creator's recommendation months later by asking "What does this person
recommend for X?"

The recommendation can therefore become **persistent inventory** rather
than a temporary placement. This is especially powerful when the creator
receives commission or owns the product because they have a reason to keep
the recommendation available.

---

## 9. The "Stop Selling So Hard" Insight

The system can potentially change creator behavior.

Creators normally have to repeatedly push "Buy this," "Use my code,"
"Link in bio," "Go check this out."

But if recommendations are available on demand, the creator can focus more
on creating desire, curiosity, education, and authority. Instead of "BUY
THIS KNIFE," they can simply use the knife. Teach with it. Talk about
cooking. Show the result. Someone later thinks "Wait, what knife does this
person use?" They ask. The recommendation is retrieved.

This creates:

**Authority → curiosity → question → recommendation → purchase**

instead of:

**Authority → aggressive sales pitch → click**

That can make commerce feel more natural while preserving the creator's
economic incentive.

---

## 10. The Free Utility Is Critical

The product should not only be useful when someone is ready to spend
money. That creates a weak mental association: "I only use this when I
need to buy something."

Instead, the system should provide free utility that keeps it mentally
available.

For a cooking authority:

**Free** — search recipes, find old recipes, ask for recipes based on
ingredients, find recipes by goal, adapt recipes, retrieve cooking
techniques, find videos/content.

**Commerce** — ask what knife they recommend, ask what pan they recommend,
ask what equipment they use, ask what ingredients/products they recommend,
ask what kitchen tools they recommend.

The free utility creates the habit. Then the commerce moment happens
naturally.

The strategic loop:

**Free utility → repeated use → authority stays top-of-mind → user
encounters a need → asks for recommendation → commerce**

This is why content remains useful even though content retrieval is not
the fundamental product.

---

## 11. Existing Content Is the Onboarding Raw Material

The creator shouldn't have to manually build hundreds of recommendations.
Their existing content already contains enormous amounts of information.

A YouTube channel can provide: questions they answer, topics they teach,
products they mention, techniques they recommend, recurring problems,
resources they reference, language their audience uses, areas of
expertise.

The system can use that material to generate candidate recommendations and
candidate questions. The creator then validates them.

---

## 12. Creator Onboarding Philosophy

The creator should feel:

> "You already built this for me."

Not:

> "Here's another platform I have to maintain."

The onboarding workflow should therefore be:

**Step 1 — Connect existing sources.** YouTube channel, website, existing
recommendation pages, storefronts, etc.

**Step 2 — System generates candidates.** For example: "We found 86
potential recommendations."

**Step 3 — Creator approves/corrects.** Approve / Edit / Reject. The
creator isn't writing everything from scratch. They're simply confirming
the system's understanding of their expertise.

**Step 4 — Add monetization information**, where applicable: purchase URL,
affiliate URL, discount code, creator-owned product, booking URL, resource
URL.

**Step 5 — Publish.** The recommendations become available to the agent.

---

## 13. Do Not Build Around Hundreds of Questions Upfront

This is important. We don't need to predict every possible question.

Start with the authority's core recommendation graph. Then let real
audience behavior fill the gaps.

Example: the audience asks "What thermometer does he recommend?" There
isn't one. The system records the demand. Creator dashboard: "47 people
asked about thermometers this month. You don't currently have a
recommendation." Creator adds one. Now the recommendation system becomes
better because audience demand determines what gets added next.

This creates a feedback loop:

**Existing expertise → recommendations → audience questions → unmet
demand → new recommendations**

---

## 14. The Creator Dashboard

The dashboard should eventually provide more than link management.

Potential sections:

- **Recommendations** — everything the creator has approved.
- **Audience Questions** — what people are asking.
- **Unmet Demand** — questions where no recommendation currently exists.
- **Opportunities** — potential products/services/brands the creator could
  add.

Example: "Best knife for beginners" — 842 requests. No recommendation
currently available. That is valuable information. It can eventually
become sponsor intelligence: "Your audience asked about this 842 times."
Now the creator has actual demand data when approaching a brand.

---

## 15. The Product Loop

The long-term loop is:

Creator adds recommendation
→ Audience asks questions
→ System matches question to recommendation
→ Audience clicks / buys / acts
→ Creator sees demand
→ Creator discovers unmet demand
→ Creator adds more recommendations
→ More questions can be answered
→ More commerce

This creates a recommendation catalog that gets better from actual
audience intent, not guesses.

---

## 16. The Ideal Customer Profile

The primary customer should not be defined as "Influencer."

Instead: **an authority in a specific domain whose audience actively seeks
their judgment.**

The strongest prospects have:

- **Authority** — they are recognized as experts.
- **Teaching relationship** — their audience follows them to learn.
- **Aspirational relationship** — their audience wants to achieve what
  they have achieved.
- **Existing audience** — enough people are already asking questions.
- **Existing recommendations** — they already recommend things.
- **Monetizable recommendations** — products, services, courses, tools,
  etc.
- **Contactability** — they have a business email or obvious professional
  contact channel.

---

## 17. Best Initial Creator Categories

Prioritize authorities where recommendations naturally influence
decisions.

Potential categories:

1. Professional educators
2. Specialist doctors / health educators
3. Professional chefs / culinary educators
4. Photography educators
5. Filmmaking educators
6. Fitness coaches
7. Woodworking / trades experts
8. Automotive experts
9. Technology educators
10. Outdoor / gear experts
11. Business operators
12. Financial educators

The common denominator is not the category. It is:

> "People go to this person specifically to become better at X."

---

## 18. Prospecting Rule

Do not ask "Who has the most followers?"

Ask: **"Who is the person people go to when they want to get better at
this?"**

Then determine:

- How large is their audience?
- How strong is their authority?
- What do they recommend?
- How often does their audience ask what they use?
- Do they already monetize recommendations?
- Do they sell their own products/services?
- Can we build a compelling personalized demo?

The ideal first creator may be famous. But they don't have to be. Authority
is more important than fame.

---

## 19. The Core Positioning

The business should consistently communicate this idea:

> You already earned your audience's trust. We make your expertise and
> recommendations directly retrievable when they need them.

Alternative positioning:

> Your audience asks. You recommend. They get the answer.
>
> Make your recommendations available on demand.
>
> When your audience asks what you recommend, give them the answer — not
> another list of links.
>
> Turn your expertise into recommendations your audience can actually
> retrieve.

Avoid positioning the company primarily around: AI, chatbots,
affiliate-link management, Linktree replacement, content search. Those
describe implementation details rather than the fundamental value.

---

## 20. The Most Important Product Principle

**The creator's expertise is the source of truth.**

The system should never invent a recommendation simply because something
appears relevant. If the authority doesn't have a recommendation: say
there is no recommendation.

**Trust is the product.** A user should be able to believe: "If this
system says this person recommends it, they actually recommend it." That
is especially important for doctors, educators, professional experts, and
other high-authority figures.

---

## 21. The UI Philosophy

The interface should not become a giant advertisement. The conversational
model handles the explanation. The UI should primarily make the
recommendation actionable.

A compact recommendation card can contain: product image, product name,
Get it →, copy code (if applicable). That's potentially enough.

The model's response can explain: "I'd go with X because you're looking
for…"

The creator's detailed onboarding information is context for the system,
not necessarily text that needs to be dumped into the card. The card's job
is:

> Here is the thing you were looking for.

---

## 22. The Core Technical Architecture

Conceptually:

```
Authority
  → expertise / content / recommendations

Structured recommendation layer
  → products
  → resources
  → services
  → creator-owned offers
  → contextual recommendation information

Agent retrieval
  → understand user's situation
  → identify relevant authority
  → retrieve appropriate recommendation
  → personalize explanation

Action
  → purchase
  → affiliate click
  → promo code
  → booking
  → resource
  → creator offer
```

The agent is the conversational interface. The recommendation layer is the
authoritative source behind it.

---

## 23. The Long-Term Vision

The long-term opportunity is not simply "make affiliate links easier to
find." It's:

> Build the recommendation infrastructure for trusted experts inside the
> agent ecosystem.

Today, an agent may search the web and attempt to reconstruct what an
expert recommends. The opportunity is to give the agent a direct,
structured, authoritative source. So when someone asks "What would this
person recommend?" the answer doesn't have to be reconstructed from
scattered pages, old videos, storefronts, and social posts. The authority
has a dedicated recommendation layer.

---

## 24. The Business Thesis in One Paragraph

People increasingly use agents to decide what to do, what to buy, and how
to solve problems. When they trust an authority, they naturally want that
person's judgment — not a generic answer. We provide the infrastructure
that makes an authority's recommendations directly retrievable by agents.
We use the creator's existing content and knowledge to build the
recommendation layer, minimize their ongoing work, and allow their
audience to ask for personalized recommendations on demand. Products and
creator-owned offers can turn those recommendations into measurable
commerce, while free utilities such as content and knowledge retrieval
keep the system useful between purchases.

---

## 25. The One Sentence Every Agent Should Remember

> We are building for the person you go to when you want to get better at
> X — an authority whose audience trusts their judgment — and we're making
> that person's expertise and recommendations directly retrievable by AI
> agents when their audience needs them.

And the second sentence:

> The goal is not to replace their content, storefront, or existing links;
> it is to create a new, low-friction path from audience intent → trusted
> recommendation → action or purchase.
