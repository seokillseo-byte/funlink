"use client";
import Link from "next/link";
import {useSearchParams} from "next/navigation";
import {Suspense,useState} from "react";
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013";
function ResendForm(){const params=useSearchParams();const [email,E]=useState(params.get("email")??"");const [message,M]=useState("");const [busy,B]=useState(false);
 async function submit(e:React.FormEvent){e.preventDefault();B(true);M("");try{const r=await fetch(API+"/v1/auth/resend-verification",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Không thể gửi email");M(d.message??"Nếu tài khoản cần xác minh, email sẽ được gửi.");}catch(e){M(e instanceof Error?e.message:"Có lỗi xảy ra");}finally{B(false)}}
 return <main className="authPage"><section className="authCard"><span className="pill">FUNLINK WORKSPACE</span><h1>Gửi lại email xác minh</h1><p>Nhập địa chỉ email đã dùng khi đăng ký. Nếu tài khoản chưa được xác minh, chúng tôi sẽ gửi liên kết mới.</p><form onSubmit={submit}><label>Email<input type="email" required maxLength={254} value={email} onChange={e=>E(e.target.value)} autoComplete="email"/></label><button className="button full" disabled={busy}>{busy?"Đang gửi…":"Gửi lại email xác minh"}</button></form>{message&&<p role="status">{message}</p>}<Link href="/login">← Quay lại đăng nhập</Link></section></main>}
export default function ResendVerification(){return <Suspense fallback={<main className="authPage"><section className="authCard">Đang tải…</section></main>}><ResendForm/></Suspense>}
