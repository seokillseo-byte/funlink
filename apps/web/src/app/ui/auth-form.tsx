"use client";
import Link from "next/link";
import {useState} from "react";
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013";
export default function AuthForm({mode}:{mode:"login"|"register"}){
 const [email,E]=useState(""),[password,P]=useState(""),[displayName,N]=useState(""),[workspaceName,W]=useState(""),[error,S]=useState(""),[verificationEmail,V]=useState(""),[busy,B]=useState(false);
 async function submit(e:React.FormEvent){
  e.preventDefault();B(true);S("");
  try{
   const r=await fetch(API+"/v1/auth/"+(mode==="login"?"login":"register"),{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify(mode==="login"?{email,password}:{email,password,displayName,workspaceName:workspaceName||undefined})});
   const data=await r.json();
   if(!r.ok)throw new Error(data.error??"Không thể xác thực");
   if(mode==="register"&&data.verificationRequired){V(data.email??email);S("Tài khoản đã được tạo. Hãy kiểm tra email và xác minh trước khi đăng nhập.");return;}
   location.href="/dashboard";
  }catch(e){S(e instanceof Error?e.message:"Không thể kết nối API")}finally{B(false)}
 }
 return <main className="authPage"><Link className="brand" href="/"><span className="brandmark">F</span> FunLink</Link><section className="authCard"><span className="pill">FUNLINK WORKSPACE</span><h1>{mode==="login"?"Chào mừng trở lại":"Tạo tài khoản FunLink"}</h1><p>{mode==="login"?"Đăng nhập để tiếp tục quản lý liên kết.":"Bắt đầu với workspace riêng của bạn."}</p><form onSubmit={submit}>{mode==="register"&&<label>Họ và tên<input required minLength={2} maxLength={80} value={displayName} onChange={e=>N(e.target.value)}/></label>}<label>Email<input type="email" required maxLength={254} value={email} onChange={e=>E(e.target.value)} autoComplete="email"/></label><label>Mật khẩu<input type="password" required minLength={10} maxLength={128} value={password} onChange={e=>P(e.target.value)} autoComplete={mode==="login"?"current-password":"new-password"}/></label>{mode==="register"&&<label>Tên workspace (không bắt buộc)<input maxLength={80} value={workspaceName} onChange={e=>W(e.target.value)}/></label>}<button className="button full" disabled={busy}>{busy?"Đang xử lý…":mode==="login"?"Đăng nhập":"Tạo tài khoản"}</button></form>{error&&<p role="alert" className="formError">{error}</p>}{verificationEmail&&<p role="status">Email xác minh được gửi tới {verificationEmail}. Nếu chưa nhận được, <Link href={"/resend-verification?email="+encodeURIComponent(verificationEmail)}>gửi lại email xác minh</Link>.</p>}{mode==="login"&&<Link href="/forgot-password">Quên mật khẩu?</Link>}<div className="authSwitch">{mode==="login"?<>Chưa có tài khoản? <Link href="/register">Đăng ký</Link></>:<>Đã có tài khoản? <Link href="/login">Đăng nhập</Link></>}</div><Link href="/">← Trở về trang chủ</Link></section></main>
}