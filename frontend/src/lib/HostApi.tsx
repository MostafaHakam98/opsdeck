import { createContext, useContext, useMemo, type ReactNode } from "react";
import { api, uploadArchive } from "./api";

const HostApiContext = createContext("");
export function HostApiProvider({
  prefix,
  children,
}: {
  prefix: string;
  children: ReactNode;
}) {
  return (
    <HostApiContext.Provider value={prefix}>{children}</HostApiContext.Provider>
  );
}
export function useHostApi() {
  const prefix = useContext(HostApiContext);
  return useMemo(
    () => ({
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
    [prefix],
  );
}
