"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3013";
const SHORT_DOMAIN = process.env.NEXT_PUBLIC_SITE_URL ?? "https://funlink.io.vn";

type Workspace = {id: string; name: string; slug: string; role: string};
type LinkItem = {
  id: string;
  slug: string;
  targetUrl: string;
  title: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  redirectCode: number;
  expiresAt: string | null;
  createdAt: string;
  campaign: {id: string; name: string} | null;
  _count: {clickEvents: number};
};
type Account = {workspaces: Workspace[]};

export default function LinksPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [targetUrl, setTargetUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const workspace = useMemo(
    () => account?.workspaces.find(item => item.id === workspaceId),
    [account, workspaceId]
  );

  const loadLinks = useCallback(async (id: string, term = "") => {
    const params = new URLSearchParams({limit: "100"});
    if (term.trim()) params.set("search", term.trim());
    const response = await fetch(
      API + "/v1/workspaces/" + encodeURIComponent(id) + "/links?" + params.toString(),
      {credentials: "include", cache: "no-store"}
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Không thể tải danh sách liên kết.");
    setLinks(data.links ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(API + "/v1/auth/me", {credentials: "include", cache: "no-store"})
      .then(async response => {
        if (response.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!response.ok) throw new Error("Không thể tải tài khoản.");
        return response.json();
      })
      .then((data: Account | null) => {
        if (!active || !data) return;
        setAccount(data);
        const saved = window.localStorage.getItem("funlink_active_workspace") ?? "";
        const selected = data.workspaces.some(item => item.id === saved)
          ? saved
          : (data.workspaces[0]?.id ?? "");
        setWorkspaceId(selected);
      })
      .catch(reason => {if (active) setError(reason instanceof Error ? reason.message : "Có lỗi xảy ra.");});
    return () => {active = false;};
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    loadLinks(workspaceId, search).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "Không thể tải liên kết.");
    });
    return () => {active = false;};
  }, [workspaceId, search, loadLinks]);

  async function createLink(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload: Record<string, string> = {targetUrl: targetUrl.trim()};
      if (slug.trim()) payload.slug = slug.trim().toLowerCase();
      if (title.trim()) payload.title = title.trim();
      const response = await fetch(
        API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/links",
        {
          method: "POST",
          credentials: "include",
          headers: {"content-type": "application/json"},
          body: JSON.stringify(payload)
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể tạo liên kết.");
      setTargetUrl("");
      setSlug("");
      setTitle("");
      setNotice("Đã tạo liên kết thành công.");
      await loadLinks(workspaceId, search);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể tạo liên kết.");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(item: LinkItem) {
    if (!workspaceId) return;
    const status = item.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setError("");
    try {
      const response = await fetch(
        API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/links/" + encodeURIComponent(item.id),
        {
          method: "PATCH",
          credentials: "include",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({status})
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể cập nhật liên kết.");
      await loadLinks(workspaceId, search);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể cập nhật liên kết.");
    }
  }

  async function archiveLink(item: LinkItem) {
    if (!workspaceId || !window.confirm("Lưu trữ liên kết này? Liên kết sẽ ngừng chuyển hướng.")) return;
    setError("");
    try {
      const response = await fetch(
        API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/links/" + encodeURIComponent(item.id),
        {method: "DELETE", credentials: "include"}
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể lưu trữ liên kết.");
      await loadLinks(workspaceId, search);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể lưu trữ liên kết.");
    }
  }

  async function copyLink(item: LinkItem) {
    const shortUrl = new URL("/" + encodeURIComponent(item.slug), SHORT_DOMAIN).toString();
    try {
      await navigator.clipboard.writeText(shortUrl);
      setNotice("Đã sao chép " + shortUrl);
    } catch {
      setError("Trình duyệt không cho phép sao chép liên kết. Hãy sao chép thủ công: " + shortUrl);
    }
  }

  const panel: React.CSSProperties = {
    background: "#fff", border: "1px solid #e8edf5", borderRadius: 14,
    padding: 22, marginTop: 20
  };
  const field: React.CSSProperties = {
    width: "100%", border: "1px solid #dce3ee", borderRadius: 9,
    padding: "11px 12px", font: "inherit", minWidth: 0
  };
  const button: React.CSSProperties = {
    border: "1px solid #dce3ee", borderRadius: 9, padding: "9px 12px",
    background: "#fff", cursor: "pointer", font: "inherit"
  };

  return (
    <main className="accountPage">
      <header className="accountNav">
        <Link className="brand" href="/"><span className="brandmark">F</span> FunLink</Link>
        <nav><Link href="/dashboard">Tổng quan</Link><Link href="/dashboard/links">Liên kết</Link><Link href="/profile">Profile</Link></nav>
        <Link href="/dashboard">Quay lại dashboard</Link>
      </header>
      <section className="accountContent">
        <span className="pill">LINK MANAGEMENT</span>
        <h1>Quản lý liên kết</h1>
        <p>Tạo, tìm kiếm, tạm dừng và lưu trữ các liên kết trong workspace.</p>

        {account && account.workspaces.length > 0 && (
          <section style={panel}>
            <label htmlFor="workspace-select">Workspace</label>
            <select
              id="workspace-select"
              style={{...field, marginTop: 8}}
              value={workspaceId}
              onChange={event => {
                setWorkspaceId(event.target.value);
                window.localStorage.setItem("funlink_active_workspace", event.target.value);
              }}
            >
              {account.workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </section>
        )}

        <form onSubmit={createLink} style={panel}>
          <h2 style={{marginTop: 0}}>Tạo liên kết mới</h2>
          <div style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12}}>
            <label>URL đích<input required type="url" placeholder="https://example.com/page" value={targetUrl} onChange={event => setTargetUrl(event.target.value)} style={{...field, marginTop: 7}} /></label>
            <label>Slug tùy chỉnh (không bắt buộc)<input placeholder="chien-dich-2026" value={slug} onChange={event => setSlug(event.target.value)} style={{...field, marginTop: 7}} /></label>
            <label>Tên liên kết<input placeholder="Chiến dịch tháng 11" value={title} onChange={event => setTitle(event.target.value)} style={{...field, marginTop: 7}} /></label>
          </div>
          <button type="submit" disabled={busy || !workspaceId} style={{...button, background: "#155eef", color: "#fff", borderColor: "#155eef", marginTop: 16, opacity: busy ? .65 : 1}}>
            {busy ? "Đang tạo…" : "Tạo liên kết"}
          </button>
        </form>

        <section style={panel}>
          <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap"}}>
            <div><h2 style={{margin: 0}}>Danh sách liên kết</h2><p style={{margin: "5px 0 0", color: "#647188"}}>{workspace?.name ?? "Chưa chọn workspace"} · {links.length} liên kết</p></div>
            <input aria-label="Tìm kiếm liên kết" placeholder="Tìm slug, tiêu đề hoặc URL…" value={search} onChange={event => setSearch(event.target.value)} style={{...field, maxWidth: 320}} />
          </div>
          {error && <p role="alert" style={{color: "#b42318"}}>{error}</p>}
          {notice && <p role="status" style={{color: "#067647"}}>{notice}</p>}
          {links.length === 0 ? <p style={{color: "#647188", marginTop: 22}}>Chưa có liên kết nào. Hãy tạo liên kết đầu tiên ở phía trên.</p> : (
            <div style={{display: "grid", gap: 12, marginTop: 18}}>
              {links.map(item => (
                <article key={item.id} style={{border: "1px solid #e8edf5", borderRadius: 11, padding: 15}}>
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap"}}>
                    <div style={{minWidth: 0, flex: 1}}>
                      <strong>{item.title || item.slug}</strong>
                      <div style={{marginTop: 5, overflowWrap: "anywhere"}}>
                        <a href={new URL("/" + encodeURIComponent(item.slug), SHORT_DOMAIN).toString()} target="_blank" rel="noreferrer">
                          {new URL("/" + encodeURIComponent(item.slug), SHORT_DOMAIN).host + "/" + item.slug}
                        </a>
                      </div>
                      <div style={{fontSize: 13, color: "#647188", marginTop: 5, overflowWrap: "anywhere"}}>{item.targetUrl}</div>
                      <small style={{display: "block", marginTop: 7, color: "#647188"}}>
                        {item.status} · {item._count?.clickEvents ?? 0} lượt nhấp · {item.redirectCode}
                      </small>
                    </div>
                    <div style={{display: "flex", gap: 7, flexWrap: "wrap"}}>
                      <button type="button" style={button} onClick={() => copyLink(item)}>Sao chép</button>
                      {item.status !== "ARCHIVED" && <button type="button" style={button} onClick={() => updateStatus(item)}>{item.status === "ACTIVE" ? "Tạm dừng" : "Kích hoạt"}</button>}
                      {item.status !== "ARCHIVED" && <button type="button" style={{...button, color: "#b42318"}} onClick={() => archiveLink(item)}>Lưu trữ</button>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
