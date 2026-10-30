import {createHash,randomBytes,scrypt as scryptCb,timingSafeEqual} from "node:crypto";
import {promisify} from "node:util";
import type {FastifyInstance} from "fastify";
import type {PrismaClient} from "@prisma/client";
import {z} from "zod";

const scrypt=promisify(scryptCb);
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
const tokenValue=()=>randomBytes(32).toString("base64url");
const input=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(10).max(128)});
const reg=input.extend({displayName:z.string().trim().min(2).max(80),workspaceName:z.string().trim().min(2).max(80).optional()});
const slug=(s:string)=>s.normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,45)||"workspace";
const attempts=new Map<string,{count:number;resetAt:number}>();
function rateLimited(key:string,limit=5,windowMs=15*60*1000){const now=Date.now();for(const [k,v] of attempts)if(v.resetAt<=now)attempts.delete(k);const item=attempts.get(key);if(!item||item.resetAt<=now){attempts.set(key,{count:1,resetAt:now+windowMs});return false;}item.count++;return item.count>limit;}
const clientKey=(req:any)=>String(req.ip??"unknown").slice(0,100);
async function passwordHash(password:string){const salt=randomBytes(16).toString("hex");const key=await scrypt(password,salt,64) as Buffer;return `scrypt$${salt}$${key.toString("hex")}`;}
async function passwordOK(password:string,stored:string){const [kind,salt,key]=stored.split("$");if(kind!=="scrypt"||!salt||!key||!/^[a-f0-9]{128}$/i.test(key))return false;const actual=await scrypt(password,salt,64) as Buffer;const expected=Buffer.from(key,"hex");return actual.length===expected.length&&timingSafeEqual(actual,expected);}
async function sendEmail(to:string,subject:string,html:string){
 const apiKey=process.env.RESEND_API_KEY,from=process.env.EMAIL_FROM,base=process.env.APP_BASE_URL;
 if(!apiKey||!from||!base)throw new Error("Email is not configured. Set RESEND_API_KEY, EMAIL_FROM and APP_BASE_URL.");
 const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from,to,subject,html})});
 if(!response.ok)throw new Error("Email provider rejected the message.");
}
async function issueToken(db:PrismaClient,userId:string,purpose:"EMAIL_VERIFICATION"|"PASSWORD_RESET",ttl:number){
 const raw=tokenValue(),now=new Date(),expiresAt=new Date(now.getTime()+ttl);
 await db.$transaction(async tx=>{
  await tx.authToken.updateMany({where:{userId,purpose,usedAt:null},data:{usedAt:now}});
  await tx.authToken.create({data:{userId,purpose,tokenHash:sha(raw),expiresAt}});
 });
 return raw;
}
async function deliverToken(email:string,raw:string,purpose:"verify"|"reset"){
 const base=process.env.APP_BASE_URL;
 if(!base)throw new Error("APP_BASE_URL is not configured.");
 const url=new URL(purpose==="verify"?"/verify-email":"/reset-password",base);
 url.searchParams.set("token",raw);
 const subject=purpose==="verify"?"Xác minh email FunLink":"Đặt lại mật khẩu FunLink";
 const action=purpose==="verify"?"Xác minh email":"Đặt lại mật khẩu";
 await sendEmail(email,subject,`<p>Bạn vừa yêu cầu ${action.toLowerCase()} cho tài khoản FunLink.</p><p><a href="${url.toString()}">${action}</a></p><p>Liên kết chỉ dùng một lần và sẽ hết hạn sau ${purpose==="verify"?"24 giờ":"1 giờ"}.</p><p>Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.</p>`);
}

