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
  magnet: { title: string; description: string };
  questions: LeadFormQuestion[];
}

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
 * Renders the form into `root`. `onSubmit` is a plain callback — it
 * shouldn't know anything about the App bridge itself (mcp-app.ts wires
 * app.callServerTool into it), matching how carousel.ts's
 * onOpenExternal keeps app.openLink out of the pure-render file.
 */
export function renderLeadForm(
  root: HTMLElement,
  payload: LeadFormPayload,
  onSubmit: (data: { email: string; name: string; answers: Record<string, string> }) => Promise<SubmitResult>,
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

  wrap.innerHTML = `
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
      <button type="submit" class="lead-submit">Send it to me</button>
    </form>
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
        <p class="lead-success">Thanks — check your email for "${escapeHtml(payload.magnet.title)}".</p>
      `;
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send it to me";
      errorEl.textContent = result.error || "Something went wrong — try again.";
      errorEl.hidden = false;
    }
  });
}
