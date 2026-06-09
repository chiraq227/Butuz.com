const CURVE = 'P-256';
const STORAGE_PREFIX = 'butuz_e2ee_priv_';

export interface KeyPairJwk {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export interface EncryptedMessage {
  ciphertext: string;
  iv: string;
}

export async function generateE2EEKeyPair(): Promise<KeyPairJwk> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: CURVE,
    },
    true,
    ['deriveKey', 'deriveBits']
  );

  const publicKey = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return { publicKey, privateKey };
}

export function storePrivateKey(userId: number, privateJwk: JsonWebKey): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${userId}`, JSON.stringify(privateJwk));
  } catch (e) {
    console.error('Failed to store private key (storage full or disabled?)', e);
    throw new Error('Не удалось сохранить ключ шифрования в браузере');
  }
}

export function getPrivateKey(userId: number): JsonWebKey | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function hasPrivateKey(userId: number): boolean {
  return !!getPrivateKey(userId);
}

export function clearPrivateKey(userId: number): void {
  localStorage.removeItem(`${STORAGE_PREFIX}${userId}`);
}

async function importPrivateKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: CURVE },
    false,
    ['deriveKey']
  );
}

async function importPublicKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: CURVE },
    true,
    []
  );
}

async function deriveAESKey(myPrivateJwk: JsonWebKey, theirPublicJwk: JsonWebKey): Promise<CryptoKey> {
  const privKey = await importPrivateKey(myPrivateJwk);
  const pubKey = await importPublicKey(theirPublicJwk);

  return crypto.subtle.deriveKey(
    {
      name: 'ECDH',
      public: pubKey,
    },
    privKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptMessage(
  plaintext: string,
  myPrivateJwk: JsonWebKey,
  theirPublicJwk: JsonWebKey
): Promise<EncryptedMessage> {
  if (!plaintext) throw new Error('Empty message');

  const aesKey = await deriveAESKey(myPrivateJwk, theirPublicJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const enc = new TextEncoder();
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    enc.encode(plaintext)
  );

  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ciphertextBuffer)));
  const ivB64 = btoa(String.fromCharCode(...iv));

  return { ciphertext: ctB64, iv: ivB64 };
}

export async function decryptMessage(
  ciphertextB64: string,
  ivB64: string,
  myPrivateJwk: JsonWebKey,
  theirPublicJwk: JsonWebKey
): Promise<string> {
  const aesKey = await deriveAESKey(myPrivateJwk, theirPublicJwk);

  const ctBytes = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    ctBytes
  );

  return new TextDecoder().decode(plainBuffer);
}

const PUB_STORAGE_PREFIX = 'butuz_e2ee_pub_';

export function storeKeyPair(userId: number, pair: KeyPairJwk) {
  storePrivateKey(userId, pair.privateKey);
  try {
    localStorage.setItem(`${PUB_STORAGE_PREFIX}${userId}`, JSON.stringify(pair.publicKey));
  } catch {}
}

export function getStoredPublicKey(userId: number): JsonWebKey | null {
  try {
    const raw = localStorage.getItem(`${PUB_STORAGE_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function ensureFullKeyPair(userId: number): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey; wasGenerated: boolean }> {
  const existingPriv = getPrivateKey(userId);
  const existingPub = getStoredPublicKey(userId);

  if (existingPriv && existingPub) {
    return { privateJwk: existingPriv, publicJwk: existingPub, wasGenerated: false };
  }

  const pair = await generateE2EEKeyPair();
  storeKeyPair(userId, pair);
  return { privateJwk: pair.privateKey, publicJwk: pair.publicKey, wasGenerated: true };
}
