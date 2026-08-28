# Design canvas — video result layouts

Source files for the design canvas exploring the four result layouts
(card / spotlight / carousel / grid).

Published canvas:
https://claude.ai/code/artifact/e6c8ba7c-7e2a-4810-a85e-fcf6696c64e1

## Files

- `Main.dc.html` — Spotlight (2–3 matches), the flagship case
- `SingleCard.dc.html` — Card (one strong match)
- `Carousel.dc.html` — Carousel (skim many)
- `Grid.dc.html` — Grid (fullscreen browse)
- `canvas.json` — canvas layout + the design-rationale notes
- `*.jpg` — real `mqdefault` thumbnails from the channel, used as mockup
  content so the layouts are judged against real titles and framing

`doctor-video-results.html` (gitignored) is the seeded canvas — a build
artifact regenerated from the files above, not edited by hand.

## Design thesis

The assistant hands you options and gets out of the way. Every element
has to earn its place against one question: does this make the click
easier?

Removed deliberately: the in-widget search box (the chat is the search
box), the channel name on every card (every result is the same doctor —
said once instead of six times), card borders (thumbnails are the
content), and the "Watch on YouTube" button (the whole card is the tap
target; two affordances for one action is a hesitation).

Duration is promoted to a primary signal — real results run 0:24 next to
3:29 next to hour-long interviews, so "do I have time right now" is the
sharpest filter currently available.

## Reason slot

Each layout leaves a composed-in slot under the title for a one-line
"why this matched", with no re-layout needed to fill it. It is
deliberately empty: with only titles and search metadata available
today, any reason text would be invented confidence. It gets filled when
the system actually understands video contents.
