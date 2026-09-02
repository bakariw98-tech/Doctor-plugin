# Design canvas — recommendation cards

Source files for the design canvas exploring how a product recommendation
renders inside a chat.

Published canvas:
https://claude.ai/code/artifact/e6c8ba7c-7e2a-4810-a85e-fcf6696c64e1

## Files

- `Main.dc.html` — One (a single detailed card is the whole widget)
- `Few.dc.html` — Two or three, detail cards sized to fit
- `Carousel.dc.html` — Many, compact tiles at one fixed size, scrolls
- `Grid.dc.html` — Fullscreen, same compact tile wrapped
- `canvas.json` — canvas layout + design-rationale notes
- `*.jpg` — placeholder imagery, see the caveat below

## The rule flipped, on purpose

The previous version of this widget searched a YouTube channel, and its
founding rule was stated here in absolute terms:

> The agent carries every word: which video, why, how long, what makes it
> different. The widget carries thumbnails and nothing else — no title, no
> date, no channel, no description, no frame, no surface.

That was right for video. A thumbnail is self-explanatory, the agent could
narrate around it, and any text drawn in the widget would have been a
worse duplicate of the sentence directly above it.

**It is wrong for commerce, and it has been reversed.** A purchase is not
self-explanatory. Someone about to spend money needs the product's name
and the buy affordance *at the point of the tap* — they will not scroll
back up to the model's prose to confirm what they're about to buy, and a
button labelled "Get it" is not something a sentence can substitute for.
So the card now carries photo, name, the creator's own line, who it's for,
and the button.

This is recorded at length because the old rule reads as a settled
principle. A later pass that finds text inside these cards should know it
is deliberate, and not "fix" them back into thumbnails.

What did not change: **the agent's sentence is still not drawn in any
artboard.** An artboard is a build spec, and anything drawn in one gets
built — putting host-rendered prose inside the component frame would
invite someone to implement it as widget text. The difference is that the
name, blurb and button now *must* be drawn, because they are the
component.

## The one-liner splits by density, on purpose

A single pick does **not** draw the creator's blurb — the model says it once,
in chat, in her voice. A list of four-to-six **does** draw a clamped one-liner
per row.

That looks inconsistent until you try the alternative: an agent narrating six
reasons in one reply is exactly the wall of text this interaction exists to
avoid, and six rows with no reason at all are just six names to re-research.
So the rule is about what can be *spoken* versus what has to be *scanned* —
one pick is spoken, several are scanned.

"How I use it" sits behind a `<details>` on the detail card either way: it's
detail someone wants only once they're already interested, so it costs
nothing until they ask for it.

## Two components, four containers

The old notes predicted the four `ViewMode`s would collapse into one
responsive strip once the widget was pure thumbnails. Cards pull the other
way — but only into **two** components, not four:

- **detail** (`card`, `spotlight`) — photo, name + brand, the creator's
  line, who it's for, price note, and a visible **Get it** button.
- **compact** (`carousel`, `grid`) — photo, name, price. The whole tile is
  the button.

`src/product-card.ts` implements exactly that: one
`renderProductCard(product, onOpen, detail)` and a single `IS_DETAIL`
lookup beside `CONTAINER_CLASS`. The four containers remain, because 1 /
2–3 / many / fullscreen genuinely want different arrangements — but they
arrange two components, not four.

## Carried decisions

**Duration is gone.** It was kept in the video design because it rode on
the image for free and the agent couldn't naturally recite six durations
in a sentence. There is no duration on a product. The price note takes its
slot, and unlike duration it is display-only — never checked against the
retailer, and the tool description tells the model not to state a price
the payload doesn't carry.

**Nesting is load-bearing.** Compact tiles are a `<button>` carrying
`aria-label="Get <name>"`. Detail cards are an `<article>` containing
exactly one `<button>`, and are deliberately *not* clickable as a whole —
a button inside a button is invalid and breaks keyboard traversal. Tabbing
through a detail card should stop exactly once.

**`contain`, not `cover`.** Product photography is usually a centred
object on white. The video widget cropped stills to fill a 16:9 frame;
doing that here cuts the product in half. `.pimg` contains the image on a
neutral ground instead.

## Caveat: the imagery is still wrong

The `*.jpg` files are 16:9 video stills carried over from the video-results
canvas, standing in for product shots. They are the wrong shape and the
wrong subject. Swap in real catalog photography before judging crop,
spacing, or how the contained image reads against the card ground.
