'use strict';
const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

function reply(res, status, text) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function publicIp(ip) {
  if (net.isIP(ip) === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 ||
      (a===100 && b>=64 && b<=127) ||
      (a===169 && b===254) ||
      (a===172 && b>=16 && b<=31) ||
      (a===192 && (b===0 || b===168 || (b===2) || (b===88 && c===99))) ||
      (a===198 && (b===18 || b===19 || b===51)) ||
      (a===203 && b===0 && c===113));
  }
  if (net.isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const first = parseInt(v.split(':')[0] || '0', 16);
    return first >= 0x2000 && first <= 0x3fff &&
      !v.startsWith('2001:db8:') && !v.startsWith('2002:') &&
      !v.startsWith('2001:0:');
  }
  return false;
}

function normalizeOrigin(raw, domain) {
  if (!String(raw || '').trim()) return '';
  try {
    const u = new URL(String(raw).trim());
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!['http:', 'https:'].includes(u.protocol) ||
        u.username || u.password || !host.includes('.') ||
        u.pathname !== '/' || u.search || u.hash ||
        net.isIP(host) || host === domain || host.endsWith('.' + domain) ||
        host === 'localhost' || host.endsWith('.localhost') ||
        host.endsWith('.local') || host.endsWith('.internal')) return null;
    return u.origin;
  } catch { return null; }
}

module.exports = async function customDomainOrigin(req, res, url, ctx) {
  // Save website origin through the existing domain-management API.
  if (req.method === 'POST' && url.pathname === '/api/domains/origin') {
    let raw = '';
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return reply(res, 413, 'Dữ liệu quá lớn.');
      }
      const body = JSON.parse(raw || '{}');
      const domains = ctx.loadDomains();
      const item = domains.find(d => d.id === body.id);
      if (!item) return reply(res, 404, 'Không tìm thấy tên miền.');
      if (item.dnsVerified !== true)
        return reply(res, 409, 'Hãy xác minh DNS trước khi cấu hình website gốc.');

      const origin = normalizeOrigin(body.originUrl, item.domain);
      if (origin === null)
        return reply(res, 400, 'URL gốc không hợp lệ. Ví dụ: https://websitecuaban.com');

      if (origin) item.originUrl = origin;
      else delete item.originUrl;
      ctx.saveDomains(domains);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify({saved:true,originUrl:item.originUrl || ''}));
    } catch {
      return reply(res, 400, 'Dữ liệu gửi lên không hợp lệ.');
    }
    return true;
  }

  const host = String(req.headers.host || '').trim().toLowerCase().replace(/:\d+$/, '');
  const domain = ctx.loadDomains().find(d =>
    String(d.domain || '').toLowerCase() === host
  );
  if (!domain) return false;
  if (domain.dnsVerified !== true)
    return reply(res, 403, 'Tên miền chưa xác minh DNS.'), true;

  // Known active slugs are redirected before any website fallback.
  if (req.method === 'GET' || req.method === 'HEAD') {
    const candidate = url.pathname.startsWith('/r/')
      ? url.pathname.slice(3)
      : (/^\/[a-z0-9][a-z0-9-]{2,39}$/.test(url.pathname) &&
         !['api','app','health','r','auth'].includes(url.pathname.slice(1))
          ? url.pathname.slice(1) : '');
    if (candidate && /^[a-z0-9][a-z0-9-]{2,39}$/.test(candidate)) {
      const links = ctx.loadLinks();
      const link = links.find(x => x.slug === candidate && x.active !== false);
      if (link) {
        link.clicks = (link.clicks || 0) + 1;
        link.clickLog = Array.isArray(link.clickLog) ? link.clickLog : [];
        link.clickLog.push({
          at:new Date().toISOString(),
          referer:String(req.headers.referer || '').slice(0,500),
          ua:String(req.headers['user-agent'] || '').slice(0,300)
        });
        if (link.clickLog.length > 5000) link.clickLog = link.clickLog.slice(-5000);
        ctx.saveLinks(links);
        res.writeHead(302, {
          Location:link.target,
          'Cache-Control':'no-store',
          'Referrer-Policy':'strict-origin-when-cross-origin'
        });
        res.end();
        return true;
      }
    }
  }

  const originString = normalizeOrigin(domain.originUrl, host);
  if (!originString)
    return reply(res, 404, 'Không tìm thấy trang hoặc liên kết.'), true;

  if (!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method))
    return reply(res, 405, 'Method not allowed'), true;

  const origin = new URL(originString);
  let addresses;
  try {
    addresses = await dns.lookup(origin.hostname, {all:true, verbatim:true});
  } catch {
    return reply(res, 502, 'Không phân giải được website gốc.'), true;
  }
  if (!addresses.length || addresses.some(a => !publicIp(a.address)))
    return reply(res, 502, 'Website gốc không có địa chỉ IP công khai hợp lệ.'), true;

  addresses.sort((a,b) => b.family - a.family);
  const selected = addresses[0];
  let scheme = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (!['http','https'].includes(scheme)) scheme = 'https';

  const headers = {...req.headers, host:origin.host};
  for (const k of ['connection','keep-alive','proxy-authenticate','proxy-authorization',
    'te','trailer','transfer-encoding','upgrade','expect']) delete headers[k];
  headers['x-forwarded-host'] = host;
  headers['x-forwarded-proto'] = scheme;
  headers['x-forwarded-for'] =
    [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ');

  const transport = origin.protocol === 'https:' ? https : http;
  const proxy = transport.request({
    protocol:origin.protocol, hostname:origin.hostname,
    port:origin.port || (origin.protocol === 'https:' ? 443 : 80),
    method:req.method, path:url.pathname + url.search, headers,
    lookup:(name, options, cb) => options && options.all
      ? cb(null,[selected]) : cb(null,selected.address,selected.family)
  }, upstream => {
    const out = {...upstream.headers, 'x-served-by':host};
    for (const k of ['connection','keep-alive','transfer-encoding','upgrade']) delete out[k];
    if (out.location) {
      try {
        const target = new URL(out.location, origin.origin);
        if (target.host.toLowerCase() === origin.host.toLowerCase())
          out.location = scheme + '://' + host + target.pathname + target.search + target.hash;
      } catch {}
    }
    res.writeHead(upstream.statusCode || 502, out);
    if (req.method === 'HEAD') return res.end();
    upstream.pipe(res);
  });
  proxy.setTimeout(20000, () => proxy.destroy(new Error('origin timeout')));
  proxy.on('error', e => {
    console.error('Custom origin proxy:', e.code || e.message);
    reply(res, 502, 'Không kết nối được website gốc.');
  });
  req.pipe(proxy);
  return true;
};
