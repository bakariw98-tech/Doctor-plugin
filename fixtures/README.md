# Fixtures

Sample payloads for the demo page's fixture mode: the real widget rendered
from data handed straight in, with no catalog, no MCP host and no
`/api/recommend` behind it. This is what the outbound demo videos are shot
from — a prospect's own products, in the widget that ships, before anything
of theirs exists in a database.

A fixture is exactly the object `/api/recommend` returns, so you can also
capture a live one from any deployment
(`curl '<origin>/api/recommend?q=what+grinder+do+you+use'`) and replay it here
unchanged. Both paths land on the same `renderProducts()` call, which is the
point: nothing in a demo video can drift away from the shipping card.

| file | view | what it covers |
| --- | --- | --- |
| `espresso-grinder-card.json` | `card` | one pick — photo, price, promo code, collapsed "How I use it" |
| `pour-over-spotlight.json` | `spotlight` | three picks side by side |
| `starter-kit-list.json` | `list` | four picks as scannable rows, each with its own one-liner |

## Shape

```json
{
  "question": "what grinder do you use for espresso",
  "view": "card",
  "matchQuality": "strong",
  "products": [ /* ProductPick[] — see src/product-card.ts */ ]
}
```

`view` is one of `card` | `spotlight` | `list` | `grid`. `question` and
`matchQuality` are carried so a fixture stays the same object the API
returns; they only feed the status line, which fixture mode hides.

## Driving it by URL

Encode the JSON as base64url:

```sh
node -p 'require("fs").readFileSync("fixtures/espresso-grinder-card.json").toString("base64url")'
# or: base64 -w0 fixtures/espresso-grinder-card.json | tr '+/' '-_' | tr -d '='
```

Then open:

```
https://<deployment>/?fixture=<base64url>
```

Locally: `npm run build && PORT=3141 npm run serve`, then
`http://localhost:3141/?fixture=<base64url>`. The demo page is a build
artifact (`public/index.html`), so rebuild after touching `src/demo.ts`.

## Driving it from Remotion / Puppeteer

Once photos are inlined as base64 the payload runs to megabytes, far past
what a URL can carry, so hand the object over directly instead:

```js
await page.goto("https://<deployment>/");
await page.evaluate((p) => window.setFixture(p), payload); // resolves when ready
await page.waitForSelector('[data-fixture-ready="1"]');    // or poll, if you'd rather
const png = await (await page.$("#root")).screenshot();
```

`setFixture()` returns the same promise the readiness flag reflects, so
awaiting the `evaluate` is usually enough on its own.

## Readiness

Capture only once `document.documentElement` carries
`data-fixture-ready="1"` — selector `[data-fixture-ready="1"]`. It is set
after every `<img>` in the widget has finished decoding, which is the
difference between a shot of the card and a shot of it with half-loaded
product photos.

Two things worth knowing:

- A dead `imageUrl` still counts as settled, so the flag appears with an
  empty photo frame rather than hanging the render forever. A card that
  looks wrong is a bad URL, not a stuck job.
- The flag is cleared at the start of every `setFixture()` call, so one page
  load can shoot several fixtures — just wait for it to come back between
  shots.

## Notes

- Fixture mode hides the demo's search form, view dropdown and status line.
  The page's own heading and footer stay: they belong to the demo page, not
  the widget, so screenshot the `#root` element rather than the viewport.
- `grid` also widens the page container — that layout is the widget's
  fullscreen mode, and this page has no host to actually go fullscreen in.
- These samples inline their photos as `data:` SVGs so a render never
  depends on the network. Any URL the browser can load works, including the
  https product images in a captured response.
- `buyUrl` is never followed during a capture; a card only calls
  `window.open` when someone clicks it.
