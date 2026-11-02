import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(
  password: string,
  salt: Buffer,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      length,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: MAX_MEMORY },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("La contraseña debe tener entre 12 y 1024 caracteres.");
  }

  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEY_LENGTH);

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!password || password.length > 1024) return false;

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = parts[1];
  const r = parts[2];
  const p = parts[3];
  const saltText = parts[4];
  const keyText = parts[5];

  if (
    n !== String(SCRYPT_N) ||
    r !== String(SCRYPT_R) ||
    p !== String(SCRYPT_P) ||
    typeof saltText !== "string" ||
    typeof keyText !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(saltText) ||
    !/^[A-Za-z0-9_-]{86}$/.test(keyText)
  ) {
    return false;
  }

  const salt = Buffer.from(saltText, "base64url");
  const expectedKey = Buffer.from(keyText, "base64url");

  if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) {
    return false;
  }

  const actualKey = await deriveKey(password, salt, KEY_LENGTH);
  return timingSafeEqual(actualKey, expectedKey);
}
export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}