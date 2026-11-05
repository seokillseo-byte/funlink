"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

const items = [
  {href:"/dashboard",label:"Tổng quan",icon:"⌂"},
  {href:"/dashboard/links",label:"Liên kết của tôi",icon:"↗"},
  {href:"/dashboard/domains",label:"Tên miền tùy chỉnh",icon:"◎"},
  {href:"/billing/plans",label:"Gói dịch vụ & hạn mức",icon:"✦"},
  {href:"/profile",label:"Hồ sơ cá nhân",icon:"◉"}
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  async function logout() {
    try {
      await fetch((process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3013") + "/v1/auth/logout", {
        method:"POST", credentials:"include"
      });
    } finally {
      window.location.href="/login";
    }
  }
  return <aside className="dashboardSidebar">
    <Link className="dashboardBrand" href="/dashboard" aria-label="FunLink - Tổng quan">
      <span className="dashboardBrandMark">F</span><span>FunLink</span>
    </Link>
    <div className="sidebarCaption">WORKSPACE</div>
    <nav className="dashboardMenu" aria-label="Điều hướng dashboard">
      {items.map(item => {
        const active = item.href === "/dashboard"
          ? pathname === "/dashboard"
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return <Link key={item.href} href={item.href} className={active ? "dashboardMenuLink active" : "dashboardMenuLink"} aria-current={active ? "page" : undefined}>
          <span className="dashboardMenuIcon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
        </Link>;
      })}
    </nav>
    <div className="sidebarBottom">
      <div className="sidebarUpgrade">
        <span className="sidebarUpgradeIcon">✦</span>
        <strong>Mở rộng cùng FunLink</strong>
        <p>Các công cụ nâng cao sẽ được bổ sung theo lộ trình.</p>
        <span className="sidebarComingSoon">TÍNH NĂNG ĐANG PHÁT TRIỂN</span>
      </div>
      <button className="sidebarLogout" type="button" onClick={logout}><span aria-hidden="true">↪</span> Đăng xuất</button>
    </div>
  </aside>;
}
