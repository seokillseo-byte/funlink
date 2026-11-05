"use client";

import Link from "next/link";
import {useCallback, useEffect, useMemo, useState} from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3013";
type Workspace = {id: string; name: string; slug: string; role: string};
type LinkItem = {id: string; slug: string; title: string | null; targetUrl: string; status: string};
type Mapping = {id: string; slug: string; link: LinkItem};
type Domain = {id: string; hostname: string; status: string; tlsStatus: string; verifiedAt: string | null; slugMappings: Mapping[]};
type DnsRecord = {type: string; name: string; value: string};
type Account = {workspaces: Workspace[]};

const panel: React.CSSProperties = {background: "#fff", border: "1px solid #e8edf5", borderRadius: 14, padding: 22, marginTop: 20};
const field: React.CSSProperties = {width: "100%", border: "1px solid #dce3ee", borderRadius: 9, padding: "11px 12px", font: "inherit", minWidth: 0};
const button: React.CSSProperties = {border: "1px solid #dce3ee", borderRadius: 9, padding: "10px 14px", background: "#fff", cursor: "pointer", font: "inherit"};

export default function DomainsPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [hostname, setHostname] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("");
  const [selectedLink, setSelectedLink] = useState("");
  const [mappingSlug, setMappingSlug] = useState("");
  const [dnsRecord, setDnsRecord] = useState<DnsRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const workspace = useMemo(() => account?.workspaces.find(item => item.id === workspaceId), [account, workspaceId]);

  const load = useCallback(async (id: string) => {
    const [domainResponse, linkResponse] = await Promise.all([
      fetch(API + "/v1/workspaces/" + encodeURIComponent(id) + "/domains", {credentials: "include", cache: "no-store"}),
      fetch(API + "/v1/workspaces/" + encodeURIComponent(id) + "/links?limit=100", {credentials: "include", cache: "no-store"})
    ]);
    const [domainData, linkData] = await Promise.all([domainResponse.json(), linkResponse.json()]);
    if (!domainResponse.ok) throw new Error(domainData.error ?? "Không thể tải tên miền.");
    if (!linkResponse.ok) throw new Error(linkData.error ?? "Không thể tải liên kết.");
    setDomains(domainData.domains ?? []);
    setLinks(linkData.links ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(API + "/v1/auth/me", {credentials: "include", cache: "no-store"})
      .then(async response => {
        if (response.status === 401) {window.location.href = "/login"; return null;}
        if (!response.ok) throw new Error("Không thể tải tài khoản.");
        return response.json();
      })
      .then((data: Account | null) => {
        if (!active || !data) return;
        setAccount(data);
        const saved = window.localStorage.getItem("funlink_active_workspace") ?? "";
        setWorkspaceId(data.workspaces.some(item => item.id === saved) ? saved : (data.workspaces[0]?.id ?? ""));
      })
      .catch(reason => {if (active) setError(reason instanceof Error ? reason.message : "Có lỗi xảy ra.");});
    return () => {active = false;};
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    load(workspaceId).catch(reason => {if (active) setError(reason instanceof Error ? reason.message : "Không thể tải dữ liệu.");});
    return () => {active = false;};
  }, [workspaceId, load]);

  async function createDomain(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId) return;
    setBusy(true); setError(""); setNotice(""); setDnsRecord(null);
    try {
      const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/domains", {
        method: "POST", credentials: "include", headers: {"content-type": "application/json"},
        body: JSON.stringify({hostname: hostname.trim()})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể thêm tên miền.");
      setDnsRecord(data.dnsRecord);
      setHostname("");
      setNotice("Đã thêm tên miền. Hãy tạo bản ghi TXT xác minh bên dưới.");
      await load(workspaceId);
    } catch (reason) {setError(reason instanceof Error ? reason.message : "Không thể thêm tên miền.");}
    finally {setBusy(false);}
  }

  async function verifyDomain(domain: Domain) {
    if (!workspaceId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/domains/" + encodeURIComponent(domain.id) + "/verify", {
        method: "POST", credentials: "include"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Xác minh DNS chưa thành công.");
      setNotice("Đã xác minh quyền sở hữu " + domain.hostname + ".");
      await load(workspaceId);
    } catch (reason) {setError(reason instanceof Error ? reason.message : "Không thể xác minh tên miền.");}
    finally {setBusy(false);}
  }

  async function addMapping(event: React.FormEvent) {
    event.preventDefault();
    if (!workspaceId || !selectedDomain || !selectedLink) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/domains/" + encodeURIComponent(selectedDomain) + "/slugs", {
        method: "POST", credentials: "include", headers: {"content-type": "application/json"},
        body: JSON.stringify({linkId: selectedLink, slug: mappingSlug.trim()})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể tạo mapping.");
      setMappingSlug("");
      setNotice(data.notice ?? "Đã thêm mapping.");
      await load(workspaceId);
    } catch (reason) {setError(reason instanceof Error ? reason.message : "Không thể tạo mapping.");}
    finally {setBusy(false);}
  }

  async function removeMapping(domain: Domain, mapping: Mapping) {
    if (!workspaceId || !window.confirm("Xóa mapping " + domain.hostname + "/" + mapping.slug + "?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(API + "/v1/workspaces/" + encodeURIComponent(workspaceId) + "/domains/" + encodeURIComponent(domain.id) + "/slugs/" + encodeURIComponent(mapping.id), {
        method: "DELETE", credentials: "include"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Không thể xóa mapping.");
      setNotice("Đã xóa mapping.");
      await load(workspaceId);
    } catch (reason) {setError(reason instanceof Error ? reason.message : "Không thể xóa mapping.");}
    finally {setBusy(false);}
  }

  return <main className="accountPage">
    <header className="accountNav">
      <Link className="brand" href="/"><span className="brandmark">F</span> FunLink</Link>
      <nav><Link href="/dashboard">Tổng quan</Link><Link href="/dashboard/links">Liên kết</Link><Link href="/dashboard/domains">Tên miền</Link><Link href="/profile">Profile</Link></nav>
    </header>
    <section className="accountContent">
      <span className="pill">CUSTOM DOMAINS</span>
      <h1>Quản lý tên miền</h1>
      <p>Kết nối tên miền riêng, xác minh DNS và gán slug cho liên kết trong workspace.</p>
      {account?.workspaces.length ? <section style={panel}>
        <label>Workspace<select aria-label="Chọn workspace" value={workspaceId} onChange={event => {setWorkspaceId(event.target.value); window.localStorage.setItem("funlink_active_workspace", event.target.value);}} style={{...field, marginTop: 7}}>
          {account.workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <form onSubmit={createDomain} style={{display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18}}>
          <input aria-label="Tên miền riêng" required value={hostname} onChange={event => setHostname(event.target.value)} placeholder="go.example.com" style={{...field, flex: "1 1 260px"}} />
          <button disabled={busy || !["OWNER", "ADMIN"].includes(workspace?.role ?? "")} style={{...button, background: "#155eef", color: "#fff", borderColor: "#155eef"}}>{busy ? "Đang xử lý…" : "Thêm tên miền"}</button>
        </form>
        {!["OWNER", "ADMIN"].includes(workspace?.role ?? "") && <small style={{color: "#b54708"}}>Chỉ OWNER hoặc ADMIN mới có thể thêm tên miền và quản lý mapping.</small>}
      </section> : <section style={panel}>Tài khoản chưa có workspace.</section>}
      {error && <p role="alert" style={{color: "#b42318"}}>{error}</p>}
      {notice && <p role="status" style={{color: "#067647"}}>{notice}</p>}
      {dnsRecord && <section style={{...panel, borderColor: "#f0b849"}}>
        <h2 style={{marginTop: 0}}>Bản ghi DNS cần tạo</h2>
        <p>Thêm bản ghi TXT tại nhà cung cấp DNS của bạn. Giá trị token chỉ được hiển thị một lần, hãy lưu lại trước khi rời trang.</p>
        <dl><dt>Loại</dt><dd><b>{dnsRecord.type}</b></dd><dt>Tên / Host</dt><dd><code>{dnsRecord.name}</code></dd><dt>Giá trị</dt><dd style={{overflowWrap: "anywhere"}}><code>{dnsRecord.value}</code></dd></dl>
        <button type="button" style={button} onClick={() => navigator.clipboard.writeText(dnsRecord.value)}>Sao chép TXT value</button>
      </section>}
      <section style={panel}>
        <h2 style={{marginTop: 0}}>Tên miền đã thêm</h2>
        {!domains.length ? <p>Chưa có tên miền nào.</p> : <div style={{display: "grid", gap: 14}}>
          {domains.map(domain => <article key={domain.id} style={{border: "1px solid #e8edf5", borderRadius: 12, padding: 16}}>
            <div style={{display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap"}}>
              <div><strong>{domain.hostname}</strong><p style={{margin: "6px 0", color: "#667085"}}>DNS: {domain.status} · TLS: {domain.tlsStatus}</p></div>
              {domain.status === "PENDING_VERIFICATION" && <button type="button" disabled={busy || !["OWNER", "ADMIN"].includes(workspace?.role ?? "")} style={button} onClick={() => verifyDomain(domain)}>Kiểm tra TXT DNS</button>}
            </div>
            {domain.status === "VERIFIED" && domain.tlsStatus !== "ACTIVE" && <p style={{color: "#b54708", fontSize: 13}}>Đã xác minh DNS. Tên miền chưa chuyển hướng công khai cho đến khi cấu hình routing và TLS được kích hoạt trên máy chủ.</p>}
            {domain.slugMappings?.length ? <div style={{display: "grid", gap: 8, marginTop: 12}}>{domain.slugMappings.map(mapping => <div key={mapping.id} style={{display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", borderTop: "1px solid #edf0f5", paddingTop: 9, flexWrap: "wrap"}}>
              <span><code>/{mapping.slug}</code> → {mapping.link.title || mapping.link.slug}</span>
              <button type="button" style={button} disabled={busy || !["OWNER", "ADMIN"].includes(workspace?.role ?? "")} onClick={() => removeMapping(domain, mapping)}>Xóa mapping</button>
            </div>)}</div> : <p style={{fontSize: 13, color: "#667085"}}>Chưa có slug mapping.</p>}
          </article>)}
        </div>}
      </section>
      <section style={panel}>
        <h2 style={{marginTop: 0}}>Gán slug cho tên miền</h2>
        <form onSubmit={addMapping} style={{display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 12}}>
          <label>Tên miền<select required value={selectedDomain} onChange={event => setSelectedDomain(event.target.value)} style={{...field, marginTop: 7}}>
            <option value="">Chọn tên miền đã xác minh</option>
            {domains.filter(item => ["VERIFIED", "ROUTING_PENDING", "ACTIVE"].includes(item.status)).map(item => <option key={item.id} value={item.id}>{item.hostname}</option>)}
          </select></label>
          <label>Liên kết đích<select required value={selectedLink} onChange={event => setSelectedLink(event.target.value)} style={{...field, marginTop: 7}}>
            <option value="">Chọn liên kết</option>
            {links.filter(item => item.status === "ACTIVE").map(item => <option key={item.id} value={item.id}>{item.title || item.slug}</option>)}
          </select></label>
          <label>Slug trên tên miền<input required minLength={3} maxLength={64} value={mappingSlug} onChange={event => setMappingSlug(event.target.value.toLowerCase())} placeholder="brand-campaign" style={{...field, marginTop: 7}} /></label>
          <button type="submit" disabled={busy || !selectedDomain || !selectedLink || !mappingSlug.trim() || !["OWNER", "ADMIN"].includes(workspace?.role ?? "")} style={{...button, marginTop: 4, background: "#155eef", color: "#fff", borderColor: "#155eef"}}>Tạo mapping</button>
        </form>
        <p style={{fontSize: 13, color: "#667085"}}>Lưu ý: mapping chỉ được lưu ở ứng dụng. Máy chủ vẫn cần cấu hình DNS, reverse proxy và chứng chỉ TLS trước khi URL custom domain hoạt động công khai.</p>
      </section>
    </section>
  </main>;
}
