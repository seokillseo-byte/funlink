import { createHash, createHmac, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

export type HeaderMap = Record<string, string | string[] | undefined>;

function header(headers: HeaderMap, name: string): string | undefined {
  const value = headers[name.toLowerCase()] ?? headers[name];
  return typeof value === "string" ? value : undefined;
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function safeEqualBuffer(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function encodeVnpay(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
}

/** VNPAY v2.1.x HMAC-SHA512 checksum over sorted callback parameters. */
export function verifyVnpayIpn(params: Record<string, unknown>, secret: string): boolean {
  const supplied = params.vnp_SecureHash;
  if (typeof supplied !== "string" || !/^[a-f0-9]{128}$/i.test(supplied) || secret.length < 1) return false;
  const pairs = Object.entries(params)
    .filter(([key, value]) => key.startsWith("vnp_") && key !== "vnp_SecureHash" && key !== "vnp_SecureHashType" && (typeof value === "string" || typeof value === "number"))
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  const signed = pairs.map(([key, value]) => `${encodeVnpay(key)}=${encodeVnpay(value)}`).join("&");
  const expected = createHmac("sha512", secret).update(signed, "utf8").digest("hex");
  return safeEqualHex(supplied, expected);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const paypalCertCache = new Map<string, { pem: string; expiresAt: number }>();
const PAYPAL_CERT_HOSTS = new Set(["api.paypal.com", "api.sandbox.paypal.com"]);

/** PayPal self-verification using transmission headers, webhook ID, raw-body CRC32 and the PayPal certificate. */
export async function verifyPayPalWebhook(input: {
  rawBody: Buffer;
  headers: HeaderMap;
  webhookId: string;
  now?: number;
  fetcher?: typeof fetch;
}): Promise<boolean> {
  const { rawBody, headers, webhookId } = input;
  if (!webhookId) return false;
  const transmissionId = header(headers, "paypal-transmission-id");
  const transmissionTime = header(headers, "paypal-transmission-time");
  const certUrlValue = header(headers, "paypal-cert-url");
  const authAlgo = header(headers, "paypal-auth-algo");
  const signatureValue = header(headers, "paypal-transmission-sig");
  if (!transmissionId || !transmissionTime || !certUrlValue || !signatureValue || authAlgo !== "SHA256withRSA") return false;

  const timestamp = Date.parse(transmissionTime);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) return false;

  let certUrl: URL;
  try { certUrl = new URL(certUrlValue); } catch { return false; }
  if (certUrl.protocol !== "https:" || !PAYPAL_CERT_HOSTS.has(certUrl.hostname) || !/^\/v1\/notifications\/certs\/[A-Za-z0-9_-]+$/.test(certUrl.pathname) || certUrl.search || certUrl.username || certUrl.password) return false;

  let pem = paypalCertCache.get(certUrl.href);
  if (!pem || pem.expiresAt < now) {
    const fetcher = input.fetcher ?? fetch;
    let response: Response;
    try { response = await fetcher(certUrl.href, { signal: AbortSignal.timeout(4000), redirect: "error" }); } catch { return false; }
    if (!response.ok) return false;
    const certificate = await response.text();
    if (certificate.length > 32_000 || !certificate.includes("BEGIN CERTIFICATE")) return false;
    pem = { pem: certificate, expiresAt: now + 6 * 60 * 60 * 1000 };
    paypalCertCache.set(certUrl.href, pem);
  }

  const crc = crc32(rawBody);
  const signedMessage = `${transmissionId}|${transmissionTime}|${webhookId}|${crc}`;
  let signature: Buffer;
  try { signature = Buffer.from(signatureValue, "base64"); } catch { return false; }
  if (!signature.length || signature.toString("base64").replace(/=+$/, "") !== signatureValue.replace(/=+$/, "")) return false;
  try { return cryptoVerify("RSA-SHA256", Buffer.from(signedMessage, "utf8"), pem.pem, signature); } catch { return false; }
}

/** Binance Pay webhook signature: RSA-SHA256 over timestamp + LF + nonce + LF + raw body + LF. */
export function verifyBinancePayWebhook(input: {
  rawBody: Buffer;
  headers: HeaderMap;
  publicKeyPem: string;
  certificateSerial: string;
  now?: number;
}): boolean {
  const timestamp = header(input.headers, "binancepay-timestamp");
  const nonce = header(input.headers, "binancepay-nonce");
  const signatureValue = header(input.headers, "binancepay-signature");
  const serial = header(input.headers, "binancepay-certificate-sn");
  if (!timestamp || !nonce || !signatureValue || !serial || !input.publicKeyPem || !input.certificateSerial) return false;
  if (serial !== input.certificateSerial || !/^\d{13}$/.test(timestamp) || !/^[A-Za-z0-9]{32}$/.test(nonce)) return false;
  const timestampNumber = Number(timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(now - timestampNumber) > 5 * 60 * 1000) return false;
  let signature: Buffer;
  try { signature = Buffer.from(signatureValue, "base64"); } catch { return false; }
  if (!signature.length || signature.toString("base64").replace(/=+$/, "") !== signatureValue.replace(/=+$/, "")) return false;
  const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`, "utf8"), input.rawBody, Buffer.from("\n", "utf8")]);
  try { return cryptoVerify("RSA-SHA256", message, input.publicKeyPem, signature); } catch { return false; }
}

export function binanceCertificateSerial(publicKeyPem: string): string {
  const normalized = publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, "");
  return createHash("md5").update(Buffer.from(normalized, "base64")).digest("hex");
}
