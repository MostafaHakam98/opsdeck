import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api, uploadArchive } from "./api";

type FleetHost = { id: string; name: string };
const HostApiContext = createContext<{ prefix: string; hosts: FleetHost[] }>({
  prefix: "",
  hosts: [],
});
export function HostApiProvider({
  prefix,
  children,
  hosts = [],
}: {
  prefix: string;
  children: ReactNode;
  hosts?: FleetHost[];
}) {
  return (
    <HostApiContext.Provider value={{ prefix, hosts }}>
      {children}
    </HostApiContext.Provider>
  );
}
export function useHostApi() {
  const { prefix, hosts } = useContext(HostApiContext);
  return useMemo(
    () => ({
      fleet: {
        node: /^fleet\/nodes\/([^/]+)\/workspace\/$/.exec(prefix)?.[1] || "",
        hosts,
      },
      api: ((path, token, body, signal) =>
        api(`${prefix}${path}`, token, body, signal)) as typeof api,
      uploadArchive: ((file, token, kind, progress, signal) =>
        uploadArchive(
          file,
          token,
          kind,
          progress,
          signal,
          prefix,
        )) as typeof uploadArchive,
    }),
    [prefix, hosts],
  );
}
