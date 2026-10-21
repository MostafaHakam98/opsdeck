import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useHotkey } from "../lib/useHotkey";
import "./overlays.css";

const EVENT = "opsdeck:shortcut-help";

/** Open the shortcut list from a button or menu. */
export function openShortcutHelp() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Keyboard shortcut reference; opens on "?" outside text fields. */
export function ShortcutHelp({
  shortcuts,
}: {
  shortcuts: Array<{ keys: string[]; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const titleId = useId();

  function show() {
    if (open) return;
    previous.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOpen(true);
  }
  function close() {
    setOpen(false);
    const target = previous.current;
    previous.current = null;
    if (target?.isConnected) target.focus();
  }

  useHotkey("?", (event) => {
    event.preventDefault();
    if (open) close();
    else show();
  });
  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  });
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="overlay-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="shortcut-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === "Tab") {
            event.preventDefault();
            closeButton.current?.focus();
          }
        }}
      >
        <div className="shortcut-help-heading">
          <h2 id={titleId}>Keyboard shortcuts</h2>
          <button
            ref={closeButton}
            type="button"
            className="icon-button"
            aria-label="Close keyboard shortcuts"
            onClick={close}
          >
            <X size={16} />
          </button>
        </div>
        <dl>
          {shortcuts.map((shortcut) => (
            <div key={`${shortcut.label}-${shortcut.keys.join("+")}`}>
              <dt>{shortcut.label}</dt>
              <dd>
                {shortcut.keys.map((key, index) => (
                  <Fragment key={`${key}-${index}`}>
                    {index > 0 && <span aria-hidden="true">+</span>}
                    <kbd>{key}</kbd>
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>,
    document.body,
  );
}
