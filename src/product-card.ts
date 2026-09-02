// src/product-card.ts
// The rendering shared by the chat widget (src/mcp-app.ts) and the browser
// demo page (src/demo.ts), so what you see in the preview is what renders
// in chat. Pure DOM into a container, with the "open this" behavior
// injected as a callback — neither caller's navigation primitive
// (app.openLink vs window.open) leaks in here.
//
// Note the reversal from this widget's previous life as a video result
// strip, where the rule was "thumbnails and nothing else — the agent
// carries every word." A video thumbnail is self-explanatory and the
// model's sentence could carry the rest. A purchase can't work that way:
// someone about to spend money needs the product's name and the buy
// affordance at the point of the tap, not scrolled up in a paragraph, and
// no sentence substitutes for a button. See design/README.md.
//
// What the card does NOT carry: the creator's who-it's-for line, and — on a
// single pick — the blurb. Those are prose, and prose belongs in the agent's
// reply rather than printed a second time in the widget; the model already
// receives them in the tool's text content (buildResultText,
// src/mcp-server.ts) and is instructed to speak them.
//
// The one deliberate exception is the LIST density. Four to six results
// can't have their reasons narrated in a short chat reply without becoming
// the wall of text this whole interaction exists to avoid, so each list row
// draws its own clamped one-liner. One pick: the model says it. Six picks:
// the rows say it.
//
// "How I use it" is different from both — it's detail someone wants only
// after they're already interested, so it ships collapsed behind a
// <details> rather than spent on everyone up front.
//
// The one thing here that isn't about the product is the affiliate
// disclosure. Every Get it is a paid link, so it has to be said; it's drawn
// once under the whole set rather than on each card, because what's asked
// for is that it be clear and next to the recommendation — three identical
// sentences under three tiles is just chrome people learn to skip.

import { creator } from "./creator.js";
import type { ViewMode } from "./view.js";

/** What the server sends per product. Mirrors WirePick in src/recommend.ts. */
export interface ProductPick {
  id: number;
  name: string;
  imageUrl: string | null;
  priceNote: string | null;
  promoCode: string | null;
  /** Drawn only in the list density — see renderProductCard. */
  blurb: string;
  /** Drawn as the detail card's collapsed "how I use it", when present. */
  usage: string | null;
  /** Already a tracked /r/<id> redirect by the time it reaches here. */
  buyUrl: string;
}

export function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// Shown when a product has no photo. A neutral mark rather than a
// stand-in product image — inventing a picture of something someone is
// about to buy is worse than admitting there isn't one.
const NO_IMAGE = `
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
       stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" />
  </svg>`;

function imageMarkup(product: ProductPick): string {
  return product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" />`
    : `<span class="pcard-noimg">${NO_IMAGE}</span>`;
}

function priceMarkup(product: ProductPick): string {
  return product.priceNote ? `<span class="pcard-price">${escapeHtml(product.priceNote)}</span>` : "";
}

function promoMarkup(product: ProductPick): string {
  return product.promoCode
    ? `<span class="pcard-promo">Code&nbsp;${escapeHtml(product.promoCode)}</span>`
    : "";
}

// Native <details> on purpose: no JS, no state to keep in sync, and it stays
// keyboard-operable inside the host's sandboxed iframe where a hand-rolled
// toggle would be one more thing to get wrong.
function usageMarkup(product: ProductPick): string {
  return product.usage
    ? `<details class="pcard-usage">
        <summary>How I use it</summary>
        <p>${escapeHtml(product.usage)}</p>
      </details>`
    : "";
}

/**
 * One product, at one of three densities (see the file header for what each
 * does and does not carry).
 *
 * - `detail` (card/spotlight): photo, name, price, promo, a Get it button,
 *   and the collapsed "how she uses it". NOT clickable as a whole — it's an
 *   <article> containing exactly one button, because a button inside a
 *   button is invalid and breaks keyboard traversal.
 * - `list`: a horizontal row — small thumb, name, clamped one-liner, price
 *   and promo. The whole row is the button.
 * - `compact` (grid/fullscreen): photo, name, price, promo. The whole tile
 *   is the button.
 */
