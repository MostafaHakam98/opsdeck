import { LogOut, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type NavigationGroup = {
  label: string;
  mobileHidden?: boolean;
  items: Array<{
    id: string;
    label: string;
    icon: LucideIcon;
    onClick: () => void;
    active?: boolean;
    count?: number;
    alert?: boolean;
  }>;
};

/** OpsDeck mark: a 3x3 slice of the pulse wall, cells shaded by load. */
const markCells = [0.35, 0.6, 1, 0.6, 1, 0.35, 1, 0.35, 0.6];

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 18 18" fill="currentColor">
        {markCells.map((opacity, index) => (
          <rect
            key={index}
            x={(index % 3) * 6.5}
            y={Math.floor(index / 3) * 6.5}
            width="5"
            height="5"
            rx="1.2"
            opacity={opacity}
          />
        ))}
      </svg>
    </span>
  );
}

export function AppSidebar({
  groups,
  caption,
  footer,
  onHome,
  onSignOut,
}: {
  groups: NavigationGroup[];
  caption: string;
  footer: ReactNode;
  onHome: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="sidebar">
      <a
        className="brand"
        href="#"
        aria-label="OpsDeck home"
        onClick={(event) => {
          event.preventDefault();
          onHome();
        }}
      >
        <BrandMark />
        <span className="brand-word">OpsDeck</span>
      </a>
      <div className="workspace-label">{caption}</div>
      <nav aria-label="Main navigation">
        {groups
          .filter((group) => group.items.length)
          .map((group) => (
            <div
              className={`nav-group${group.mobileHidden ? " nav-group-desktop-only" : ""}`}
              key={group.label}
            >
              <span className="nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  aria-label={item.label}
                  title={item.label}
                  type="button"
                  aria-current={item.active ? "page" : undefined}
                  className={item.active ? "active" : undefined}
                  onClick={item.onClick}
                >
                  <item.icon size={18} aria-hidden="true" />
                  <span className="nav-label">{item.label}</span>
                  {item.count !== undefined && (
                    <span
                      className={`nav-count${item.alert ? " nav-count-alert" : ""}`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
      </nav>
      <div className="sidebar-bottom">
        {footer}
        <button type="button" onClick={onSignOut}>
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
