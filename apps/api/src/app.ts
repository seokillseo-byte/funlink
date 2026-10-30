import Fastify,{type FastifyInstance} from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type {ApiConfig} from "./config.js";
import type {PrismaClient} from "@prisma/client";
import {authRoutes} from "./auth.js";
import {accountRoutes} from "./account.js";

export interface ReadinessDatabase {$queryRaw<T = unknown>(query: TemplateStringsArray): Promise<T>;}
export interface BuildAppOptions {config:ApiConfig;prisma?:ReadinessDatabase;logger?:boolean;}
export function buildApp(options:BuildAppOptions):FastifyInstance {
 const app=Fastify({logger:options.logger??options.config.NODE_ENV!=="test"});
 const origins=(process.env.CORS_ORIGINS??"http://localhost:3014").split(",").map(s=>s.trim()).filter(Boolean);
 app.register(cors,{origin:origins,credentials:true});
 app.register(cookie);
 // Cookie-authenticated state changes must originate from an explicitly allowed browser origin.
 // Requests without Origin remain available for server-to-server clients; they still require auth.
 app.addHook("onRequest",async(req,reply)=>{
  if(!["POST","PUT","PATCH","DELETE"].includes(req.method))return;
  const origin=req.headers.origin;
  if(origin&&!origins.includes(origin))return reply.code(403).send({error:"Request origin is not allowed"});
 });
 app.get("/health",async()=>({status:"ok",service:"funlink-api"}));
 app.get("/ready",async(_q,r)=>{
  if(!options.prisma)return r.code(503).send({status:"not_ready",checks:{database:"not_configured"}});
  try {await options.prisma.$queryRaw`SELECT 1`;return {status:"ready",checks:{database:"ok"}};}
  catch(error:unknown){app.log.error({err:error},"Database readiness failed");return r.code(503).send({status:"not_ready",checks:{database:"error"}});}
 });
 if(options.prisma){authRoutes(app,options.prisma as unknown as PrismaClient);accountRoutes(app,options.prisma as unknown as PrismaClient);}
 app.setErrorHandler((error:unknown,_q,r)=>{
  app.log.error({err:error},"Unhandled API error");
  const statusCode=typeof error==="object"&&error!==null&&"statusCode" in error&&typeof error.statusCode==="number"&&error.statusCode>=400&&error.statusCode<600?error.statusCode:500;
  return r.code(statusCode).send({error:statusCode>=500?"Internal server error":error instanceof Error?error.message:"Request failed"});
 });
 return app;
}