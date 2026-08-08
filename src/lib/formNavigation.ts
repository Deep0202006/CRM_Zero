const SINGLE_LINE_TYPES = new Set(["text", "email", "tel", "number", "password", "search", "date"]);
const CONTROL_SELECTOR = "input, select, textarea, [contenteditable='true'], [role='combobox']";

export function isEligibleFormControl(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.dataset.enterNavigation === "native") return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (element.matches(":disabled") || element.hasAttribute("readonly")) return false;
  if (element instanceof HTMLInputElement) {
    if (!SINGLE_LINE_TYPES.has(element.type)) return false;
  } else if (!(element instanceof HTMLSelectElement) && !(element instanceof HTMLTextAreaElement) && element.getAttribute("role") !== "combobox") {
    return false;
  }
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && !element.closest("[hidden], [aria-hidden='true']") && element.getClientRects().length > 0;
}

export function eligibleFormControls(current: HTMLElement): HTMLElement[] {
  const scope = current.closest("form") ?? document.getElementById("main-content") ?? document.body;
  return Array.from(scope.querySelectorAll(CONTROL_SELECTOR)).filter(isEligibleFormControl);
}

export function focusNextEligibleControl(current: HTMLElement): boolean {
  const controls = eligibleFormControls(current);
  const index = controls.indexOf(current);
  const next = index >= 0 ? controls[index + 1] : undefined;
  if (!next) return false;
  next.focus({ preventScroll: true });
  next.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  return true;
}

export function updateEnterKeyHints(root: ParentNode = document): void {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("input, [role='combobox']"));
  for (const control of candidates) {
    if (!isEligibleFormControl(control)) continue;
    const controls = eligibleFormControls(control);
    const hasNext = controls.indexOf(control) < controls.length - 1;
    control.setAttribute("enterkeyhint", hasNext ? "next" : "done");
  }
}

export function handleFormNavigationKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target instanceof HTMLTextAreaElement || !isEligibleFormControl(target)) return;
  event.preventDefault();
  focusNextEligibleControl(target);
}
