import { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type Theme = "system" | "light" | "dark";
const key = "opsdeck.theme";

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(key);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let fade: ReturnType<typeof setTimeout> | undefined;

/**
 * "system" removes the attribute so the prefers-color-scheme rules apply.
 * `animate` cross-fades the change (see motion.css); the first paint never does.
 */
export function applyTheme(theme: Theme, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    clearTimeout(fade);
    fade = setTimeout(() => root.classList.remove("theme-switching"), 300);
  }
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

const options = [
  { value: "system", label: "Match system theme", icon: Monitor },
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
] as const;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const shown = useRef(theme);
  useEffect(() => {
    applyTheme(theme, theme !== shown.current);
    shown.current = theme;
    try {
      if (theme === "system") localStorage.removeItem(key);
      else localStorage.setItem(key, theme);
    } catch {
      // Storage can be blocked; the choice still applies to this page.
    }
  }, [theme]);
  return (
    <div
      className="theme-toggle"
      role="radiogroup"
      aria-label="Color theme"
      onKeyDown={(event) => {
        const step = {
          ArrowRight: 1,
          ArrowDown: 1,
          ArrowLeft: -1,
          ArrowUp: -1,
        }[event.key];
        if (!step) return;
        event.preventDefault();
        const index = options.findIndex((option) => option.value === theme);
        const next = (index + step + options.length) % options.length;
        setTheme(options[next].value);
        const buttons =
          event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
        buttons[next]?.focus();
      }}
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          tabIndex={theme === value ? 0 : -1}
          className={theme === value ? "active" : ""}
          onClick={() => setTheme(value)}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
