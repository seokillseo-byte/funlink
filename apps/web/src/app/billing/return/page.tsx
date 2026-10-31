"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013";
type Result={status:string;provider:string;invoice:{number:string;status:string}};
export default function BillingReturn(){
 const [message,Message]=useState("Đang kiểm tra trạng thái thanh toán…");
 const [status,Status]=useState("");
 const [attempt,Attempt]=useState("");
 useEffect(()=>{
  let active=true;
  const params=new URLSearchParams(window.location.search);
  const id=params.get("payment_attempt")??"";
  const orderId=params.get("token")??"";
  Attempt(id);
  if(!id){Message("Thiếu mã giao dịch. Hãy mở lại trang thanh toán từ workspace.");return;}
  async function run(){
   try{
    const auth=await fetch(API+"/v1/auth/me",{credentials:"include"});
    if(auth.status===401){window.location.href="/login?returnTo="+encodeURIComponent("/billing/return?"+params.toString());return;}
    if(!auth.ok)throw new Error("Không thể xác thực phiên đăng nhập.");
    const authData=await auth.json();
    const workspaceId=params.get("workspace")??authData.workspaces?.[0]?.id;
    if(!workspaceId)throw new Error("Không tìm thấy workspace của giao dịch.");
    if(orderId){
     const capture=await fetch(API+"/v1/workspaces/"+encodeURIComponent(workspaceId)+"/payment-attempts/"+encodeURIComponent(id)+"/paypal/capture",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({orderId})});
     if(capture.status===401){window.location.href="/login";return;}
     // Capture may already have been completed; the signed webhook remains authoritative.
    }
    for(let i=0;i<12&&active;i++){
     const me=await fetch(API+"/v1/auth/me",{credentials:"include"});
     const meData=await me.json();
     const currentWorkspaceId=params.get("workspace")??meData.workspaces?.[0]?.id;
     if(!currentWorkspaceId)throw new Error("Không tìm thấy workspace để tra cứu giao dịch.");
     const response=await fetch(API+"/v1/workspaces/"+encodeURIComponent(currentWorkspaceId)+"/payment-attempts/"+encodeURIComponent(id),{credentials:"include"});
     const data=await response.json();
     if(!response.ok)throw new Error(data.error??"Không thể tra cứu giao dịch.");
     const payment=data.paymentAttempt as Result;
     Status(payment.status);
     if(payment.status==="SUCCEEDED"){Message("Thanh toán đã được xác nhận. Hóa đơn "+payment.invoice.number+" đã cập nhật.");return;}
     if(payment.status==="FAILED"||payment.status==="CANCELED"){Message("Giao dịch không thành công. Hãy quay lại workspace để thử phương thức khác.");return;}
     Message("Nhà cung cấp đã chuyển hướng về FunLink. Hệ thống đang chờ webhook xác thực; vui lòng không thanh toán lại trong lúc chờ.");
     await new Promise(resolve=>setTimeout(resolve,2500));
    }
    if(active)Message("Giao dịch vẫn đang chờ xác nhận. Bạn có thể quay lại workspace và làm mới trạng thái sau ít phút.");
   }catch(error){if(active)Message(error instanceof Error?error.message:"Không thể kiểm tra giao dịch.");}
  }
  void run();
  return()=>{active=false};
 },[]);
 return <main className="authPage"><Link className="brand" href="/"><span className="brandmark">F</span> FunLink</Link><section className="authCard"><span className="pill">PAYMENT STATUS</span><h1>Trạng thái thanh toán</h1><p role="status">{message}</p>{status&&<p><b>Trạng thái:</b> {status}</p>}{attempt&&<p style={{fontSize:12,color:"#7c879a"}}>Mã giao dịch: {attempt}</p>}<Link className="button" href="/dashboard">Quay lại workspace</Link></section></main>;
}
