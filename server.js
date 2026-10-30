'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const customDomainOrigin = require('./custom-domain-origin');

const PORT = Number(process.env.PORT || 3012);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'links.json');
// FUNLINK_DOMAIN_API_V1
const DOMAINS_FILE = path.join(DATA_DIR, 'domains.json');
if (!fs.existsSync(DOMAINS_FILE)) {
  fs.writeFileSync(DOMAINS_FILE, '[]\n', { mode: 0o600 });
}
function loadDomains() {
  try {
    const value = JSON.parse(fs.readFileSync(DOMAINS_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function saveDomains(domains) {
  const tmp = DOMAINS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(domains, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, DOMAINS_FILE);
}
function validDomain(raw) {
  if (typeof raw !== 'string') return null;
  const domain = raw.trim().toLowerCase().replace(/\\.$/, '');
  if (domain.length > 253 || domain.includes('://') ||
      domain.includes('/') || domain.includes(':') ||
      domain.includes(' ') || !domain.includes('.')) return null;
  const labels = domain.split('.');
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return null;
  if (labels[labels.length - 1].length < 2) return null;
  return domain;
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]\n', { mode: 0o600 });

const rate = new Map();
function loadLinks() { try { const v = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } }
function saveLinks(links) { const tmp = DATA_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(links, null, 2) + '\n', { mode: 0o600 }); fs.renameSync(tmp, DATA_FILE); }
function send(res, status, body, type='application/json; charset=utf-8') { res.writeHead(status, {'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Cache-Control':'no-store'}); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }
function getClientIp(req) { return (req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, ''); }
function limited(req) { const ip=getClientIp(req), now=Date.now(), arr=(rate.get(ip)||[]).filter(t=>now-t<60000); if(arr.length>=12){rate.set(ip,arr);return true;} arr.push(now);rate.set(ip,arr);return false; }
function readBody(req, max=8192) { return new Promise((resolve,reject)=>{let data='', size=0;req.on('data',c=>{size+=c.length;if(size>max){reject(new Error('body_too_large'));req.destroy();return;}data+=c;});req.on('end',()=>{try{resolve(JSON.parse(data||'{}'));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);}); }
function validUrl(raw) { try { const u=new URL(raw); if(!['http:','https:'].includes(u.protocol) || !u.hostname.includes('.') || u.username || u.password) return null; return u.toString(); } catch { return null; } }
function makeSlug() { return crypto.randomBytes(4).toString('base64url').replace(/[-_]/g,'').slice(0,7).toLowerCase(); }
function safeStatic(p) { const full=path.resolve(PUBLIC_DIR, '.'+p); return full.startsWith(PUBLIC_DIR+path.sep) || full===PUBLIC_DIR ? full : null; }
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');


  // FUNLINK_ADMIN_API_AUTH_V1
  if (/^\/api\/(?:domains(?:\/.*)?|links)$/.test(url.pathname)) {
    const expected = process.env.FUNLINK_ADMIN_TOKEN || '';
    if (!expected) {
      return send(res, 503, {error:'Máy chủ chưa cấu hình mã quản trị.'});
    }
    const header = String(req.headers.authorization || '');
    const supplied = Buffer.from(
      header.startsWith('Bearer ') ? header.slice(7) : ''
    );
    const wanted = Buffer.from(expected);
    const valid = supplied.length === wanted.length &&
      crypto.timingSafeEqual(supplied, wanted);
    if (!valid) {
      return send(res, 401, {error:'Cần mã quản trị FunLink hợp lệ.'});
    }
  }

// CUSTOM_DOMAIN_ORIGIN_HANDLER_V1
  if (await customDomainOrigin(req, res, url, {
    loadDomains, saveDomains, loadLinks, saveLinks
  })) return;


  if(req.method==='GET' && url.pathname==='/health'){return send(res,200,{ok:true,service:'funlink',port:PORT});}

  // Custom-domain management API. DNS verification does not configure routing or SSL.
  if (req.method === 'GET' && url.pathname === '/api/domains') {
    return send(res, 200, { domains: loadDomains() });
  }

  if (req.method === 'POST' && url.pathname === '/api/domains') {
    if (limited(req)) return send(res, 429, { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
    let body;
    try { body = await readBody(req, 4096); }
    catch { return send(res, 400, { error: 'Dữ liệu gửi lên không hợp lệ.' }); }

    const domain = validDomain(body.domain);
    if (!domain) return send(res, 400, { error: 'Tên miền không hợp lệ. Hãy nhập dạng go.example.com.' });
    if (domain === 'funlink.io.vn') {
      return send(res, 400, { error: 'Đây là tên miền chính của FunLink, không cần thêm lại.' });
    }

    const domains = loadDomains();
    if (domains.some(d => d.domain === domain)) {
      return send(res, 409, { error: 'Tên miền đã có trong danh sách.' });
    }

    const item = {
      id: crypto.randomUUID(),
      domain,
      verificationToken: 'funlink-verify=' + crypto.randomBytes(24).toString('hex'),
      createdAt: new Date().toISOString(),
      dnsVerified: false,
      dnsVerifiedAt: null,
      httpsStatus: 'not_checked',
      routingStatus: 'not_configured'
    };
    domains.unshift(item);
    saveDomains(domains);
    return send(res, 201, {
      domain: item,
      dnsInstructions: {
        type: 'TXT',
        name: '_funlink-verification.' + domain,
        value: item.verificationToken
      }
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/domains/verify') {
    if (limited(req)) return send(res, 429, { error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.' });
    let body;
    try { body = await readBody(req, 4096); }
    catch { return send(res, 400, { error: 'Dữ liệu gửi lên không hợp lệ.' }); }

    const domains = loadDomains();
    const item = domains.find(d => d.id === body.id);
    if (!item) return send(res, 404, { error: 'Không tìm thấy tên miền.' });

    const recordName = '_funlink-verification.' + item.domain;
    try {
      const records = await dns.resolveTxt(recordName);
      const values = records.map(parts => parts.join(''));
      if (!values.includes(item.verificationToken)) {
        return send(res, 200, {
          verified: false,
          status: 'pending',
          recordName,
          message: 'Đã tìm thấy bản ghi TXT nhưng giá trị chưa khớp. Hãy kiểm tra lại DNS.'
        });
      }
      item.dnsVerified = true;
      item.dnsVerifiedAt = new Date().toISOString();
      saveDomains(domains);
      return send(res, 200, {
        verified: true,
        status: 'dns_verified',
        recordName,
        message: 'Đã xác minh bản ghi TXT. DNS routing và HTTPS vẫn cần được cấu hình riêng.'
      });
    } catch (err) {
      return send(res, 200, {
        verified: false,
        status: 'pending',
        recordName,
        dnsError: err.code || 'DNS_LOOKUP_FAILED',
        message: 'Chưa đọc được bản ghi TXT. Hãy kiểm tra tên bản ghi và đợi DNS cập nhật.'
      });
    }
  }

  if(req.method==='GET' && url.pathname==='/api/links') { const links=loadLinks().map(({slug,target,createdAt,clicks,active,name,campaign})=>({slug,target,createdAt,clicks,active,name,campaign}));return send(res,200,{links}); }
  if(req.method==='POST' && url.pathname==='/api/links') {
    if(limited(req)) return send(res,429,{error:'Quá nhiều yêu cầu. Vui lòng thử lại sau.'});
    let body;try{body=await readBody(req);}catch(e){return send(res,e.message==='body_too_large'?413:400,{error:'Dữ liệu gửi lên không hợp lệ.'});}
    const target=validUrl(typeof body.url==='string'?body.url.trim():''); if(!target)return send(res,400,{error:'URL phải bắt đầu bằng http:// hoặc https:// và không chứa thông tin đăng nhập.'});
    const links=loadLinks();let slug=typeof body.slug==='string'?body.slug.trim().toLowerCase():'';
    if(slug && !/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug))return send(res,400,{error:'Slug chỉ gồm chữ thường, số, dấu gạch ngang; dài 3–40 ký tự.'});
    if(slug && links.some(x=>x.slug===slug))return send(res,409,{error:'Slug đã được sử dụng.'});
    if(!slug){do{slug=makeSlug();}while(links.some(x=>x.slug===slug));}
    const name=typeof body.name==='string'?body.name.trim().slice(0,120):'';const campaign=typeof body.campaign==='string'?body.campaign.trim().slice(0,120):'';const item={slug,target,name,campaign,createdAt:new Date().toISOString(),clicks:0,active:true,clickLog:[]};links.unshift(item);saveLinks(links);
    return send(res,201,{link:{slug,target,name,campaign,createdAt:item.createdAt,clicks:0,active:true},shortUrl:slug});
  }

  // CUSTOM_DOMAIN_ROUTING_PRODUCTION_V1
  // Keep the current JSON storage architecture; only verified domains get custom routing.
  const requestHost = String(req.headers.host || '')
    .trim().toLowerCase().replace(/:\d+$/, '');
  const configuredDomain = loadDomains().find(
    d => String(d.domain || '').trim().toLowerCase() === requestHost
  );
  const customShortRequest =
    (req.method === 'GET' || req.method === 'HEAD') &&
    (url.pathname.startsWith('/r/') ||
      (/^\/[a-z0-9][a-z0-9-]{2,39}$/.test(url.pathname) &&
       !['api', 'app', 'health', 'r'].includes(url.pathname.slice(1))));

  if (configuredDomain && customShortRequest) {
    if (configuredDomain.dnsVerified !== true) {
      return send(res, 403, 'Tên miền chưa xác minh DNS.', 'text/plain; charset=utf-8');
    }

    const slug = url.pathname.startsWith('/r/')
      ? url.pathname.slice(3)
      : url.pathname.slice(1);

    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug)) {
      return send(res, 404, 'Không tìm thấy liên kết.', 'text/plain; charset=utf-8');
    }

    const links = loadLinks();
    const item = links.find(x => x.slug === slug && x.active !== false);

    if (!item) {
      return send(res, 404, 'Không tìm thấy liên kết.', 'text/plain; charset=utf-8');
    }

    item.clicks = (item.clicks || 0) + 1;
    item.clickLog = Array.isArray(item.clickLog) ? item.clickLog : [];
    item.clickLog.push({
      at: new Date().toISOString(),
      referer: (req.headers.referer || '').slice(0, 500),
      ua: (req.headers['user-agent'] || '').slice(0, 300)
    });
    if (item.clickLog.length > 5000) item.clickLog = item.clickLog.slice(-5000);

    saveLinks(links);
    res.writeHead(302, {
      Location: item.target,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    return res.end();
  }


  // CUSTOM_DOMAIN_UNMATCHED_PATH_PRODUCTION_V1
  // Matched active slugs are redirected above. Unmapped paths must not serve
  // the shared FunLink UI on a custom domain without a configured origin.
  if (configuredDomain && (req.method === 'GET' || req.method === 'HEAD')) {
    return send(
      res,
      configuredDomain.dnsVerified === true ? 404 : 403,
      configuredDomain.dnsVerified === true
        ? 'Không tìm thấy trang hoặc liên kết.'
        : 'Tên miền chưa xác minh DNS.',
      'text/plain; charset=utf-8'
    );
  }

  if((req.method==='GET' || req.method==='HEAD') && url.pathname.startsWith('/r/')) { const slug=url.pathname.slice(3);const links=loadLinks();const item=links.find(x=>x.slug===slug&&x.active!==false);if(!item)return send(res,404,'Không tìm thấy liên kết FunLink.','text/plain; charset=utf-8');item.clicks=(item.clicks||0)+1;item.clickLog=item.clickLog||[];item.clickLog.push({at:new Date().toISOString(),referer:(req.headers.referer||'').slice(0,500),ua:(req.headers['user-agent']||'').slice(0,300)});if(item.clickLog.length>5000)item.clickLog=item.clickLog.slice(-5000);saveLinks(links);res.writeHead(302,{Location:item.target,'Cache-Control':'no-store','Referrer-Policy':'strict-origin-when-cross-origin'});return res.end(); }
  // Root-level slugs allow funlink.io.vn/slug, excluding reserved application paths.
  if((req.method==='GET' || req.method==='HEAD') && /^\/[a-z0-9][a-z0-9-]{2,39}$/.test(url.pathname) && !['api','app','health','r'].includes(url.pathname.slice(1))) {const slug=url.pathname.slice(1);const links=loadLinks();const item=links.find(x=>x.slug===slug&&x.active!==false);if(item){item.clicks=(item.clicks||0)+1;item.clickLog=item.clickLog||[];item.clickLog.push({at:new Date().toISOString(),referer:(req.headers.referer||'').slice(0,500),ua:(req.headers['user-agent']||'').slice(0,300)});if(item.clickLog.length>5000)item.clickLog=item.clickLog.slice(-5000);saveLinks(links);res.writeHead(302,{Location:item.target,'Cache-Control':'no-store','Referrer-Policy':'strict-origin-when-cross-origin'});return res.end();}}
  if(req.method==='GET' || req.method==='HEAD') {
    let p=url.pathname==='/'?'/index.html':url.pathname;
if(p==='/app' || p==='/app/')p='/app/index.html';
    const file=safeStatic(decodeURIComponent(p));if(!file)return send(res,400,'Bad request','text/plain; charset=utf-8');
    fs.stat(file,(err,st)=>{if(err||!st.isFile())return send(res,404,'Not found','text/plain; charset=utf-8');const ext=path.extname(file);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);});return;
  }
  send(res,405,{error:'Method not allowed'});
});
server.listen(PORT,HOST,()=>console.log(`FunLink listening on http://${HOST}:${PORT}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));
