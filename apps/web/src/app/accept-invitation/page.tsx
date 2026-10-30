"use client";
import Link from "next/link";
import {useState} from "react";
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013";
export default function AcceptInvitation(){
 const [message,M]=useState("Đang kiểm tra lời mời…"),[busy,B]=useState(false);
 async function accept(){
  const token=new URLSearchParams(location.search).get("token");
  if(!token){M("Liên kết lời mời không hợp lệ.");return;}
  B(true);M("");
  try{
   const r=await fetch(API+"/v1/workspace-invitations/accept",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({token})});
   const d=await r.json();if(r.status===401){M("Bạn cần đăng nhập bằng email đã nhận lời mời trước khi chấp nhận.");return;}
   if(!r.ok)throw new Error(d.error??"Không thể chấp nhận lời mời");
   M("Bạn đã tham gia workspace thành công.");
  }catch(e){M(e instanceof Error?e.message:"Có lỗi xảy ra");}finally{B(false);}
 }
 return <main className="authPage"><section className="authCard"><span className="pill">FUNLINK WORKSPACE</span><h1>Chấp nhận lời mời</h1><p>{message}</p><button className="button full" disabled={busy} onClick={accept}>{busy?"Đang xử lý…":"Chấp nhận lời mời"}</button><Link href="/login">Đăng nhập</Link></section></main>
}
