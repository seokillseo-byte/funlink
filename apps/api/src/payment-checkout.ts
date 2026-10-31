import { createHash, createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const zeroDecimal = new Set(["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"]);
export function formatMinorAmount(amountMinor: number, currency: string) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Invalid amount");
  const digits = zeroDecimal.has(currency.toUpperCase()) ? 0 : 2;
  return (amountMinor / (10 ** digits)).toFixed(digits);
}
function required(name: string) { const v = process.env[name]?.trim(); if (!v) throw new Error(name + " is not configured"); return v; }
function httpsBase(name: string) {
  const u = new URL(required(name));
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) throw new Error(name + " must be an HTTPS base URL");
  return u;
}
function returnUrls(id: string, tenantId: string) {
  const ret = new URL(required("PAYMENT_RETURN_URL"));
  const cancel = new URL(process.env.PAYMENT_CANCEL_URL || ret.toString());
  if (!["https:","http:"].includes(ret.protocol) || !["https:","http:"].includes(cancel.protocol)) throw new Error("Invalid payment return URL");
  if (process.env.NODE_ENV === "production" && (ret.protocol !== "https:" || cancel.protocol !== "https:")) throw new Error("Production payment return URLs must use HTTPS");
  ret.searchParams.set("payment_attempt", id); cancel.searchParams.set("payment_attempt", id);
  ret.searchParams.set("workspace", tenantId); cancel.searchParams.set("workspace", tenantId);
  return { ret: ret.toString(), cancel: cancel.toString() };
}
const enc = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
function vnpayDate(d: Date) {
  const p = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(d);
  const part = (type: string) => p.find(x => x.type === type)?.value ?? "";
  return part("year")+part("month")+part("day")+part("hour")+part("minute")+part("second");
}
export function buildVnpayCheckoutUrl(input: {attemptId:string;tenantId:string;invoiceNumber:string;amountMinor:number;ipAddress:string;now?:Date}) {
  const endpoint=httpsBase("VNPAY_PAYMENT_URL"), secret=required("VNPAY_HASH_SECRET");
  const amount=input.amountMinor*100;
  if (!Number.isSafeInteger(amount)) throw new Error("VNPay amount too large");
  const now=input.now??new Date(), expiry=new Date(now.getTime()+15*60_000);
  const p:Record<string,string>={
    vnp_Version:"2.1.0",vnp_Command:"pay",vnp_TmnCode:required("VNPAY_TMN_CODE"),
    vnp_Amount:String(amount),vnp_CurrCode:"VND",vnp_TxnRef:input.attemptId,
    vnp_OrderInfo:("FunLink invoice "+input.invoiceNumber).slice(0,255),vnp_OrderType:"other",
    vnp_Locale:"vn",vnp_ReturnUrl:returnUrls(input.attemptId,input.tenantId).ret,vnp_IpAddr:input.ipAddress.slice(0,45),
    vnp_CreateDate:vnpayDate(now),vnp_ExpireDate:vnpayDate(expiry)
  };
  const canonical=Object.keys(p).sort().map(k=>enc(k)+"="+enc(p[k]??"")).join("&");
  p.vnp_SecureHash=createHmac("sha512",secret).update(canonical).digest("hex");
  endpoint.search=Object.keys(p).sort().map(k=>enc(k)+"="+enc(p[k]??"")).join("&");
  return endpoint.toString();
}
async function paypalToken() {
  const base=httpsBase("PAYPAL_API_BASE_URL");
  const response=await fetch(new URL("/v1/oauth2/token",base),{
    method:"POST",headers:{Authorization:"Basic "+Buffer.from(required("PAYPAL_CLIENT_ID")+":"+required("PAYPAL_CLIENT_SECRET")).toString("base64"),"Content-Type":"application/x-www-form-urlencoded"},
    body:"grant_type=client_credentials",signal:AbortSignal.timeout(10_000),redirect:"error"
  });
  if(!response.ok) throw new Error("PayPal OAuth failed");
  const data=await response.json() as {access_token?:string};
  if(!data.access_token) throw new Error("PayPal OAuth response invalid");
  return {base,token:data.access_token};
}
async function createPaypal(input:{attemptId:string;tenantId:string;invoiceId:string;invoiceNumber:string;amountMinor:number;currency:string}) {
  const {base,token}=await paypalToken(), urls=returnUrls(input.attemptId,input.tenantId);
  const response=await fetch(new URL("/v2/checkout/orders",base),{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json","PayPal-Request-Id":input.attemptId},
    body:JSON.stringify({intent:"CAPTURE",purchase_units:[{reference_id:input.invoiceId,custom_id:input.attemptId,invoice_id:input.invoiceNumber.slice(0,127),amount:{currency_code:input.currency,value:formatMinorAmount(input.amountMinor,input.currency)}}],payment_source:{paypal:{experience_context:{return_url:urls.ret,cancel_url:urls.cancel,user_action:"PAY_NOW",shipping_preference:"NO_SHIPPING"}}}}),
    signal:AbortSignal.timeout(12_000),redirect:"error"
  });
  if(!response.ok) throw new Error("PayPal order creation failed");
  const data=await response.json() as {id?:string;links?:Array<{rel?:string;href?:string}>};
  const href=data.links?.find(x=>x.rel==="payer-action"||x.rel==="approve")?.href;
  if(!data.id||!href) throw new Error("PayPal order response invalid");
  const approval=new URL(href);
  if(approval.protocol!=="https:"||!["www.paypal.com","www.sandbox.paypal.com"].includes(approval.hostname)) throw new Error("Untrusted PayPal approval URL");
  return {id:data.id,url:approval.toString()};
}
export function signBinancePayRequest(body:string,timestamp:string,nonce:string,privateKey:string) {
  return createHmac("sha512",privateKey).update(timestamp+"\n"+nonce+"\n"+body+"\n").digest("hex").toUpperCase();
}
async function createBinance(input:{attemptId:string;tenantId:string;invoiceNumber:string;amountMinor:number;currency:string}) {
  const base=httpsBase("BINANCE_PAY_API_BASE_URL"),urls=returnUrls(input.attemptId,input.tenantId);
  const timestamp=Date.now().toString(),nonce=randomBytes(16).toString("hex");
  const body=JSON.stringify({
    env:{terminalType:"WEB"},merchantTradeNo:input.attemptId,
    orderAmount:Number(formatMinorAmount(input.amountMinor,input.currency)),currency:input.currency,
    goods:{goodsType:"02",goodsCategory:"Z000",referenceGoodsId:input.attemptId,goodsName:"FunLink subscription"},
    returnUrl:urls.ret,cancelUrl:urls.cancel,webhookUrl:required("BINANCE_PAY_WEBHOOK_URL"),orderExpireTime:Date.now()+900_000
  });
  const response=await fetch(new URL("/binancepay/openapi/v2/order",base),{
    method:"POST",headers:{"Content-Type":"application/json","BinancePay-Timestamp":timestamp,"BinancePay-Nonce":nonce,"BinancePay-Certificate-SN":required("BINANCE_PAY_API_KEY"),"BinancePay-Signature":signBinancePayRequest(body,timestamp,nonce,required("BINANCE_PAY_API_SECRET"))},
    body,signal:AbortSignal.timeout(12_000),redirect:"error"
  });
  if(!response.ok) throw new Error("Binance Pay order creation failed");
  const data=await response.json() as {status?:string;data?:{prepayId?:string;checkoutUrl?:string;universalUrl?:string;qrcodeLink?:string}};
  const href=data.data?.universalUrl??data.data?.checkoutUrl??data.data?.qrcodeLink;
  if(data.status!=="SUCCESS"||!data.data?.prepayId||!href) throw new Error("Binance Pay response invalid");
  const url=new URL(href);if(url.protocol!=="https:")throw new Error("Insecure Binance checkout URL");
  return {id:data.data.prepayId,url:url.toString()};
}
async function access(request:any,db:PrismaClient,tenantId:string) {
  const raw=request.cookies?.funlink_session;if(!raw)return null;
  const s=await db.session.findUnique({where:{tokenHash:sha(raw)},include:{user:{select:{id:true,status:true,emailVerifiedAt:true,memberships:{where:{tenantId},include:{tenant:{select:{status:true}}}}}}}});
  if(!s||s.revokedAt||s.expiresAt<=new Date()||s.user.status!=="ACTIVE"||!s.user.emailVerifiedAt)return null;
  const m=s.user.memberships[0];if(!m||m.tenant.status!=="ACTIVE")return null;
  return {userId:s.user.id,denied:!["OWNER","ADMIN","BILLING"].includes(m.role)};
}
type Provider="vnpay"|"paypal"|"binancepay";
const paypalCurrencies=new Set(["USD","EUR","GBP","CAD","AUD"]);
function currencyAllowed(provider:Provider,currency:string) {
  if(provider==="binancepay")return currency==="USDT";
  if(!/^[A-Z]{3}$/.test(currency))return false;
  if(provider==="vnpay")return currency==="VND";
  return paypalCurrencies.has(currency);
}
export function paymentCheckoutRoutes(app:FastifyInstance,db:PrismaClient) {
  app.get("/v1/workspaces/:tenantId/invoices",async(req,reply)=>{
    const p=z.object({tenantId:z.string().min(1).max(64)}).safeParse(req.params);
    if(!p.success)return reply.code(400).send({error:"Invalid workspace"});
    const a=await access(req,db,p.data.tenantId);
    if(!a)return reply.code(401).send({error:"Authentication required"});
    const invoices=await db.invoice.findMany({
      where:{tenantId:p.data.tenantId},
      orderBy:{createdAt:"desc"},
      take:50,
      select:{id:true,number:true,status:true,amountMinor:true,currency:true,dueAt:true,paidAt:true,createdAt:true,payments:{orderBy:{createdAt:"desc"},take:3,select:{id:true,provider:true,status:true,createdAt:true,paidAt:true}}}
    });
    return {invoices};
  });

  app.get("/v1/workspaces/:tenantId/payment-attempts/:attemptId",async(req,reply)=>{
    const p=z.object({tenantId:z.string().min(1).max(64),attemptId:z.string().min(1).max(64)}).safeParse(req.params);
    if(!p.success)return reply.code(400).send({error:"Invalid payment attempt"});
    const a=await access(req,db,p.data.tenantId);
    if(!a)return reply.code(401).send({error:"Authentication required"});
    const attempt=await db.paymentAttempt.findFirst({
      where:{id:p.data.attemptId,tenantId:p.data.tenantId},
      select:{id:true,provider:true,status:true,amountMinor:true,currency:true,createdAt:true,paidAt:true,invoice:{select:{id:true,number:true,status:true}}}
    });
    if(!attempt)return reply.code(404).send({error:"Payment attempt not found"});
    return {paymentAttempt:attempt};
  });

  app.post("/v1/workspaces/:tenantId/invoices/:invoiceId/checkout",async(req,reply)=>{
    const p=z.object({tenantId:z.string().min(1).max(64),invoiceId:z.string().min(1).max(64)}).safeParse(req.params);
    const b=z.object({provider:z.enum(["vnpay","paypal","binancepay"])}).safeParse(req.body);
    if(!p.success||!b.success)return reply.code(400).send({error:"Invalid checkout request"});
    const a=await access(req,db,p.data.tenantId);if(!a)return reply.code(401).send({error:"Authentication required"});if(a.denied)return reply.code(403).send({error:"Workspace billing access required"});
    const invoice=await db.invoice.findFirst({where:{id:p.data.invoiceId,tenantId:p.data.tenantId,status:"OPEN"},select:{id:true,number:true,amountMinor:true,currency:true}});
    if(!invoice)return reply.code(404).send({error:"Open invoice not found"});
    const provider=b.data.provider;
    if(!currencyAllowed(provider,invoice.currency)||!Number.isSafeInteger(invoice.amountMinor)||invoice.amountMinor<=0)return reply.code(400).send({error:"Provider does not support this invoice currency or amount"});
    const key=req.headers["idempotency-key"];
    if(typeof key!=="string"||!/^[A-Za-z0-9._:-]{16,128}$/.test(key))return reply.code(400).send({error:"A valid Idempotency-Key header is required"});
    const old=await db.paymentAttempt.findUnique({where:{idempotencyKey:key}});
    if(old){
      if(old.tenantId!==p.data.tenantId||old.invoiceId!==invoice.id||old.provider!==provider)return reply.code(409).send({error:"Idempotency key already used for another payment"});
      if(old.status!=="PENDING"||!old.providerCheckoutUrl)return reply.code(409).send({error:"Payment attempt cannot be reused; use a new idempotency key"});
      return {paymentAttemptId:old.id,provider,checkoutUrl:old.providerCheckoutUrl,reused:true};
    }
    const attempt=await db.paymentAttempt.create({data:{tenantId:p.data.tenantId,invoiceId:invoice.id,provider,idempotencyKey:key,amountMinor:invoice.amountMinor,currency:invoice.currency},select:{id:true}});
    try {
      let result:{id:string;url:string};
      if(provider==="vnpay")result={id:attempt.id,url:buildVnpayCheckoutUrl({attemptId:attempt.id,tenantId:p.data.tenantId,invoiceNumber:invoice.number,amountMinor:invoice.amountMinor,ipAddress:req.ip})};
      else if(provider==="paypal")result=await createPaypal({attemptId:attempt.id,tenantId:p.data.tenantId,invoiceId:invoice.id,invoiceNumber:invoice.number,amountMinor:invoice.amountMinor,currency:invoice.currency});
      else result=await createBinance({attemptId:attempt.id,tenantId:p.data.tenantId,invoiceNumber:invoice.number,amountMinor:invoice.amountMinor,currency:invoice.currency});
      await db.paymentAttempt.updateMany({where:{id:attempt.id,tenantId:p.data.tenantId},data:{providerCheckoutId:result.id,providerCheckoutUrl:result.url}});
      return reply.code(201).send({paymentAttemptId:attempt.id,provider,checkoutUrl:result.url,reused:false});
    } catch(error) {
      req.log.error({err:error,provider,paymentAttemptId:attempt.id},"Checkout creation failed");
      await db.paymentAttempt.updateMany({where:{id:attempt.id,status:"PENDING"},data:{status:"FAILED"}});
      return reply.code(503).send({error:"Payment provider unavailable or not configured. No charge was made."});
    }
  });

  app.post("/v1/workspaces/:tenantId/payment-attempts/:attemptId/paypal/capture",async(req,reply)=>{
    const p=z.object({tenantId:z.string().min(1).max(64),attemptId:z.string().min(1).max(64)}).safeParse(req.params);
    if(!p.success)return reply.code(400).send({error:"Invalid payment attempt"});
    const a=await access(req,db,p.data.tenantId);if(!a)return reply.code(401).send({error:"Authentication required"});if(a.denied)return reply.code(403).send({error:"Workspace billing access required"});
    const body=z.object({orderId:z.string().min(1).max(128)}).safeParse(req.body);
    if(!body.success)return reply.code(400).send({error:"PayPal order ID is required"});
    const attempt=await db.paymentAttempt.findFirst({where:{id:p.data.attemptId,tenantId:p.data.tenantId,provider:"paypal",status:"PENDING",providerCheckoutId:{not:null}},select:{id:true,providerCheckoutId:true}});
    if(!attempt?.providerCheckoutId)return reply.code(404).send({error:"Pending PayPal payment attempt not found"});
    if(attempt.providerCheckoutId!==body.data.orderId)return reply.code(409).send({error:"PayPal order does not match this payment attempt"});
    try{
      const {base,token}=await paypalToken();
      const response=await fetch(new URL("/v2/checkout/orders/"+encodeURIComponent(attempt.providerCheckoutId)+"/capture",base),{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json","PayPal-Request-Id":attempt.id+"-capture"},body:"{}",signal:AbortSignal.timeout(12_000),redirect:"error"});
      const data=await response.json().catch(()=>({})) as {status?:string};
      if(!response.ok||data.status!=="COMPLETED")return reply.code(409).send({error:"PayPal capture is not confirmed. Check status before retrying."});
      // Only the signed provider webhook is allowed to settle the invoice.
      return {paymentAttemptId:attempt.id,status:"AWAITING_PROVIDER_WEBHOOK"};
    }catch(error){req.log.error({err:error,paymentAttemptId:attempt.id},"PayPal capture failed");return reply.code(503).send({error:"PayPal capture could not be confirmed. Check status before retrying."});}
  });
}
