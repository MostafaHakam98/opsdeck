/**
 * The one-line agent install command shown by the Enroll host walkthrough.
 * It downloads deploy/bootstrap-agent.sh from the public repository at the
 * commit this server runs, so the script cannot change after review. The
 * command carries no secret: the script asks for the credential with hidden
 * input, which keeps it out of shell history and process arguments.
 */
export type InstallMethod = "docker" | "native";

/** The public repository the server is built from (`git remote -v`). */
export const GITHUB_REPOSITORY = "MostafaHakam98/opsdeck";
export const BOOTSTRAP_PATH = "deploy/bootstrap-agent.sh";
/** Where the script checks out the agent; an existing workspace checkout is never moved. */
export const AGENT_DIRECTORY = "~/opsdeck-agent";
const FALLBACK_BRANCH = "devel";

/** The server's commit when it reports one, otherwise the integration branch. */
export function sourceRef(version?: string) {
  return version && /^[0-9a-f]{7,40}$/.test(version)
    ? version
    : FALLBACK_BRANCH;
}

export function bootstrapUrl(version?: string) {
  return `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${sourceRef(version)}/${BOOTSTRAP_PATH}`;
}

/** The script's link on GitHub, for reading it before running it. */
export function bootstrapSourceUrl(version?: string) {
  return `https://github.com/${GITHUB_REPOSITORY}/blob/${sourceRef(version)}/${BOOTSTRAP_PATH}`;
}

/** Only an HTTP(S) origin can reach the command line; anything else is refused. */
function shellOrigin(origin: string) {
  if (
    !/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$|^http:\/\/\[::1\](:\d{1,5})?$/.test(
      origin,
    )
  )
    throw new Error(`Unexpected server origin: ${origin}`);
  return origin;
}

export function installCommand({
  method,
  origin,
  version,
}: {
  method: InstallMethod;
  origin: string;
  version?: string;
}) {
  const ref = sourceRef(version);
  const checkout = ref === FALLBACK_BRANCH ? `origin/${FALLBACK_BRANCH}` : ref;
  return [
    `curl -fsSL ${bootstrapUrl(version)} \\`,
    `  | bash -s -- --server ${shellOrigin(origin)} --method ${method} --ref ${checkout}`,
  ].join("\n");
}
