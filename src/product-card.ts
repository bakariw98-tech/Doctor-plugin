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

import type { ViewMode } from "./view.js";

/** What the server sends per product. Mirrors WirePick in mcp-server.ts. */
export interface ProductPick {
  id: number;
  name: string;
  brand: string | null;
  category: string | null;
  /** The creator's own words. Rendered as theirs — never paraphrased. */
  blurb: string;
  audience: string | null;
  imageUrl: string | null;
  priceNote: string | null;
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

/**
 * One product, at one of two densities.
 *
 * `detail` (the card/spotlight layouts) draws the full pick: photo, name,
 * the creator's line, who it's for, and a Get it button. The card itself
 * is NOT clickable — it's an <article> containing exactly one button,
 * because a button inside a button is invalid and breaks keyboard
 * traversal.
 *
 * Compact (carousel/grid) has no room for prose, so the whole tile becomes
 * the button and the copy drops away to photo + name + price.
 */
export function renderProductCard(
  product: ProductPick,
  onOpen: (url: string) => void,
  detail: boolean,
): HTMLElement {
  if (!detail) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "pcard pcard-compact";
    tile.setAttribute("aria-label", `Get ${product.name}`);
    tile.innerHTML = `
      <span class="pcard-img">${imageMarkup(product)}</span>
      <span class="pcard-body">
        <span class="pcard-name">${escapeHtml(product.name)}</span>
        ${priceMarkup(product)}
      </span>`;
    tile.addEventListener("click", () => onOpen(product.buyUrl));
    return tile;
  }

  const card = document.createElement("article");
  card.className = "pcard pcard-detail";
  card.innerHTML = `
    <div class="pcard-img">${imageMarkup(product)}</div>
    <div class="pcard-body">
      ${product.brand ? `<p class="pcard-brand">${escapeHtml(product.brand)}</p>` : ""}
      <h2 class="pcard-name">${escapeHtml(product.name)}</h2>
      ${product.blurb ? `<p class="pcard-blurb">${escapeHtml(product.blurb)}</p>` : ""}
      ${product.audience ? `<p class="pcard-for">${escapeHtml(product.audience)}</p>` : ""}
      <div class="pcard-actions">
        <button type="button" class="pcard-buy">Get it</button>
        ${priceMarkup(product)}
      </div>
    </div>`;
  card.querySelector<HTMLButtonElement>(".pcard-buy")!
    .addEventListener("click", () => onOpen(product.buyUrl));
  return card;
}

const CONTAINER_CLASS: Record<ViewMode, string> = {
  card: "view-solo",
  spotlight: "view-split",
  carousel: "view-strip",
  grid: "view-wall",
};

// Which layouts get the full pick vs. the compact tile. This is the only
// real difference between the four views — they are two components in four
// containers, not four components.
const IS_DETAIL: Record<ViewMode, boolean> = {
  card: true,
  spotlight: true,
  carousel: false,
  grid: false,
};

/**
 * Renders `products` into `root` in the given view — a container shaped
 * for the count (solo / split-to-fit / scrolling strip / wrapping wall).
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

  const container = document.createElement("div");
  container.className = CONTAINER_CLASS[view] ?? CONTAINER_CLASS.carousel;
  const detail = IS_DETAIL[view] ?? false;
  for (const product of products) {
    container.appendChild(renderProductCard(product, onOpen, detail));
  }

  // The carousel's own scrollbar is hidden (mcp-app.html) for a cleaner
  // look, which means nothing on screen otherwise shows there's more to
  // scroll to — a small floating "swipe for more" chip fills that gap.
  // Only for 'carousel': 'grid' scrolls vertically inside a normal page,
  // which needs no special affordance the way a hidden horizontal
  // scrollbar does.
  if (view === "carousel") {
    const wrapper = document.createElement("div");
    wrapper.className = "shots-wrapper";
    wrapper.appendChild(container);

    const hint = document.createElement("div");
    hint.className = "scroll-hint";
    hint.setAttribute("aria-hidden", "true");
    hint.innerHTML = `<span class="scroll-hint-chip">Swipe for more ›</span>`;
    wrapper.appendChild(hint);
    root.appendChild(wrapper);

    const updateHint = () => {
      const scrollable = container.scrollWidth > container.clientWidth + 4;
      const atEnd = container.scrollLeft + container.clientWidth >= container.scrollWidth - 4;
      hint.classList.toggle("visible", scrollable && !atEnd);
    };
    container.addEventListener("scroll", updateHint, { passive: true });
    // Images are still loading right after this runs, which can change
    // scrollWidth — check now and shortly after so the hint doesn't flash
    // on/off once they settle.
    updateHint();
    requestAnimationFrame(updateHint);
    setTimeout(updateHint, 300);
    return;
  }

  root.appendChild(container);
}
