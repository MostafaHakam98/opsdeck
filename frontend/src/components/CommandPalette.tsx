import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { useHotkey } from "../lib/useHotkey";
import "./overlays.css";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon?: LucideIcon;
  keywords?: string;
  run: () => void;
};

const EVENT = "opsdeck:command-palette";

/** Open the palette from anywhere, for example a topbar button. */
export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

/**
 * Score `query` as an in-order subsequence of `text`. Returns null when some
 * character is missing. Consecutive characters and word starts score higher;
 * gaps cost a little, so tighter matches sort first.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const index = t.indexOf(char, from);
    if (index < 0) return null;
    score += 1;
    if (index === previous + 1) score += 5;
    if (index === 0 || !/[a-z0-9]/.test(t[index - 1])) score += 8;
    if (previous >= 0) score -= Math.min(3, (index - previous - 1) * 0.1);
    previous = index;
    from = index + 1;
  }
  return score;
}

/**
 * Match a command against the query over its label, keywords and group.
 * Label matches (and label prefixes most of all) outrank keyword-only hits.
 */
export function matchCommand(
  query: string,
  command: Pick<Command, "label" | "keywords" | "group">,
): number | null {
  const q = query.trim();
  if (!q) return 0;
  const label = fuzzyScore(q, command.label);
  const all = fuzzyScore(
    q,
    `${command.label} ${command.keywords || ""} ${command.group}`,
  );
  if (label === null && all === null) return null;
  let score = Math.max(label === null ? -Infinity : label + 10, all ?? 0);
  if (command.label.toLowerCase().startsWith(q.toLowerCase())) score += 20;
  return score;
}

/** Filter and rank, then group; group order follows each group's best hit. */
export function rankCommands<T extends Command>(commands: T[], query: string) {
  const ranked = commands
    .map((command, order) => ({
      command,
      order,
      score: matchCommand(query, command),
    }))
    .filter(
      (row): row is { command: T; order: number; score: number } =>
        row.score !== null,
    )
    .sort((a, b) => b.score - a.score || a.order - b.order);
  const groups = new Map<string, T[]>();
  for (const { command } of ranked) {
    const list = groups.get(command.group) || [];
    list.push(command);
    groups.set(command.group, list);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const base = useId();
  const listId = `${base}-list`;

  function show() {
    if (open) return;
    previous.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setQuery("");
    setActive(0);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    const target = previous.current;
    previous.current = null;
    if (target?.isConnected) target.focus();
  }

  useHotkey(
    "k",
    (event) => {
      event.preventDefault();
      if (open) close();
      else show();
    },
    { meta: true, allowInInputs: true },
  );
  useHotkey("/", (event) => {
    if (open) return;
    event.preventDefault();
    show();
  });
  useEffect(() => {
    const onOpen = () => show();
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  });
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const groups = useMemo(
    () => rankCommands(commands, query),
    [commands, query],
  );
  const flat = groups.flatMap((group) => group.items);
  const current = Math.min(active, Math.max(0, flat.length - 1));
  const optionId = (index: number) => `${base}-option-${index}`;
  const activeId = flat.length ? optionId(current) : undefined;

  useEffect(() => {
    if (!open || !activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeId]);

  if (!open) return null;

  function run(command: Command | undefined) {
    if (!command) return;
    close();
    command.run();
  }

  let index = -1;
  return createPortal(
    <div
      className="overlay-backdrop palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (event.key === "Tab") {
            // The search field is the only stop; keep focus inside the dialog.
            event.preventDefault();
            input.current?.focus();
          }
        }}
      >
        <div className="palette-search">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search hosts, pages and actions"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (!flat.length) return;
                const step = event.key === "ArrowDown" ? 1 : -1;
                setActive((current + step + flat.length) % flat.length);
              } else if (event.key === "Home" && flat.length) {
                event.preventDefault();
                setActive(0);
              } else if (event.key === "End" && flat.length) {
                event.preventDefault();
                setActive(flat.length - 1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(flat[current]);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div
          id={listId}
          className="palette-list"
          role="listbox"
          aria-label="Commands"
        >
          {groups.map(({ group, items }, groupIndex) => (
            <div
              key={group}
              role="group"
              aria-labelledby={`${base}-group-${groupIndex}`}
              className="palette-group"
            >
              <div
                className="palette-group-label"
                id={`${base}-group-${groupIndex}`}
                role="presentation"
              >
                {group}
              </div>
              {items.map((command) => {
                index += 1;
                const position = index;
                const Icon = command.icon;
                return (
                  <div
                    key={command.id}
                    id={optionId(position)}
                    role="option"
                    aria-selected={position === current}
                    className={`palette-option${position === current ? " active" : ""}`}
                    onMouseMove={() => {
                      if (position !== current) setActive(position);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => run(command)}
                  >
                    {Icon ? (
                      <Icon size={16} aria-hidden="true" />
                    ) : (
                      <span className="palette-icon" aria-hidden="true" />
                    )}
                    <span className="palette-label">{command.label}</span>
                    {command.hint && (
                      <span className="palette-hint">{command.hint}</span>
                    )}
                    {position === current && (
                      <CornerDownLeft
                        className="palette-enter"
                        size={14}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {!flat.length && (
          <p className="palette-empty" role="status">
            No commands match "{query.trim()}". Try a host name, page or action.
          </p>
        )}
        <div className="palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Move
          </span>
          <span>
            <kbd>Enter</kbd> Run
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
