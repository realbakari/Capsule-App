/** Remote command output can echo credential-bearing URLs. Publish advice, not raw output. */
export function remoteCommandFailure(output: string, fallback: string): string {
  if (/authentication failed|bad credentials|permission denied|could not read (username|password)|HTTP (401|403)/i.test(output)) {
    return "Repository access was denied. Check your Git sign-in and repository permissions, then retry.";
  }
  if (/repository not found|HTTP 404/i.test(output)) {
    return "The repository was not found or is not accessible to your account. Check the repository and your sign-in.";
  }
  if (/non-fast-forward|fetch first|stale info/i.test(output)) {
    return "The remote branch has changed. Fetch and review its changes before pushing again.";
  }
  if (/could not resolve host|failed to connect|network is unreachable/i.test(output)) {
    return "Could not reach the repository host. Check your connection, then retry.";
  }
  if (/timed? out|timeout/i.test(output)) {
    return "The repository operation timed out. Refresh its state before retrying; it may have completed remotely.";
  }
  return fallback;
}
