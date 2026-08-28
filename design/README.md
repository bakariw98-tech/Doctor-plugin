# Design canvas — video result layouts

Source files for the design canvas exploring how video results render
inside a chat.

Published canvas:
https://claude.ai/code/artifact/e6c8ba7c-7e2a-4810-a85e-fcf6696c64e1

## Files

- `Main.dc.html` — One (a single thumbnail is the entire widget)
- `Few.dc.html` — Two or three, sized to fit
- `Carousel.dc.html` — Many, one fixed size, scrolls
- `Grid.dc.html` — Fullscreen, same tile wrapped
- `canvas.json` — canvas layout + design-rationale notes
- `*.jpg` — real `mqdefault` thumbnails from the channel, so layouts get
  judged against real titles and framing

`doctor-video-results.html` (gitignored) is the seeded canvas — a build
artifact regenerated from the files above, not edited by hand.

## The division of labor

The agent carries every word: which video, why, how long, what makes it
different. The widget carries thumbnails and nothing else — no title, no
date, no channel, no description, no frame, no surface.

This is a deliberate reversal of the first pass, which built restrained
*cards*. The direction is no card at all. Anything that reads as a text
label inside the widget belongs in the agent's sentence instead, where it
reads better and costs no chrome.

The prose on each artboard is real assistant phrasing, written as literal
markup so it can be retyped on the canvas to test other wordings.

## The view system probably collapses

With no text in the widget, `card` / `spotlight` / `carousel` / `grid`
stop being distinct components. They are one strip of thumbnails at
different sizes:

- 1 → full width
- 2–3 → split to fit
- 4+ → fixed 172px, scrolls
- fullscreen → same tile, wrapped

Worth settling before implementation: collapsing the four `ViewMode`s in
`src/view.ts` into one responsive component would delete a fair amount of
`src/carousel.ts`.

## Two carried decisions

**Duration stays.** It rides on the image rather than around it, so it
costs no layout, and the agent cannot naturally recite six durations in a
sentence. Removing it makes the widget literally just pictures.

**Titles are not drawn, but not deleted.** Each thumbnail carries its
title in `aria-label`, so screen readers announce the video rather than
"link, image". Visually absent, semantically present.

## Implementation notes this design implies

- The tool's text response currently returns a flat "Found N videos
  about X." For the model to write copy like the artboards show, the
  result needs per-video titles and durations to talk about.
- `src/youtube.ts` prefers `thumbnails.high`, which is YouTube's 480×360
  **letterboxed** image; `object-fit: cover` then crops into the black
  bars. `medium` (`mqdefault`) is natively 16:9 and is the correct pick.
