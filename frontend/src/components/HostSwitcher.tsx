import { Server } from "lucide-react";
import "./host-switcher.css";

type Host = {
  id: string;
  name: string;
  cluster: string;
  hostname?: string | null;
  status?: string;
};

export function HostSwitcher({
  hosts,
  value,
  onChange,
  allLabel = "All hosts",
  allDisabled = false,
  loading = false,
}: {
  hosts: Host[];
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  allDisabled?: boolean;
  loading?: boolean;
}) {
  const clusters = [...new Set(hosts.map((host) => host.cluster))].sort(
    (a, b) => a.localeCompare(b),
  );
  return (
    <label className="host-switcher">
      <Server size={16} aria-hidden="true" />
      <select
        aria-label="Switch host"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        title="Choose a host or open the fleet overview"
      >
        <option value="" disabled={allDisabled}>
          {allLabel}
        </option>
        {value && !hosts.some((host) => host.id === value) && (
          <option value={value} disabled>
            {loading ? "Loading selected host..." : "Host unavailable"}
          </option>
        )}
        {clusters.map((cluster) => (
          <optgroup key={cluster} label={cluster}>
            {hosts
              .filter((host) => host.cluster === cluster)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((host) => (
                <option key={host.id} value={host.id}>
                  {host.name}
                  {host.hostname && host.hostname !== host.name
                    ? ` (${host.hostname})`
                    : ""}
                  {host.status ? ` · ${host.status}` : ""}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
