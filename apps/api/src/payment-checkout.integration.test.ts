import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import type { PrismaClient } from "@prisma/client";

const config = loadConfig({ NODE_ENV: "test", API_HOST: "127.0.0.1", API_PORT: "3013" });
const originalFetch = globalThis.fetch;
const envKeys = [
  "NODE_ENV","PAYMENT_RETURN_URL","PAYMENT_CANCEL_URL",
  "VNPAY_PAYMENT_URL","VNPAY_TMN_CODE","VNPAY_HASH_SECRET",
  "PAYPAL_API_BASE_URL","PAYPAL_CLIENT_ID","PAYPAL_CLIENT_SECRET",
  "BINANCE_PAY_API_BASE_URL","BINANCE_PAY_API_KEY","BINANCE_PAY_API_SECRET","BINANCE_PAY_WEBHOOK_URL"
] as const;
function withEnv(values: Record<string,string>, run: () => Promise<void>) {
  const previous = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  for (const [key,value] of Object.entries(values)) process.env[key] = value;
  return run().finally(() => {
    for (const key of envKeys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = originalFetch;
  });
}
function fixture(role = "BILLING", currency = "VND") {
  let attempt: any = null;
  const invoice = {
    id:"invoice-1",tenantId:"tenant-1",number:"INV-2026-001",status:"OPEN",
    amountMinor:125000,currency,dueAt:null,paidAt:null,createdAt:new Date("2026-10-01T00:00:00Z")
  };
  const session = {
    revokedAt:null,expiresAt:new Date(Date.now()+60_000),
    user:{id:"user-1",status:"ACTIVE",emailVerifiedAt:new Date(),memberships:[{role,tenant:{status:"ACTIVE"}}]}
  };
  const prisma = {
    session:{findUnique:async(args:any)=>args.include.user.select.memberships.where.tenantId==="tenant-1"?session:{...session,user:{...session.user,memberships:[]}}},
    invoice:{
      findFirst:async({where}:any)=>where.tenantId==="tenant-1"&&where.id==="invoice-1"&&where.status==="OPEN"?invoice:null,
      findMany:async({where}:any)=>where.tenantId==="tenant-1"?[{...invoice,payments:attempt?[{id:attempt.id,provider:attempt.provider,status:attempt.status,providerCheckoutUrl:attempt.providerCheckoutUrl,createdAt:new Date(),paidAt:null}]:[]}]:[]
    },
    paymentAttempt:{
      findUnique:async({where}:any)=>attempt?.idempotencyKey===where.idempotencyKey?attempt:null,
      create:async({data}:any)=>{attempt={...data,id:"attempt-123",status:"PENDING",providerCheckoutId:null,providerCheckoutUrl:null,createdAt:new Date(),paidAt:null};return {id:attempt.id};},
      updateMany:async({where,data}:any)=>{if(attempt?.id===where.id){Object.assign(attempt,data);return {count:1};}return {count:0};},
      findFirst:async({where}:any)=>attempt?.id===where.id&&attempt.tenantId===where.tenantId?{id:attempt.id,provider:attempt.provider,status:attempt.status,providerCheckoutId:attempt.providerCheckoutId}:null
    }
  } as unknown as PrismaClient;
  return {prisma, get attempt(){return attempt;}};
}
function makeApp(prisma: PrismaClient) { return buildApp({config,prisma,logger:false}); }
const cookie = "funlink_session=sandbox-test-session";
const key = "sandbox-idempotency-key-0001";
const headers = {"content-type":"application/json",cookie,"idempotency-key":key};

test("VNPay sandbox checkout flow creates a signed URL and exposes tenant-scoped invoice/status", async () => {
  await withEnv({
    NODE_ENV:"test",PAYMENT_RETURN_URL:"https://funlink.example/billing/return",
    VNPAY_PAYMENT_URL:"https://sandbox.vnpayment.vn/paymentv2/vpcpay.html",
    VNPAY_TMN_CODE:"SANDBOX",VNPAY_HASH_SECRET:"unit-test-secret"
  },async()=>{
    const f=fixture(),app=makeApp(f.prisma);await app.ready();
    const created=await app.inject({method:"POST",url:"/v1/workspaces/tenant-1/invoices/invoice-1/checkout",headers,payload:{provider:"vnpay"}});
    assert.equal(created.statusCode,201);
    const result=created.json();
    assert.equal(result.paymentAttemptId,"attempt-123");
    const checkout=new URL(result.checkoutUrl);
    assert.equal(checkout.hostname,"sandbox.vnpayment.vn");
    assert.equal(checkout.searchParams.get("vnp_TxnRef"),"attempt-123");
    assert.equal(checkout.searchParams.get("vnp_Amount"),"12500000");
    assert.ok(checkout.searchParams.get("vnp_SecureHash"));
    assert.equal(new URL(checkout.searchParams.get("vnp_ReturnUrl")!).searchParams.get("workspace"),"tenant-1");
    const invoices=await app.inject({method:"GET",url:"/v1/workspaces/tenant-1/invoices",headers:{cookie}});
    assert.equal(invoices.statusCode,200);
    assert.equal(invoices.json().invoices[0].payments[0].provider,"vnpay");
    const status=await app.inject({method:"GET",url:"/v1/workspaces/tenant-1/payment-attempts/attempt-123",headers:{cookie}});
    assert.equal(status.statusCode,200);
    assert.equal(status.json().paymentAttempt.status,"PENDING");
    await app.close();
  });
});

test("PayPal sandbox checkout and capture use the persisted order ID and wait for webhook settlement", async () => {
  await withEnv({
    NODE_ENV:"test",PAYMENT_RETURN_URL:"https://funlink.example/billing/return",
    PAYPAL_API_BASE_URL:"https://api-m.sandbox.paypal.com",
    PAYPAL_CLIENT_ID:"sandbox-client",PAYPAL_CLIENT_SECRET:"sandbox-secret"
  },async()=>{
    const calls:Array<{url:string;init?:RequestInit}>=[];
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const url=String(input);calls.push({url,init});
      if(url.endsWith("/v1/oauth2/token"))return new Response(JSON.stringify({access_token:"sandbox-access"}),{status:200,headers:{"content-type":"application/json"}});
      if(url.endsWith("/v2/checkout/orders"))return new Response(JSON.stringify({id:"PAYPAL-ORDER-123",links:[{rel:"payer-action",href:"https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-123"}]}),{status:201,headers:{"content-type":"application/json"}});
      if(url.endsWith("/v2/checkout/orders/PAYPAL-ORDER-123/capture"))return new Response(JSON.stringify({status:"COMPLETED"}),{status:201,headers:{"content-type":"application/json"}});
      throw new Error("Unexpected sandbox URL "+url);
    }) as typeof fetch;
    const f=fixture("BILLING","USD"),app=makeApp(f.prisma);await app.ready();
    const created=await app.inject({method:"POST",url:"/v1/workspaces/tenant-1/invoices/invoice-1/checkout",headers,payload:{provider:"paypal"}});
    assert.equal(created.statusCode,201);
    const body=JSON.parse(String(calls.find(x=>x.url.endsWith("/v2/checkout/orders"))?.init?.body));
    assert.equal(body.purchase_units[0].custom_id,"attempt-123");
    assert.equal(body.intent,"CAPTURE");
    assert.equal(new URL(body.payment_source.paypal.experience_context.return_url).searchParams.get("workspace"),"tenant-1");
    assert.equal(created.json().checkoutUrl,"https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER-123");
    const mismatch=await app.inject({method:"POST",url:"/v1/workspaces/tenant-1/payment-attempts/attempt-123/paypal/capture",headers:{cookie,"content-type":"application/json"},payload:{orderId:"SOME-OTHER-ORDER"}});
    assert.equal(mismatch.statusCode,409);
    const capture=await app.inject({method:"POST",url:"/v1/workspaces/tenant-1/payment-attempts/attempt-123/paypal/capture",headers:{cookie,"content-type":"application/json"},payload:{orderId:"PAYPAL-ORDER-123"}});
    assert.equal(capture.statusCode,200);
    assert.equal(capture.json().status,"AWAITING_PROVIDER_WEBHOOK");
    assert.equal(f.attempt.status,"PENDING");
    assert.ok(calls.some(x=>x.url.endsWith("/v2/checkout/orders/PAYPAL-ORDER-123/capture")));
    await app.close();
  });
});

