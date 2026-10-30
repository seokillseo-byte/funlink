# FunLink Node.js MVP — Ubuntu 22.04 / port 3012

This package keeps the existing landing page and dashboard UI, and adds a dependency-free Node.js backend with persistent JSON storage. No MySQL, PHP, npm packages, or pnpm are required. This is an MVP, not a production multi-user SaaS: no accounts/authentication, no abuse moderation UI, and dashboard data is not yet connected to the API.

## 1. Copy the package

Upload the ZIP to `/var/www/` using WinSCP, then extract it there. The ZIP creates `/var/www/funlink-node-deploy/`; copy its contents into the existing empty `/var/www/funlink/` directory:

- `server.js`, `package.json`, `funlink.service`
- `public/index.html`, `public/app/index.html`
- `data/` (the app creates `links.json` on first start)

If using WinSCP, upload the ZIP to `/var/www/funlink/`, then SSH:

```bash
ls -la /var/www/funlink
cp -an /var/www/funlink-node-deploy/. /var/www/funlink/
ls -la /var/www/funlink
```

`cp -an` avoids overwriting existing files. Confirm the target directory is the FunLink directory, not another project. Do not overwrite any other project directory.

## 2. Create a dedicated service user and permissions

```bash
id funlink >/dev/null 2>&1 || useradd --system --home /var/www/funlink --shell /usr/sbin/nologin funlink
mkdir -p /var/www/funlink/data
chown -R root:root /var/www/funlink
chown -R funlink:funlink /var/www/funlink/data
chmod 750 /var/www/funlink/data
```

If you uploaded files as root, ensure the app files are readable by the `funlink` user:

```bash
chmod 755 /var/www/funlink /var/www/funlink/public /var/www/funlink/public/app
chmod 644 /var/www/funlink/server.js /var/www/funlink/package.json /var/www/funlink/public/index.html /var/www/funlink/public/app/index.html
```

## 3. Install and start systemd service

Check Node first: `node -v` and `which node`. The included service uses `/usr/bin/node`, which matches the environment reported so far.

```bash
cp /var/www/funlink/funlink.service /etc/systemd/system/funlink.service
systemctl daemon-reload
systemctl enable --now funlink
systemctl status funlink --no-pager
```

Health check:

```bash
curl -i http://127.0.0.1:3012/health
curl -I http://127.0.0.1:3012/
```

Expected health JSON: `{"ok":true,"service":"funlink","port":3012}`.

## 4. Reverse proxy

The server already uses Docker for ports 80/81/443, likely including a reverse proxy manager. Do not install Nginx or stop containers. In the existing reverse-proxy manager, add a Proxy Host:

- Domain: `funlink.io.vn`
- Scheme: `http`
- Forward Hostname/IP: the host's LAN IP (shown in WinSCP as `192.168.1.199`) if reachable from the proxy container
- Forward Port: `3012`
- Websockets: off
- SSL: request/select a certificate and enable Force SSL only after DNS points to the proxy and certificate issuance succeeds

If the proxy container cannot reach `192.168.1.199:3012`, inspect Docker networking first rather than opening the port to the public internet. The Node server binds to `0.0.0.0`; use host firewall rules to restrict access to trusted LAN/proxy sources where practical.

## 5. Test API

Create a test link:

```bash
curl -sS -X POST http://127.0.0.1:3012/api/links \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/article","slug":"test-link"}'
```

Visit `http://127.0.0.1:3012/test-link` (or `https://funlink.io.vn/test-link` after proxy configuration) to test redirect. List links: `curl http://127.0.0.1:3012/api/links`.

## Important limitations

- The landing page's form and dashboard still contain demo-only interactions; the backend API is real but not yet wired into those UI screens.
- Public link creation API is rate-limited per IP but does not have user authentication. Do not advertise this as a public production SaaS until authentication, stronger anti-abuse controls, backups, monitoring and UI/API integration are completed.
- Data is stored in `data/links.json`. Back it up before updates. No external database is needed for this MVP.
- Do not change DNS, firewall or reverse-proxy settings until verifying the existing configuration and taking note of current settings.
