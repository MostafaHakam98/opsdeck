import { Gauge, LogOut, type LucideIcon } from "lucide-react";
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
        <Gauge size={28} />
        <span>OpsDeck</span>
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
                  aria-current={item.active ? "page" : undefined}
                  className={item.active ? "active" : undefined}
                  onClick={item.onClick}
                >
                  <item.icon size={18} />
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
        <button onClick={onSignOut}>
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
