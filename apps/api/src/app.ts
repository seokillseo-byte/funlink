import Fastify,{type FastifyInstance} from "fastify";
import cookie from "@fastify/cookie";
import type {ApiConfig} from "./config.js";
import type {PrismaClient} from "@prisma/client";
import {authRoutes} from "./auth.js";
export interface ReadinessDatabase{$queryRaw<T=unknown>(query:TemplateStringsArray):Promise<T>}
export interface BuildAppOptions{config:ApiConfig;prisma?:(ReadinessDatabase&Partial<PrismaClient>);logger?:boolean}
export function buildApp(options:BuildAppOptions):FastifyInstance{const app=Fastify({logger:options.logger??options.config.NODE_ENV!=="test"});app.register(cookie);app.get("/health",async()=>({status:"ok",service:"funlink-api"}));app.get("/ready",async(_q,r)=>{if(!options.prisma)return r.code(503).send({status:"not_ready",checks:{database:"not_configured"}});try{await options.prisma.$queryRaw`SELECT 1`;return {status:"ready",checks:{database:"ok"}}}catch(e){app.log.error({err:e},"Database readiness failed");return r.code(503).send({status:"not_ready",checks:{database:"error"}})}});if(options.prisma)authRoutes(app,options.prisma as PrismaClient);app.setErrorHandler((e,_q,r)=>{app.log.error({err:e},"Unhandled API error");const s=(e as Error&{statusCode?:number}).statusCode??500;return r.code(s).send({error:s>=500?"Internal server error":e.message})});return app}