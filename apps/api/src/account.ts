import {createHash} from "node:crypto";
import type {FastifyInstance} from "fastify";
import {Prisma,type PrismaClient} from "@prisma/client";
import {z} from "zod";
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
async function currentUser(req:any,db:PrismaClient){const token=req.cookies?.funlink_session;if(!token)return null;const s=await db.session.findUnique({where:{tokenHash:sha(token)},include:{user:true}});if(!s||s.revokedAt||s.expiresAt<=new Date()||s.user.status!=="ACTIVE"||!s.user.emailVerifiedAt)return null;return s.user;}
async function isCmsAdmin(req:any,db:PrismaClient){const user=await currentUser(req,db);if(!user)return {user:null,allowed:false};const allow=(process.env.FUNLINK_CMS_ADMIN_EMAILS??"").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);return {user,allowed:allow.includes(user.email.toLowerCase())};}
const pageFields={slug:true,title:true,content:true,metaTitle:true,metaDescription:true,canonicalUrl:true,ogTitle:true,ogDescription:true,ogImageUrl:true,robots:true,schemaJson:true,status:true,publishedAt:true,updatedAt:true} as const;
const tenantParams=z.object({tenantId:z.string().min(1).max(64)});
async function tenantMembership(req:any,db:PrismaClient,tenantId:string){
 const token=req.cookies?.funlink_session;if(!token)return null;
 const session=await db.session.findUnique({where:{tokenHash:sha(token)},include:{user:{select:{id:true,status:true,emailVerifiedAt:true,memberships:{where:{tenantId},include:{tenant:{select:{id:true,name:true,slug:true,status:true}}}}}}}});
 if(!session||session.revokedAt||session.expiresAt<=new Date()||session.user.status!=="ACTIVE"||!session.user.emailVerifiedAt)return null;
 const membership=session.user.memberships[0];
 if(!membership||membership.tenant.status!=="ACTIVE")return null;
 return {userId:session.user.id,role:membership.role,tenant:membership.tenant};
}
export function accountRoutes(app:FastifyInstance,db:PrismaClient){
 app.get("/v1/users/me",async(req,reply)=>{const user=await currentUser(req,db);if(!user)return reply.code(401).send({error:"Authentication required"});const p=await db.userProfile.upsert({where:{userId:user.id},create:{userId:user.id},update:{}});return {profile:{displayName:user.displayName??"",phone:p.phone??"",company:p.company??"",jobTitle:p.jobTitle??"",website:p.website??"",location:p.location??"",bio:p.bio??"",avatarUrl:p.avatarUrl??"",timezone:p.timezone,locale:p.locale}};});
 app.patch("/v1/users/me",async(req,reply)=>{const user=await currentUser(req,db);if(!user)return reply.code(401).send({error:"Authentication required"});const parsed=z.object({displayName:z.string().trim().min(2).max(80),phone:z.string().trim().max(30).optional().default(""),company:z.string().trim().max(120).optional().default(""),jobTitle:z.string().trim().max(100).optional().default(""),website:z.string().url().max(300).or(z.literal("")).optional().default(""),location:z.string().trim().max(160).optional().default(""),bio:z.string().trim().max(500).optional().default(""),avatarUrl:z.string().url().max(500).or(z.literal("")).optional().default(""),timezone:z.string().max(80).optional(),locale:z.string().max(20).optional()}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid profile details"});const d=parsed.data;const p=await db.$transaction(async tx=>{await tx.user.update({where:{id:user.id},data:{displayName:d.displayName}});return tx.userProfile.upsert({where:{userId:user.id},create:{userId:user.id,phone:d.phone,company:d.company,jobTitle:d.jobTitle,website:d.website,location:d.location,bio:d.bio,avatarUrl:d.avatarUrl,timezone:d.timezone,locale:d.locale},update:{phone:d.phone,company:d.company,jobTitle:d.jobTitle,website:d.website,location:d.location,bio:d.bio,avatarUrl:d.avatarUrl,...(d.timezone?{timezone:d.timezone}:{}),...(d.locale?{locale:d.locale}:{})}})});return {profile:{displayName:d.displayName,phone:p.phone??"",company:p.company??"",jobTitle:p.jobTitle??"",website:p.website??"",location:p.location??"",bio:p.bio??"",avatarUrl:p.avatarUrl??"",timezone:p.timezone,locale:p.locale}};});
 app.get("/v1/workspaces/:tenantId",async(req,reply)=>{
  const {tenantId}=tenantParams.parse(req.params);
  const access=await tenantMembership(req,db,tenantId);
  if(!access)return reply.code(404).send({error:"Workspace not found"});
  return {workspace:{...access.tenant,role:access.role}};
 });
 app.get("/v1/workspaces/:tenantId/members",async(req,reply)=>{
  const {tenantId}=tenantParams.parse(req.params);
  const access=await tenantMembership(req,db,tenantId);
  if(!access)return reply.code(404).send({error:"Workspace not found"});
  if(!["OWNER","ADMIN"].includes(access.role))return reply.code(403).send({error:"Workspace administrator access required"});
  const members=await db.tenantMember.findMany({where:{tenantId},orderBy:{createdAt:"asc"},select:{id:true,role:true,createdAt:true,user:{select:{id:true,email:true,displayName:true,status:true,emailVerifiedAt:true}}}});
  return {members};
 });

 app.get("/v1/workspaces/:tenantId/invitations",async(req,reply)=>{
  const {tenantId}=tenantParams.parse(req.params);
  const access=await tenantMembership(req,db,tenantId);
  if(!access)return reply.code(404).send({error:"Workspace not found"});
  if(!["OWNER","ADMIN"].includes(access.role))return reply.code(403).send({error:"Workspace administrator access required"});
  const invitations=await db.workspaceInvitation.findMany({where:{tenantId,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:"desc"},select:{id:true,email:true,role:true,expiresAt:true,createdAt:true}});
  return {invitations};
 });
 app.post("/v1/workspaces/:tenantId/invitations",async(req,reply)=>{
  const {tenantId}=tenantParams.parse(req.params);
  const access=await tenantMembership(req,db,tenantId);
  if(!access)return reply.code(404).send({error:"Workspace not found"});
  if(!["OWNER","ADMIN"].includes(access.role))return reply.code(403).send({error:"Workspace administrator access required"});
  const parsed=z.object({email:z.string().email().max(254).transform(v=>v.toLowerCase()),role:z.enum(["MEMBER","BILLING","VIEWER"]).default("MEMBER")}).safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:"Invalid invitation details"});
  const {email,role}=parsed.data;
  const existing=await db.user.findUnique({where:{email},select:{id:true,memberships:{where:{tenantId},select:{id:true}}}});
  if(existing?.memberships.length)return reply.code(409).send({error:"This user is already a workspace member"});
  const pending=await db.workspaceInvitation.findFirst({where:{tenantId,email,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}},select:{id:true}});
  if(pending)return reply.code(409).send({error:"An active invitation already exists for this email"});
  const raw=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+7*24*60*60*1000);
  const invitation=await db.workspaceInvitation.create({data:{tenantId,email,role,tokenHash:sha(raw),invitedById:access.userId,expiresAt},select:{id:true,email:true,role:true,expiresAt:true,createdAt:true}});
  const base=process.env.APP_BASE_URL,apiKey=process.env.RESEND_API_KEY,from=process.env.EMAIL_FROM;
  if(!base||!apiKey||!from){req.log.error("Workspace invitation email is not configured");return reply.code(503).send({error:"Invitation saved, but email delivery is not configured. Configure email and retry after revoking this invitation."});}
  const url=new URL("/accept-invitation",base);url.searchParams.set("token",raw);
  const sent=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({from,to:email,subject:"Lời mời tham gia workspace FunLink",html:`<p>Bạn được mời tham gia workspace ${access.tenant.name} với vai trò ${role}.</p><p><a href="${url.toString()}">Chấp nhận lời mời</a></p><p>Lời mời có hiệu lực trong 7 ngày.</p>`})});
  if(!sent.ok){req.log.error({status:sent.status},"Workspace invitation email delivery failed");return reply.code(503).send({error:"Invitation saved, but email delivery failed. Revoke it and try again after checking email settings."});}
  return reply.code(201).send({invitation});
 });
 app.delete("/v1/workspaces/:tenantId/invitations/:invitationId",async(req,reply)=>{
  const {tenantId}=tenantParams.parse(req.params);
  const {invitationId}=z.object({invitationId:z.string().min(1).max(64)}).parse(req.params);
  const access=await tenantMembership(req,db,tenantId);
  if(!access)return reply.code(404).send({error:"Workspace not found"});
  if(!["OWNER","ADMIN"].includes(access.role))return reply.code(403).send({error:"Workspace administrator access required"});
  const changed=await db.workspaceInvitation.updateMany({where:{id:invitationId,tenantId,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
  if(!changed.count)return reply.code(404).send({error:"Invitation not found"});
  return {ok:true};
 });
 app.post("/v1/workspace-invitations/accept",async(req,reply)=>{
  const user=await currentUser(req,db);
  if(!user)return reply.code(401).send({error:"Authentication required"});
  const parsed=z.object({token:z.string().min(20).max(200)}).safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({error:"Invalid invitation token"});
  const invitation=await db.workspaceInvitation.findUnique({where:{tokenHash:sha(parsed.data.token)},include:{tenant:{select:{id:true,status:true}}}});
  const now=new Date();
  if(!invitation||invitation.acceptedAt||invitation.revokedAt||invitation.expiresAt<=now||invitation.tenant.status!=="ACTIVE")return reply.code(400).send({error:"Invitation is invalid or expired"});
  if(user.email.toLowerCase()!==invitation.email.toLowerCase())return reply.code(403).send({error:"Sign in with the email address that received this invitation"});
  const accepted=await db.$transaction(async tx=>{
   const claim=await tx.workspaceInvitation.updateMany({where:{id:invitation.id,acceptedAt:null,revokedAt:null,expiresAt:{gt:now}},data:{acceptedAt:now}});
   if(claim.count!==1)return false;
   await tx.tenantMember.upsert({where:{tenantId_userId:{tenantId:invitation.tenantId,userId:user.id}},create:{tenantId:invitation.tenantId,userId:user.id,role:invitation.role},update:{}});
   return true;
  });
  if(!accepted)return reply.code(409).send({error:"Invitation has already been used or revoked"});
  return {ok:true,tenantId:invitation.tenantId,message:"Workspace invitation accepted"};
 });
 app.get("/v1/public/pages/:slug",async(req,reply)=>{const {slug}=req.params as {slug:string};const page=await db.sitePage.findFirst({where:{slug,status:"PUBLISHED",publishedAt:{lte:new Date()}},select:pageFields});if(!page)return reply.code(404).send({error:"Page not found"});return {page};});
 app.get("/v1/admin/pages/:slug",async(req,reply)=>{const access=await isCmsAdmin(req,db);if(!access.user)return reply.code(401).send({error:"Authentication required"});if(!access.allowed)return reply.code(403).send({error:"Platform admin access required"});const {slug}=req.params as {slug:string};const page=await db.sitePage.findUnique({where:{slug},select:pageFields});return {page};});
 app.put("/v1/admin/pages/:slug",async(req,reply)=>{const access=await isCmsAdmin(req,db);if(!access.user)return reply.code(401).send({error:"Authentication required"});if(!access.allowed)return reply.code(403).send({error:"Platform admin access required"});const {slug}=req.params as {slug:string};const parsed=z.object({title:z.string().trim().min(1).max(180),content:z.record(z.string(),z.unknown()),status:z.enum(["DRAFT","PUBLISHED","SCHEDULED","ARCHIVED"]),metaTitle:z.string().max(70).optional().nullable(),metaDescription:z.string().max(170).optional().nullable(),canonicalUrl:z.string().url().optional().nullable(),ogTitle:z.string().max(100).optional().nullable(),ogDescription:z.string().max(200).optional().nullable(),ogImageUrl:z.string().url().optional().nullable(),robots:z.string().max(80).optional(),schemaJson:z.record(z.string(),z.unknown()).optional()}).safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:"Invalid page content or SEO fields"});const d=parsed.data;const existing=await db.sitePage.findUnique({where:{slug},select:{publishedAt:true}});const publishedAt=d.status==="PUBLISHED"?(existing?.publishedAt??new Date()):null;const page=await db.sitePage.upsert({where:{slug},create:{slug,title:d.title,content:d.content as Prisma.InputJsonValue,status:d.status,metaTitle:d.metaTitle,metaDescription:d.metaDescription,canonicalUrl:d.canonicalUrl,ogTitle:d.ogTitle,ogDescription:d.ogDescription,ogImageUrl:d.ogImageUrl,robots:d.robots,schemaJson:d.schemaJson as Prisma.InputJsonValue|undefined,publishedAt},update:{title:d.title,content:d.content as Prisma.InputJsonValue,status:d.status,metaTitle:d.metaTitle,metaDescription:d.metaDescription,canonicalUrl:d.canonicalUrl,ogTitle:d.ogTitle,ogDescription:d.ogDescription,ogImageUrl:d.ogImageUrl,robots:d.robots,schemaJson:d.schemaJson as Prisma.InputJsonValue|undefined,publishedAt}});return {page};});
}
