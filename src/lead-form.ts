// src/lead-form.ts
// Renders the lead-capture form shown by offer_lead_magnet, and handles
// its submit/success/error states. Pure DOM rendering into a container —
// same shape as src/carousel.ts's renderVideos, so the two swap in and
// out of the widget's single #root the same way.

export interface LeadFormQuestion {
  fieldKey: string;
  label: string;
  required: boolean;
}

export interface LeadFormPayload {
  kind: "lead_form";
  topic: string;
  magnet: { title: string; description: string; coverImageUrl?: string | null; resourceUrl: string };
  questions: LeadFormQuestion[];
}

const COVER_ICON = `
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3L4 7v6c0 4.4 3.4 8.4 8 9.9 4.6-1.5 8-5.5 8-9.9V7l-8-4z"
      stroke="#fff" stroke-width="1.6" stroke-linejoin="round" fill="rgba(255,255,255,0.14)" />
    <path d="M9 12.2l2.1 2.1L15.4 10" stroke="#fff" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

export interface SubmitResult {
  ok: boolean;
  error?: string;
}

export function escapeHtml(input: string): string {
  const div = document.createElement("div");
  div.textContent = input;
  return div.innerHTML;
}

/**
 * Renders the form into `root`. `onSubmit` and `onDownload` are plain
 * callbacks — neither should know anything about the App bridge itself
 * (mcp-app.ts wires app.callServerTool / app.downloadFile into them),
 * matching how carousel.ts's onOpenExternal keeps app.openLink out of the
 * pure-render file. `onDownload` fires once automatically right after a
 * successful submit, and again on demand if the person taps the button
 * (the host's own download prompt can be dismissed or blocked, so this
 * needs to be re-triggerable, not a one-shot).
 */
export function renderLeadForm(
  root: HTMLElement,
  payload: LeadFormPayload,
  onSubmit: (data: { email: string; name: string; answers: Record<string, string> }) => Promise<SubmitResult>,
  onDownload: () => void,
) {
  root.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "lead-form";

  const questionFields = payload.questions
    .map(
      (q) => `
        <label class="lead-field">
          <span>${escapeHtml(q.label)}${q.required ? " *" : ""}</span>
          <input type="text" data-field="${escapeHtml(q.fieldKey)}" ${q.required ? "required" : ""} />
        </label>
      `,
    )
    .join("");

  const cover = payload.magnet.coverImageUrl
    ? `<div class="lead-cover"><img src="${escapeHtml(payload.magnet.coverImageUrl)}" alt="" /></div>`
    : `<div class="lead-cover lead-cover-fallback">${COVER_ICON}</div>`;

  wrap.innerHTML = `
    ${cover}
    <div class="lead-body">
    <h2 class="lead-title">${escapeHtml(payload.magnet.title)}</h2>
    <p class="lead-desc">${escapeHtml(payload.magnet.description)}</p>
    <form class="lead-fields" novalidate>
      <label class="lead-field">
        <span>Email *</span>
        <input type="email" name="email" required />
      </label>
      <label class="lead-field">
        <span>Name</span>
        <input type="text" name="name" />
      </label>
      ${questionFields}
      <p class="lead-error" hidden></p>
      <button type="submit" class="lead-submit">Get it now</button>
    </form>
    </div>
  `;
  root.appendChild(wrap);

  const form = wrap.querySelector("form") as HTMLFormElement;
  const submitBtn = wrap.querySelector(".lead-submit") as HTMLButtonElement;
  const errorEl = wrap.querySelector(".lead-error") as HTMLElement;
  const emailInput = form.querySelector('input[name="email"]') as HTMLInputElement;
  const nameInput = form.querySelector('input[name="name"]') as HTMLInputElement;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const answers: Record<string, string> = {};
    for (const el of Array.from(form.querySelectorAll("[data-field]")) as HTMLInputElement[]) {
      const key = el.dataset.field;
      if (key && el.value) answers[key] = el.value;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    const result = await onSubmit({ email: emailInput.value, name: nameInput.value, answers });

    if (result.ok) {
      wrap.innerHTML = `
        ${cover}
        <div class="lead-body">
          <p class="lead-success">✓ You're in — your download should start automatically.</p>
          <button type="button" class="lead-submit lead-download-again">Download again</button>
        </div>
      `;
      onDownload();
      wrap.querySelector(".lead-download-again")?.addEventListener("click", () => onDownload());
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send it to me";
      errorEl.textContent = result.error || "Something went wrong — try again.";
      errorEl.hidden = false;
    }
  });
}
