/**
 * Optional passphrase protection for API keys.
 *
 * Keys are encrypted with AES-GCM (256-bit) using a key derived from the passphrase with
 * PBKDF2-SHA-256. The encrypted blob lives in storage.local; the derived key is kept in
 * storage.session (memory only, cleared when the browser closes) once unlocked, so the
 * passphrase is asked once per browser session.
 *
 * What this protects against: someone reading the browser profile on disk or a storage dump.
 * It does not protect against malware running in an unlocked session.
 */
import { browser } from "wxt/browser";

export interface Vault {
  version: 1;
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext of JSON { [providerId]: apiKey }
}

export type VaultKeys = Record<string, string>;

const SESSION_KEY = "pagecraft.vaultKey";
export const PBKDF2_ITERATIONS = 600_000;

/** Fallback for browsers without storage.session (key lives only in this page). */
let memoryKey: string | null = null;

const toBase64 = (bytes: ArrayBuffer | Uint8Array): string => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    true, // extractable, so the unlocked key can be kept in session storage
    ["encrypt", "decrypt"],
  );
}

async function encrypt(key: CryptoKey, keys: VaultKeys, salt: string, iterations: number): Promise<Vault> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(keys)));
  return { version: 1, iterations, salt, iv: toBase64(iv), data: toBase64(data) };
}

async function decrypt(key: CryptoKey, vault: Vault): Promise<VaultKeys> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(vault.iv) }, key, fromBase64(vault.data));
  const parsed = JSON.parse(new TextDecoder().decode(plain));
  return parsed && typeof parsed === "object" ? (parsed as VaultKeys) : {};
}

async function rememberKey(key: CryptoKey) {
  const raw = toBase64(await crypto.subtle.exportKey("raw", key));
  memoryKey = raw;
  await browser.storage.session?.set({ [SESSION_KEY]: raw }).catch(() => undefined);
}

async function sessionKey(): Promise<CryptoKey | null> {
  let raw = memoryKey;
  try {
    const stored = (await browser.storage.session?.get(SESSION_KEY)) as Record<string, string> | undefined;
    raw = stored?.[SESSION_KEY] ?? raw;
  } catch {
    // storage.session unavailable
  }
  if (!raw) return null;
  return crypto.subtle.importKey("raw", fromBase64(raw), "AES-GCM", true, ["encrypt", "decrypt"]);
}

/** Encrypt keys under a new passphrase and unlock for this session. */
export async function createVault(passphrase: string, keys: VaultKeys, iterations = PBKDF2_ITERATIONS): Promise<Vault> {
  if (passphrase.length < 8) throw new Error("Use a passphrase of at least 8 characters.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt, iterations);
  const vault = await encrypt(key, keys, toBase64(salt), iterations);
  await rememberKey(key);
  return vault;
}

/** Check the passphrase, unlock for this session, and return the keys. Throws on a wrong passphrase. */
export async function unlockVault(vault: Vault, passphrase: string): Promise<VaultKeys> {
  const key = await deriveKey(passphrase, fromBase64(vault.salt), vault.iterations);
  let keys: VaultKeys;
  try {
    keys = await decrypt(key, vault);
  } catch {
    throw new Error("Wrong passphrase.");
  }
  await rememberKey(key);
  return keys;
}

/** Keys if the vault is unlocked in this session, else null. */
export async function unlockedKeys(vault: Vault): Promise<VaultKeys | null> {
  try {
    const key = await sessionKey();
    return key ? await decrypt(key, vault) : null;
  } catch {
    return null;
  }
}

/** Re-encrypt changed keys with the unlocked session key. Throws if locked. */
export async function updateVault(vault: Vault, keys: VaultKeys): Promise<Vault> {
  const key = await sessionKey();
  if (!key) throw new Error("Unlock your API keys first.");
  return encrypt(key, keys, vault.salt, vault.iterations);
}

export async function lockVault(): Promise<void> {
  memoryKey = null;
  await browser.storage.session?.remove(SESSION_KEY).catch(() => undefined);
}
