import { useEffect, useRef } from "react";

/** True when a key press is meant for a text field rather than a shortcut. */
export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (target as HTMLInputElement).type;
  return ![
    "button",
    "checkbox",
    "radio",
    "range",
    "reset",
    "submit",
    "color",
    "file",
  ].includes(type);
}

/**
 * Bind a global keyboard shortcut for the lifetime of the component.
 * `meta` requires Ctrl (or Cmd on macOS); otherwise Ctrl, Cmd and Alt must be
 * up so browser shortcuts keep working. Shortcuts are ignored while typing in a
 * field unless `allowInInputs` is set.
 */
export function useHotkey(
  key: string,
  handler: (e: KeyboardEvent) => void,
  options?: { meta?: boolean; allowInInputs?: boolean },
) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const meta = Boolean(options?.meta);
  const allowInInputs = Boolean(options?.allowInInputs);
  useEffect(() => {
    const wanted = key.toLowerCase();
    function onKeyDown(event: KeyboardEvent) {
      // Held keys auto-repeat; one press runs the shortcut once.
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (event.key?.toLowerCase() !== wanted) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (meta ? !modifier : modifier || event.altKey) return;
      if (!allowInInputs && isEditableTarget(event.target)) return;
      latest.current(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, meta, allowInInputs]);
}
