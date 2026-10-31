import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  binanceCertificateSerial,
  verifyBinancePayWebhook,
  verifyPayPalWebhook,
  verifyVnpayIpn
} from "./payment-providers.js";

test("VNPay verifies the sorted v2.1 HMAC-SHA512 callback and rejects tampering", () => {
  const secret = "vnpay-test-secret";
  const params: Record<string, string> = {
    vnp_Amount: "100000",
    vnp_Command: "pay",
    vnp_ResponseCode: "00",
    vnp_TmnCode: "TESTCODE",
    vnp_TransactionNo: "123456",
    vnp_TransactionStatus: "00",
    vnp_TxnRef: "payment_attempt_123"
  };
  const canonical = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  params.vnp_SecureHash = createHmac("sha512", secret).update(canonical).digest("hex");
  assert.equal(verifyVnpayIpn(params, secret), true);
  assert.equal(verifyVnpayIpn({ ...params, vnp_Amount: "100001" }, secret), false);
});

test("VNPay excludes secure hash metadata from the signed parameter set", () => {
  const secret = "vnpay-test-secret";
  const params: Record<string, string> = { vnp_Amount: "100000", vnp_TxnRef: "attempt-1" };
  const canonical = Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  params.vnp_SecureHashType = "HmacSHA512";
  params.vnp_SecureHash = createHmac("sha512", secret).update(canonical).digest("hex");
  assert.equal(verifyVnpayIpn(params, secret), true);
});

test("PayPal rejects missing headers and stale transmissions before network access", async () => {
  let fetchCalled = false;
  const result = await verifyPayPalWebhook({
    rawBody: Buffer.from("{}"),
    headers: {
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-time": new Date(0).toISOString(),
      "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "AA=="
    },
    webhookId: "webhook-test",
    now: Date.now(),
    fetcher: async () => { fetchCalled = true; return new Response("no"); }
  });
  assert.equal(result, false);
  assert.equal(fetchCalled, false);
});

test("PayPal rejects certificate URLs outside the official allowlist", async () => {
  let fetchCalled = false;
  const result = await verifyPayPalWebhook({
    rawBody: Buffer.from("{}"),
    headers: {
      "paypal-transmission-id": "tx-1",
      "paypal-transmission-time": new Date().toISOString(),
      "paypal-cert-url": "https://attacker.example/cert.pem",
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-transmission-sig": "AA=="
    },
    webhookId: "webhook-test",
    fetcher: async () => { fetchCalled = true; return new Response("no"); }
  });
  assert.equal(result, false);
  assert.equal(fetchCalled, false);
});

test("Binance Pay verifies the native RSA-SHA256 raw-body signature and rejects altered bytes", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const serial = binanceCertificateSerial(publicKeyPem);
  const timestamp = Date.now().toString();
  const nonce = "0123456789abcdefghijklmnopqrstuv";
  const rawBody = Buffer.from('{"bizType":"PAY","bizStatus":"PAY_SUCCESS"}');
  const signed = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), rawBody, Buffer.from("\n")]);
  const signature = cryptoSign("RSA-SHA256", signed, privateKey).toString("base64");
  const headers = {
    "binancepay-timestamp": timestamp,
    "binancepay-nonce": nonce,
    "binancepay-certificate-sn": serial,
    "binancepay-signature": signature
  };
  assert.equal(verifyBinancePayWebhook({ rawBody, headers, publicKeyPem, certificateSerial: serial }), true);
  assert.equal(verifyBinancePayWebhook({ rawBody: Buffer.from(rawBody.toString() + " "), headers, publicKeyPem, certificateSerial: serial }), false);
});

test("Binance Pay rejects stale timestamps and certificate serial mismatch", () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const serial = binanceCertificateSerial(publicKeyPem);
  const headers = {
    "binancepay-timestamp": "1600000000000",
    "binancepay-nonce": "0123456789abcdefghijklmnopqrstuv",
    "binancepay-certificate-sn": "wrong",
    "binancepay-signature": "AA=="
  };
  assert.equal(verifyBinancePayWebhook({ rawBody: Buffer.from("{}"), headers, publicKeyPem, certificateSerial: serial }), false);
});
