"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import DashboardSidebar from "../../../components/dashboard-sidebar";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3013";
type Plan = {
  id: string; code: "FREE" | "STARTER" | "PRO" | "AGENCY"; name: string;
  priceMinor: number; currency: string; interval: string;
  entitlements: { linksPerMonth: number; trackedClicksPerMonth: number; qrPerMonth: number; customDomains: number; retentionDays: number; seats: number; features: string[] };
};
type Workspace = { id: string; name: string; role: string };
type Billing = {
  plan: Plan; subscription: { id: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  periodStart: string; periodEnd: string;
  usage: { links: { used: number; limit: number }; trackedClicks: { used: number; limit: number }; customDomains: { used: number; limit: number }; seats: { used: number; limit: number }; qr: { used: number; limit: number; available: boolean } };
  invoices: Array<{ id: string; number: string; status: string; amountMinor: number; currency: string; createdAt: string }>;
};
const money = (amount: number) => amount === 0 ? "Miễn phí" : new Intl.NumberFormat("vi-VN").format(amount) + "đ";
const fmt = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString("vi-VN") : "—";
const limit = (value: number) => new Intl.NumberFormat("vi-VN").format(value);

export default function BillingPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadBilling(id: string) {
    const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(id) + "/billing", { credentials: "include" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Không thể tải thông tin gói dịch vụ");
    setBilling(data);
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(API + "/v1/plans").then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Không tải được bảng giá"); return data.plans as Plan[]; }),
      fetch(API + "/v1/auth/me", { credentials: "include" }).then(async response => { if (response.status === 401) { window.location.href = "/login"; return null; } const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Không xác thực được tài khoản"); return data; })
    ]).then(async ([catalog, me]) => {
      if (!active || !me) return;
      setPlans(catalog);
      const saved = window.localStorage.getItem("funlink_active_workspace");
      const selected = me.workspaces?.find((item: Workspace) => item.id === saved) ?? me.workspaces?.[0];
      if (!selected) throw new Error("Tài khoản chưa có workspace.");
      setWorkspace(selected);
      window.localStorage.setItem("funlink_active_workspace", selected.id);
      await loadBilling(selected.id);
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Không thể tải dữ liệu billing"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const currentCode = billing?.plan.code;
  const canBill = workspace && ["OWNER", "ADMIN", "BILLING"].includes(workspace.role);

  async function choosePlan(plan: Plan) {
    if (!workspace) return;
    if (!canBill) { setError("Bạn cần quyền OWNER, ADMIN hoặc BILLING để thay đổi gói."); return; }
    if (plan.code === currentCode) return;
    setBusy(plan.code); setError(""); setMessage("");
    try {
      const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspace.id) + "/subscriptions", {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode: plan.code })
      });
      const created = await response.json();
      if (!response.ok) throw new Error(created.error ?? "Không thể đăng ký gói");
      if (!created.paymentRequired) {
        await loadBilling(workspace.id);
        setMessage("Đã chuyển workspace sang gói Free.");
        return;
      }
      setMessage("Đã tạo hóa đơn " + created.invoice.number + ". Đang khởi tạo thanh toán VNPay…");
      const checkout = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspace.id) + "/invoices/" + encodeURIComponent(created.invoice.id) + "/checkout", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ provider: "vnpay" })
      });
      const checkoutData = await checkout.json();
      if (!checkout.ok) {
        setMessage("Hóa đơn " + created.invoice.number + " đã được tạo và vẫn đang chờ thanh toán. " + (checkoutData.error ?? "Cổng thanh toán chưa sẵn sàng.") + " Bạn có thể thử lại từ khu vực Thanh toán.");
        await loadBilling(workspace.id);
        return;
      }
      if (typeof checkoutData.checkoutUrl !== "string") throw new Error("Cổng thanh toán không trả về đường dẫn hợp lệ.");
      window.location.assign(checkoutData.checkoutUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không thể đăng ký gói");
      await loadBilling(workspace.id).catch(() => undefined);
    } finally { setBusy(""); }
  }

  async function cancelRenewal() {
    if (!workspace) return;
    setBusy("cancel"); setError(""); setMessage("");
    try {
      const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspace.id) + "/subscription/cancel", { method: "POST", credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể yêu cầu hủy gia hạn");
      await loadBilling(workspace.id);
      setMessage("Đã tắt gia hạn. Gói hiện tại vẫn có hiệu lực đến " + fmt(data.subscription.currentPeriodEnd) + ".");
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể hủy gia hạn"); }
    finally { setBusy(""); }
  }

  const planOrder = useMemo(() => ["FREE", "STARTER", "PRO", "AGENCY"], []);
  const featureRows = [
    { label: "Link mới mỗi tháng", value: (p: Plan) => limit(p.entitlements.linksPerMonth) },
    { label: "Click được phân tích / tháng", value: (p: Plan) => limit(p.entitlements.trackedClicksPerMonth) },
    { label: "Tên miền tùy chỉnh", value: (p: Plan) => limit(p.entitlements.customDomains) },
    { label: "Mã QR / tháng", value: (p: Plan) => limit(p.entitlements.qrPerMonth) + " · sắp ra mắt" },
    { label: "Lưu dữ liệu phân tích", value: (p: Plan) => p.entitlements.retentionDays + " ngày" },
    { label: "Thành viên workspace", value: (p: Plan) => limit(p.entitlements.seats) }
  ];

  return <main className="accountPage"><DashboardSidebar /><section className="accountContent billingPage">
    <div className="billingHeading"><div><span className="pill">FUNLINK SUBSCRIPTION</span><h1>Gói dịch vụ & hạn mức</h1><p>Chọn gói phù hợp với quy mô sử dụng của workspace.</p></div><Link href="/dashboard" className="billingBack">← Quay lại Dashboard</Link></div>
    {loading && <div className="billingNotice">Đang tải bảng giá và thông tin workspace…</div>}
    {error && <div className="billingNotice error" role="alert">{error}</div>}
    {message && <div className="billingNotice success" role="status">{message}</div>}
    {billing && <section className="billingCurrent">
      <div><span className="billingEyebrow">GÓI ĐANG SỬ DỤNG</span><h2>{billing.plan.name}</h2><p>{money(billing.plan.priceMinor)} / tháng · Chu kỳ {fmt(billing.periodStart)} – {fmt(billing.periodEnd)}</p>{billing.subscription?.cancelAtPeriodEnd && <span className="billingCancelFlag">Đã tắt gia hạn · còn hiệu lực đến hết chu kỳ</span>}</div>
      <div className="billingUsageGrid">
        {([
          ["Link mới", billing.usage.links],
          ["Click phân tích", billing.usage.trackedClicks],
          ["Tên miền", billing.usage.customDomains],
          ["Thành viên", billing.usage.seats]
        ] as const).map(([label, item]) => <div className="billingUsage" key={label}><div><span>{label}</span><b>{limit(item.used)} / {limit(item.limit)}</b></div><div className="billingProgress"><i style={{ width: Math.min(100, item.limit ? item.used / item.limit * 100 : 100) + "%" }} /></div></div>)}
      </div>
      {billing.subscription && !billing.subscription.cancelAtPeriodEnd && canBill && <button className="billingCancel" type="button" disabled={busy !== ""} onClick={cancelRenewal}>Tắt gia hạn gói hiện tại</button>}
    </section>}
    <div className="billingSectionTitle"><div><h2>Bảng giá FunLink</h2><p>Thanh toán theo từng chu kỳ 1 tháng. Giá niêm yết bằng VND.</p></div><span className="billingMonthly">THANH TOÁN HÀNG THÁNG</span></div>
    <div className="billingPlans">{planOrder.map(code => {
      const plan = plans.find(item => item.code === code);
      if (!plan) return null;
      const popular = plan.code === "PRO";
      const active = currentCode === plan.code;
      return <article className={"billingPlan" + (popular ? " popular" : "")} key={plan.code}>
        {popular && <span className="billingPopular">PHỔ BIẾN NHẤT</span>}
        <div className="billingPlanTop"><h3>{plan.name}</h3><p>{plan.code === "FREE" ? "Khám phá và bắt đầu rút gọn link" : plan.code === "STARTER" ? "Dành cho cá nhân, SEOer và affiliate" : plan.code === "PRO" ? "Dành cho marketer và doanh nghiệp" : "Dành cho agency và đội nhóm"}</p></div>
        <div className="billingPrice">{money(plan.priceMinor)}<small>{plan.priceMinor ? "/ tháng" : ""}</small></div>
        <button type="button" className={active ? "billingPlanButton current" : "billingPlanButton"} disabled={active || !canBill || busy !== ""} onClick={() => choosePlan(plan)}>{busy === plan.code ? "Đang xử lý…" : active ? "Gói hiện tại" : plan.code === "FREE" ? "Chuyển sang Free" : "Đăng ký " + plan.name}</button>
        <ul>{featureRows.map(row => <li key={row.label}><span>{row.label}</span><b>{row.value(plan)}</b></li>)}</ul>
        <div className="billingPlanFoot">{plan.entitlements.features.map(feature => <span key={feature}>✓ {feature}</span>)}</div>
      </article>;
    })}</div>
    <div className="billingFootnote"><b>Lưu ý về hạn mức</b><p>Hạn mức link và click được tính theo chu kỳ thuê bao. Khi hết hạn mức click phân tích, link vẫn chuyển hướng bình thường; FunLink tạm ngừng ghi nhận click mới cho đến chu kỳ tiếp theo. Xóa link không hoàn lại lượt tạo. Mã QR hiện được công bố trong bảng quyền lợi nhưng module QR chưa mở, vì vậy chưa thể tạo hoặc tính lượt QR.</p><p>Đăng ký gói trả phí hiện tạo hóa đơn và yêu cầu thanh toán VNPay. Gói chỉ được kích hoạt sau khi webhook thanh toán hợp lệ xác nhận thành công. Chu kỳ hiện tại chưa tự động trừ tiền/gia hạn; khách hàng cần thanh toán hóa đơn gia hạn thủ công.</p></div>
    {billing?.invoices?.length ? <section className="billingInvoices"><h2>Hóa đơn gần đây</h2>{billing.invoices.map(invoice => <div key={invoice.id}><span><b>{invoice.number}</b><small>{fmt(invoice.createdAt)}</small></span><span>{money(invoice.amountMinor)} · {invoice.status}</span></div>)}</section> : null}
  </section></main>;
}