export function renderProductCard(
  product: ProductPick,
  onOpen: (url: string) => void,
  density: "detail" | "list" | "compact",
): HTMLElement {
  if (density === "list") {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "pcard pcard-row";
    row.setAttribute("aria-label", `Get ${product.name}`);
    row.innerHTML = `
      <span class="pcard-img">${imageMarkup(product)}</span>
      <span class="pcard-body">
        <span class="pcard-name">${escapeHtml(product.name)}</span>
        ${product.blurb ? `<span class="pcard-line">${escapeHtml(product.blurb)}</span>` : ""}
        <span class="pcard-meta">${priceMarkup(product)}${promoMarkup(product)}</span>
      </span>
      <span class="pcard-go" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round"><path d="M7 13 13 7M8 7h5v5"/></svg>
      </span>`;
    row.addEventListener("click", () => onOpen(product.buyUrl));
    return row;
  }

  if (density === "compact") {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pcard pcard-compact";
    tile.setAttribute("aria-label", `Get ${product.name}`);
    tile.innerHTML = `
      <span class="pcard-img">${imageMarkup(product)}</span>
      <span class="pcard-body">
        <span class="pcard-name">${escapeHtml(product.name)}</span>
        ${priceMarkup(product)}
        ${promoMarkup(product)}
      </span>`;
    tile.addEventListener("click", () => onOpen(product.buyUrl));
    return tile;
  }

  const card = document.createElement("article");
  card.className = "pcard pcard-detail";
  card.innerHTML = `
    <div class="pcard-img">${imageMarkup(product)}</div>
    <div class="pcard-body">
      <h2 class="pcard-name">${escapeHtml(product.name)}</h2>
      <div class="pcard-actions">
        <button type="button" class="pcard-buy">Get it</button>
        ${priceMarkup(product)}
        ${promoMarkup(product)}
      </div>
      ${usageMarkup(product)}
    </div>`;
  card.querySelector<HTMLButtonElement>(".pcard-buy")!
    .addEventListener("click", () => onOpen(product.buyUrl));
  return card;
}

const CONTAINER_CLASS: Record<ViewMode, string> = {
  card: "view-solo",
  spotlight: "view-split",
  list: "view-list",
  grid: "view-wall",
};

// Which layout gets which density. Three components in four containers —
// card and spotlight are the same component at different widths.
const DENSITY: Record<ViewMode, "detail" | "list" | "compact"> = {
  card: "detail",
  spotlight: "detail",
  list: "list",
  grid: "compact",
};

/**
 * Renders `products` into `root` in the given view — a container shaped for
 * the count (solo / split-to-fit / vertical stack / wrapping wall).
 * `onOpen(url)` fires when someone taps through to buy.
 */
export function renderProducts(
  root: HTMLElement,
  products: ProductPick[],
  view: ViewMode,
  onOpen: (url: string) => void,
) {
  root.innerHTML = "";

  if (products.length === 0) {
    root.innerHTML = `<p class="empty">Nothing to recommend yet.</p>`;
    return;
  }

  // Set here rather than written into the two stylesheets, which can't read
  // src/creator.ts. Only when a creator actually configured one: the
  // built-in accent is a light/dark pair, and one hex overwriting both
  // would put a colour picked for white onto a dark ground.
  if (creator.accent) {
    document.documentElement.style.setProperty("--accent", creator.accent);
  }

  const container = document.createElement("div");
  container.className = CONTAINER_CLASS[view] ?? CONTAINER_CLASS.list;
  const density = DENSITY[view] ?? "list";
  for (const product of products) {
    container.appendChild(renderProductCard(product, onOpen, density));
  }

  root.appendChild(container);

  const disclosure = document.createElement("p");
  disclosure.className = "pcard-disclosure";
  disclosure.textContent = creator.disclosure;
  root.appendChild(disclosure);
}
