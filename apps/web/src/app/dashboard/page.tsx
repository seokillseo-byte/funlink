"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013";
type Workspace={id:string;name:string;slug:string;role:string};
type Me={user:{id:string;email:string;displayName:string|null};workspaces:Workspace[]};
export default function Dashboard(){
 const [me,S]=useState<Me|null>(null),[error,E]=useState("");
 useEffect(()=>{let active=true;fetch(API+"/v1/auth/me",{credentials:"include"}).then(async r=>{if(r.status===401){location.href="/login";return null}if(!r.ok)throw new Error("Không thể tải tài khoản");return r.json()}).then(d=>{if(active&&d)S(d)}).catch(e=>{if(active)E(e instanceof Error?e.message:"Có lỗi xảy ra")});return()=>{active=false}},[]);
 async function logout(){try{await fetch(API+"/v1/auth/logout",{method:"POST",credentials:"include"})}finally{location.href="/"}}
 const workspace=me?.workspaces?.[0];
 return <main className="accountPage"><header className="accountNav"><Link className="brand" href="/"><span className="brandmark">F</span> FunLink</Link><nav><Link href="/dashboard">Tổng quan</Link><Link href="/profile">Profile</Link></nav><button onClick={logout}>Đăng xuất</button></header><section className="accountContent"><span className="pill">CUSTOMER WORKSPACE</span><h1>Xin chào{me?.user?.displayName?", "+me.user.displayName:""}!</h1><p>{me?.user?.email??(error||"Đang tải tài khoản…")}</p><div className="accountTiles"><article><b>Workspace</b><span>{workspace?.name??(me?"Chưa có workspace":"Đang tải…")}</span></article><article><b>Vai trò</b><span>{workspace?.role??"—"}</span></article><article><b>Hồ sơ cá nhân</b><span>Cập nhật thông tin tài khoản</span><Link href="/profile">Quản lý Profile →</Link></article></div></section></main>
}