export function authRoutes(app:FastifyInstance,db:PrismaClient){
 app.post("/v1/auth/register",async(req,reply)=>{
  if(rateLimited("register:"+clientKey(req),5))return reply.code(429).send({error:"Too many registration attempts. Try again later."});
  const parsed=reg.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid registration details"});
  const {email,password,displayName,workspaceName}=parsed.data;
  try{
   const token=await db.$transaction(async tx=>{
    const existing=await tx.user.findUnique({where:{email},select:{id:true}});
    if(existing)throw new Error("ACCOUNT_EXISTS");
    const user=await tx.user.create({data:{email,displayName,passwordHash:await passwordHash(password)}});
    const workspaceSlug=slug(workspaceName??displayName+"'s workspace");
    const tenant=await tx.tenant.create({data:{name:workspaceName??displayName+"'s workspace",slug:workspaceSlug+"-"+randomBytes(3).toString("hex"),members:{create:{userId:user.id,role:"OWNER"}}}});
    await tx.userProfile.create({data:{userId:user.id}});
    const raw=tokenValue();await tx.authToken.create({data:{userId:user.id,purpose:"EMAIL_VERIFICATION",tokenHash:sha(raw),expiresAt:new Date(Date.now()+24*60*60*1000)}});
    return {user,tenant,raw};
   });
   try{await deliverToken(email,token.raw,"verify");}
   catch(error){req.log.error({err:error},"Verification email delivery failed");return reply.code(503).send({error:"Account created, but verification email could not be sent. Configure email and use resend verification."});}
   return reply.code(201).send({verificationRequired:true,message:"Check your email to verify your account.",email:token.user.email});
  }catch(error){if(error instanceof Error&&error.message==="ACCOUNT_EXISTS"||(typeof error==="object"&&error!==null&&"code" in error&&error.code==="P2002"))return reply.code(409).send({error:"Account already exists"});req.log.error({err:error},"Registration failed");return reply.code(500).send({error:"Could not create account"});}
 });
 app.post("/v1/auth/verify-email",async(req,reply)=>{
  const parsed=z.object({token:z.string().min(20).max(200)}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid verification token"});
  const record=await db.authToken.findUnique({where:{tokenHash:sha(parsed.data.token)},include:{user:true}});
  if(!record||record.purpose!=="EMAIL_VERIFICATION"||record.usedAt||record.expiresAt<=new Date())return reply.code(400).send({error:"Verification link is invalid or expired"});
  const now=new Date();const consumed=await db.$transaction(async tx=>{const claim=await tx.authToken.updateMany({where:{id:record.id,purpose:"EMAIL_VERIFICATION",usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});if(claim.count!==1)return false;await tx.user.update({where:{id:record.userId},data:{emailVerifiedAt:now}});return true;});
  if(!consumed)return reply.code(400).send({error:"Verification link is invalid, expired, or already used"});
  return {ok:true,message:"Email verified. You can now sign in."};
 });
 app.post("/v1/auth/resend-verification",async(req,reply)=>{
  if(rateLimited("resend:"+clientKey(req),3))return reply.code(429).send({error:"Too many requests. Try again later."});
  const parsed=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase())}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid email"});
  const user=await db.user.findUnique({where:{email:parsed.data.email}});
  if(user&&!user.emailVerifiedAt){try{const raw=await issueToken(db,user.id,"EMAIL_VERIFICATION",24*60*60*1000);await deliverToken(user.email,raw,"verify")}catch(e){req.log.error({err:e},"Verification email delivery failed");}}
  return {ok:true,message:"If the account requires verification, an email will be sent."};
 });
 app.post("/v1/auth/forgot-password",async(req,reply)=>{
  if(rateLimited("forgot:"+clientKey(req),3))return reply.code(429).send({error:"Too many requests. Try again later."});
  const parsed=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase())}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid email"});
  const user=await db.user.findUnique({where:{email:parsed.data.email}});
  if(user&&user.status==="ACTIVE"){const raw=await issueToken(db,user.id,"PASSWORD_RESET",60*60*1000);try{await deliverToken(user.email,raw,"reset")}catch(e){req.log.error({err:e},"Password reset email delivery failed");}}
  return {ok:true,message:"If the account exists, password reset instructions have been sent."};
 });
 app.post("/v1/auth/reset-password",async(req,reply)=>{
  if(rateLimited("reset:"+clientKey(req),5))return reply.code(429).send({error:"Too many requests. Try again later."});
  const parsed=z.object({token:z.string().min(20).max(200),password:z.string().min(10).max(128)}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid reset request. Password must contain at least 10 characters."});
  const record=await db.authToken.findUnique({where:{tokenHash:sha(parsed.data.token)}});
  if(!record||record.purpose!=="PASSWORD_RESET"||record.usedAt||record.expiresAt<=new Date())return reply.code(400).send({error:"Reset link is invalid or expired"});
  const hash=await passwordHash(parsed.data.password),now=new Date();
  const consumed=await db.$transaction(async tx=>{const claim=await tx.authToken.updateMany({where:{id:record.id,purpose:"PASSWORD_RESET",usedAt:null,expiresAt:{gt:now}},data:{usedAt:now}});if(claim.count!==1)return false;await tx.user.update({where:{id:record.userId},data:{passwordHash:hash}});await tx.session.updateMany({where:{userId:record.userId,revokedAt:null},data:{revokedAt:now}});return true;});
  if(!consumed)return reply.code(400).send({error:"Reset link is invalid, expired, or already used"});
  reply.clearCookie("funlink_session",{path:"/"});
  return {ok:true,message:"Password updated. Sign in with your new password."};
 });
 app.post("/v1/auth/login",async(req,reply)=>{
  if(rateLimited("login:"+clientKey(req),5))return reply.code(429).send({error:"Too many login attempts. Try again later."});
  const parsed=input.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid email or password"});
  const user=await db.user.findUnique({where:{email:parsed.data.email}});
  if(!user||user.status!=="ACTIVE"||!user.emailVerifiedAt||!await passwordOK(parsed.data.password,user.passwordHash))return reply.code(401).send({error:"Email or password is incorrect, or email is not verified."});
  const raw=tokenValue(),expiresAt=new Date(Date.now()+30*24*60*60*1000);
  await db.session.create({data:{userId:user.id,tokenHash:sha(raw),expiresAt}});
  reply.setCookie("funlink_session",raw,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",expires:expiresAt});
  return {user:{id:user.id,email:user.email,displayName:user.displayName}};
 });
 app.post("/v1/auth/logout",async(req,reply)=>{
  const raw=req.cookies.funlink_session;if(raw)await db.session.updateMany({where:{tokenHash:sha(raw),revokedAt:null},data:{revokedAt:new Date()}});
  reply.clearCookie("funlink_session",{path:"/"});return {ok:true};
 });
 app.get("/v1/auth/me",async(req,reply)=>{
  const raw=req.cookies.funlink_session;if(!raw)return reply.code(401).send({error:"Authentication required"});
  const session=await db.session.findUnique({where:{tokenHash:sha(raw)},include:{user:{select:{id:true,email:true,displayName:true,status:true,emailVerifiedAt:true,memberships:{include:{tenant:{select:{id:true,name:true,slug:true,status:true}}}}}}}});
  if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"||!session.user.emailVerifiedAt)return reply.code(401).send({error:"Session expired"});
  return {user:{id:session.user.id,email:session.user.email,displayName:session.user.displayName},workspaces:session.user.memberships.filter(m=>m.tenant.status==="ACTIVE").map(m=>({id:m.tenant.id,name:m.tenant.name,slug:m.tenant.slug,role:m.role}))};
 });
}
