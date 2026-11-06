"use client";
import Link from "next/link";
import {usePathname} from "next/navigation";
const groups=[
 {label:"WORKSPACE",items:[["/dashboard","Tổng quan","⌂"],["/dashboard/links","Liên kết của tôi","↗"],["/dashboard/campaigns","Chiến dịch","▤"],["/dashboard/qr","QR Codes","▦"],["/dashboard/domains","Tên miền tùy chỉnh","◎"]]},
 {label:"ANALYTICS",items:[["/dashboard/analytics","Phân tích","▥"],["/dashboard/clicks","Lịch sử click","⌁"]]},
 {label:"BUSINESS",items:[["/billing/plans","Gói dịch vụ & hạn mức","✦"],["/billing/invoices","Thanh toán & hóa đơn","▣"],["/dashboard/members","Thành viên workspace","♙"],["/dashboard/settings","Cài đặt workspace","⚙"]]},
 {label:"DEVELOPER",items:[["/dashboard/developer/api-keys","API Keys","⌘"],["/dashboard/developer/webhooks","Webhooks","⇄"],["/dashboard/developer/docs","Tài liệu API","▧"]]},
 {label:"ACCOUNT",items:[["/profile","Hồ sơ cá nhân","◉"],["/profile/security","Bảo mật tài khoản","♢"]]}
];
export default function DashboardSidebar(){const pathname=usePathname();async function logout(){try{await fetch((process.env.NEXT_PUBLIC_API_URL??"http://localhost:3013")+"/v1/auth/logout",{method:"POST",credentials:"include"})}finally{window.location.href="/login"}}
return <aside className="dashboardSidebar"><Link className="dashboardBrand" href="/dashboard" aria-label="FunLink - Tổng quan"><span className="dashboardBrandMark">F</span><span>FunLink</span></Link><nav className="dashboardMenu" aria-label="Điều hướng dashboard">{groups.map(g=><div className="sidebarGroup" key={g.label}><div className="sidebarCaption">{g.label}</div>{g.items.map(([href,label,icon])=>{const active=href==="/dashboard"?pathname==="/dashboard":pathname===href||pathname.startsWith(href+"/");return <Link key={href} href={href} className={active?"dashboardMenuLink active":"dashboardMenuLink"} aria-current={active?"page":undefined}><span className="dashboardMenuIcon" aria-hidden="true">{icon}</span><span>{label}</span></Link>})}</div>)}</nav><div className="sidebarBottom"><div className="sidebarUpgrade"><span className="sidebarUpgradeIcon">✦</span><strong>Mở rộng cùng FunLink</strong><p>Các công cụ nâng cao đang được hoàn thiện theo lộ trình.</p><span className="sidebarComingSoon">FUNLINK WORKSPACE</span></div><button className="sidebarLogout" type="button" onClick={logout}><span aria-hidden="true">↪</span> Đăng xuất</button></div></aside>}
