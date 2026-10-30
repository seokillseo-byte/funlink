"use client";
import Link from "next/link";
import {useEffect,useMemo,useState} from "react";

const API=process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013";
const DEFAULT_CONTENT={heroTitle:"Mọi liên kết. Một nền tảng.",heroDescription:"Quản lý liên kết tập trung cùng FunLink.",features:[{title:"Rút gọn liên kết",description:"Tạo URL ngắn và quản lý tập trung."}]};
type Feature={title?:string;description?:string};
type HomeContent={heroTitle?:string;heroDescription?:string;features?:Feature[]};
type PageData={title:string;content:Record<string,unknown>;status:"DRAFT"|"PUBLISHED";metaTitle?:string|null;metaDescription?:string|null;canonicalUrl?:string|null;ogImageUrl?:string|null};

export default function CmsEditor(){
 const [title,T]=useState("FunLink — Nền tảng quản lý liên kết thông minh");
 const [description,D]=useState("Rút gọn URL, quản lý liên kết, tên miền riêng, mã QR và phân tích lượt nhấp trên một nền tảng.");
 const [canonical,C]=useState(""); const [ogImage,O]=useState("");
 const [json,J]=useState(JSON.stringify(DEFAULT_CONTENT,null,2));
 const [status,S]=useState<"DRAFT"|"PUBLISHED">("DRAFT");
 const [message,M]=useState("Đang tải nội dung đã lưu…");
 const [busy,B]=useState(false); const [loading,L]=useState(true); const [showPreview,P]=useState(false);
 useEffect(()=>{let active=true;(async()=>{try{const r=await fetch(API+"/v1/admin/pages/home",{credentials:"include"});const d=await r.json();if(!r.ok)throw new Error(d.error??"Không thể tải CMS");if(d.page&&active){const p=d.page as PageData;T(p.title);D(p.metaDescription??"");C(p.canonicalUrl??"");O(p.ogImageUrl??"");J(JSON.stringify(p.content,null,2));S(p.status==="PUBLISHED"?"PUBLISHED":"DRAFT");M("Đã tải nội dung CMS hiện tại.")}else if(active)M("Chưa có nội dung CMS. Bạn có thể tạo mới.")}catch(e){if(active)M(e instanceof Error?e.message:"Không thể tải CMS")}finally{if(active)L(false)}})();return()=>{active=false}},[]);
 const previewContent=useMemo<HomeContent|null>(()=>{try{const parsed=JSON.parse(json);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;return parsed as HomeContent}catch{return null}},[json]);
 async function save(e:React.FormEvent){e.preventDefault();let content:Record<string,unknown>;try{const parsed=JSON.parse(json);if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw new Error();content=parsed}catch{return M("Nội dung JSON không hợp lệ. Hãy kiểm tra lại.")}B(true);M("");try{const r=await fetch(API+"/v1/admin/pages/home",{method:"PUT",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({title,content,status,metaTitle:title,metaDescription:description,canonicalUrl:canonical||undefined,ogTitle:title,ogDescription:description,ogImageUrl:ogImage||undefined,robots:"index,follow"})});const d=await r.json();if(!r.ok)throw new Error(d.error??"Không thể lưu CMS");M("Đã lưu nội dung CMS thành công.")}catch(e){M(e instanceof Error?e.message:"Lỗi lưu nội dung")}finally{B(false)}}
 const features=previewContent?.features?.filter(x=>x&&typeof x.title==="string"&&typeof x.description==="string")??[];
 return <main className="accountPage">
  <header className="accountNav"><Link className="brand" href="/"><span className="brandmark">F</span> FunLink</Link><nav><Link href="/dashboard">Customer</Link><Link href="/profile">Profile</Link></nav></header>
  <section className="accountContent"><span className="pill">CONTENT MANAGEMENT SYSTEM</span><h1>Quản lý trang chủ</h1><p>Chỉnh sửa nội dung và metadata SEO. Dùng chế độ xem trước để kiểm tra nội dung hiện tại trước khi lưu hoặc xuất bản.</p>
   <div style={{display:"flex",gap:12,flexWrap:"wrap",margin:"20px 0"}}><button type="button" className="button" onClick={()=>P(!showPreview)}>{showPreview?"← Quay lại chỉnh sửa":"Xem trước trang chủ"}</button><span style={{alignSelf:"center",fontSize:13,color:"#64748b"}}>{showPreview?"Đây là bản xem trước từ dữ liệu đang nhập, chưa xuất bản.":"Bản xem trước không làm thay đổi nội dung đã xuất bản."}</span></div>
   {showPreview ? <section aria-label="Xem trước trang chủ" style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:18,overflow:"hidden",color:"#172033"}}>
    <header style={{padding:"22px 28px",borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}><strong>◈ FunLink</strong><span style={{fontSize:13,color:"#64748b"}}>Tính năng　 Cách hoạt động　 Bảng giá　　Đăng nhập</span></header>
    <div style={{padding:"64px 8%",background:"linear-gradient(135deg,#f8fbff,#eef4ff)"}}><span className="pill">LINK MANAGEMENT PLATFORM · PREVIEW</span><h2 style={{fontSize:"clamp(32px,5vw,54px)",lineHeight:1.1,margin:"22px 0",maxWidth:760}}>{previewContent?.heroTitle||"Mọi liên kết. Một nền tảng."}</h2><p style={{fontSize:18,lineHeight:1.7,maxWidth:680,color:"#526078"}}>{previewContent?.heroDescription||"Quản lý liên kết tập trung cùng FunLink."}</p><div style={{marginTop:28}}><span className="button">Tạo tài khoản miễn phí →</span></div></div>
    <div style={{padding:"48px 8%"}}><span className="pill">NỀN TẢNG TẤT CẢ TRONG MỘT</span><h2 style={{fontSize:30,margin:"14px 0 26px"}}>Tính năng trang chủ</h2>{features.length? <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:16}}>{features.map((f,i)=><article key={`${f.title ?? "feature"}-${i}`} style={{padding:22,border:"1px solid #e2e8f0",borderRadius:14}}><strong style={{fontSize:18}}>{f.title}</strong><p style={{color:"#64748b",lineHeight:1.6}}>{f.description}</p></article>)}</div>:<p style={{color:"#b45309"}}>Chưa có features hợp lệ. Thêm mảng features gồm title và description trong JSON.</p>}</div>
    <div style={{padding:"28px 8%",background:"#f8fafc",color:"#64748b",fontSize:13}}>© {new Date().getFullYear()} FunLink · Bản xem trước nội bộ</div>
   </section> : <form className="profileForm" onSubmit={save}>
    <label>Tiêu đề trang<input value={title} onChange={e=>T(e.target.value)} required maxLength={180}/></label>
    <label>Meta description<textarea value={description} onChange={e=>D(e.target.value)} maxLength={170}/><small>{description.length}/170 ký tự</small></label>
    <label>Canonical URL<input type="url" value={canonical} onChange={e=>C(e.target.value)}/></label>
    <label>Ảnh Open Graph<input type="url" value={ogImage} onChange={e=>O(e.target.value)}/></label>
    <label>Nội dung trang (JSON)<textarea value={json} onChange={e=>J(e.target.value)} rows={12} spellCheck={false}/></label>
    <label>Trạng thái<select value={status} onChange={e=>S(e.target.value as "DRAFT"|"PUBLISHED")}><option value="DRAFT">Bản nháp</option><option value="PUBLISHED">Xuất bản</option></select></label>
    <button className="button" disabled={busy||loading}>{loading?"Đang tải…":busy?"Đang lưu…":"Lưu nội dung CMS"}</button>{message&&<p role="status">{message}</p>}
   </form>}
  </section>
 </main>
}