test("Binance Pay sandbox checkout signs the exact request and uses the internal attempt ID", async () => {
  await withEnv({
    NODE_ENV:"test",PAYMENT_RETURN_URL:"https://funlink.example/billing/return",
    BINANCE_PAY_API_BASE_URL:"https://bpay.binanceapi.com",
    BINANCE_PAY_API_KEY:"sandbox-certificate-serial",BINANCE_PAY_API_SECRET:"sandbox-hmac-secret",
    BINANCE_PAY_WEBHOOK_URL:"https://api.funlink.example/v1/webhooks/binance-pay"
  },async()=>{
    const captured:{request?:{url:string;init?:RequestInit}}={};
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
      captured.request={url:String(input),init};
      return new Response(JSON.stringify({status:"SUCCESS",data:{prepayId:"BINANCE-PREPAY-123",universalUrl:"https://pay.binance.com/checkout/123"}}),{status:200,headers:{"content-type":"application/json"}});
    }) as typeof fetch;
    const f=fixture("OWNER","USDT"),app=makeApp(f.prisma);await app.ready();
    const created=await app.inject({method:"POST",url:"/v1/workspaces/tenant-1/invoices/invoice-1/checkout",headers,payload:{provider:"binancepay"}});
    assert.equal(created.statusCode,201);
    const payload=String(captured.request?.init?.body);
    const requestHeaders=new Headers(captured.request?.init?.headers);
    const timestamp=requestHeaders.get("BinancePay-Timestamp")??"";
    const nonce=requestHeaders.get("BinancePay-Nonce")??"";
    const signature=requestHeaders.get("BinancePay-Signature")??"";
    const expected=createHmac("sha512","sandbox-hmac-secret").update(timestamp+"\n"+nonce+"\n"+payload+"\n").digest("hex").toUpperCase();
    assert.equal(signature,expected);
    assert.equal(JSON.parse(payload).merchantTradeNo,"attempt-123");
    assert.equal(new URL(JSON.parse(payload).returnUrl).searchParams.get("workspace"),"tenant-1");
    assert.equal(created.json().checkoutUrl,"https://pay.binance.com/checkout/123");
    await app.close();
  });
});

test("workspace members without billing role cannot start checkout; another tenant cannot read invoices", async () => {
  const f=fixture("MEMBER"),app=makeApp(f.prisma);await app.ready();
  const denied=await app.inject({method:"POST",url:"/v1/workspaces/tenant-1/invoices/invoice-1/checkout",headers,payload:{provider:"vnpay"}});
  assert.equal(denied.statusCode,403);
  const hidden=await app.inject({method:"GET",url:"/v1/workspaces/tenant-2/invoices",headers:{cookie}});
  assert.equal(hidden.statusCode,401);
  await app.close();
});
