# Workshop

Tooling for finding prospects and building demos for them.

**None of this ships.** Doctrine §12: onboarding and prospecting tooling
stays in the workshop and never goes into a deployed server. It's excluded
from the Vercel build (`.vercelignore`), nothing in `src/` or `api/`
imports it, and **this whole directory should be deleted when you fork the
repo for a real client** — along with the *Product doctrine* section of the
root README, which is internal too.

## The flow

```
find someone  ->  workshop/prospects/<slug>.json  ->  build-demo.mjs  ->  fixture  ->  video/screenshot  ->  outreach
```

## 1. Qualify them

Copy `prospects/_template.json` to `prospects/<slug>.json` and fill it in.
The fields are the ICP scorecard from doctrine §16–18, so filling the file
out *is* the qualification exercise — if you can't answer `authority.
peopleComeToThemFor` in one sentence, they're probably an influencer rather
than an authority, and they're the wrong prospect.

The question that matters most is **§18's**: not "who has the most
followers", but *"who is the person people go to when they want to get
better at this?"*

`status` moves: `researching` → `qualified` → `demo-built` → `contacted` →
`replied` → `client` (or `passed`).

## 2. Build the demo

Two modes, depending on whether they have a deployment yet.

**They don't** (the normal case). Add their real recommendations to the
`recommendations` array, mark the two or three you want on camera with
`"demo": true`, and give each a `blurb`, `imageUrl`, `buyUrl`, and
`promoCode` if they have one:

```bash
node workshop/build-demo.mjs <slug> --question "what pan should i start with"
```

It warns about any featured product missing a photo or blurb. Fill those
in before filming — grey boxes where the products should be is worse than
no demo.

**They do** (or you built one on spec, as with Miss Meat). Capture a real
response, so the demo can't drift from what actually ships:

```bash
node workshop/build-demo.mjs <slug> \
  --from-live https://their-deployment.vercel.app \
  --question "what do you use for seasoning"
```

It flags any capture that isn't a `strong` match — film a question the
catalog answers confidently, not one it hedges.

Output lands in `workshop/demos/<slug>/`.

## 3. Film it

The fixtures are directly loadable by the demo page's fixture mode. See
`fixtures/README.md` for the URL form, the Puppeteer/Remotion driving code,
and the `[data-fixture-ready="1"]` capture signal.

## Before you send anything

- Check the answer is actually good. A demo of a weak match sells nothing.
- Check the product photos. A merchant's marketing collage looks visibly
  worse next to a clean product shot.
- Find a real contact route. `identity.contact.route` should not say
  "unknown" by the time you hit send.
