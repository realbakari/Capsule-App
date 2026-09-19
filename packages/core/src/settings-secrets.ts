import { CAPSULE_KEYCHAIN_SERVICE, type KeychainAdapter } from "./keychain.js";

export interface SecretChange { account: string; value?: string }

/** Compensate secure-store writes if any write or the settings transaction fails. */
export async function commitWithSecrets<T>(
  keychain: KeychainAdapter,
  changes: SecretChange[],
  commit: () => T,
): Promise<T> {
  const previous: SecretChange[] = [];
  let attempted = 0;
  const write = (change: SecretChange) => change.value === undefined
    ? keychain.delete(CAPSULE_KEYCHAIN_SERVICE, change.account)
    : keychain.set(CAPSULE_KEYCHAIN_SERVICE, change.account, change.value);
  try {
    // Read the actual stored value, not an ambient token used by the running
    // client. Snapshot everything before changing either credential.
    for (const change of changes) {
      previous.push({ account: change.account, value: await keychain.get(CAPSULE_KEYCHAIN_SERVICE, change.account) });
    }
    for (const change of changes) {
      attempted++;
      await write(change);
    }
    return commit();
  } catch {
    let restored = true;
    for (const change of previous.slice(0, attempted).reverse()) {
      try { await write(change); } catch { restored = false; }
    }
    // Adapter errors can contain credentials. Never forward their raw text.
    throw new Error(restored
      ? "Could not save settings. Previous settings were kept; check storage access and retry."
      : "Could not save settings or fully restore saved credentials. Check storage access, then re-enter your credentials.");
  }
}
