# Publish SEO Pilot on your own domain

SEO Pilot listens only on your own machine (`127.0.0.1`) by default. To reach it at an address such as `https://seo.example.com`, the simplest way is a free Cloudflare Tunnel. It needs no open ports and gives you HTTPS. Your domain must use Cloudflare for DNS.

Create your administrator account first, before the site is public.

## 1. Create the tunnel

1. In the Cloudflare dashboard, open **Networking → Tunnels → Create Tunnel**.
2. Name it, for example `seo-pilot`, and create it.
3. Choose **Docker**. Copy the token from the command it shows: the long text after `--token`.

## 2. Run it next to SEO Pilot

Save the token in `deploy/standalone/.env.tunnel`, which Git ignores:

```dotenv
TUNNEL_TOKEN=paste-the-token-here
```

Start SEO Pilot with the tunnel file added:

```sh
docker compose --project-name seo-pilot --env-file deploy/standalone/.env -f deploy/standalone/compose.yaml -f deploy/standalone/compose.tunnel.yaml up -d
```

The tunnel's page in Cloudflare should now show it as healthy.

## 3. Point your address at it

On the tunnel's page, choose **Add route → Published application**:

- **Subdomain and domain:** the address you want, such as `seo` and `example.com`.
- **Service URL:** `http://web:80`

Cloudflare creates the DNS record for you.

## 4. Tell SEO Pilot its address

In `deploy/standalone/.env`, set:

```dotenv
BETTER_AUTH_URL=https://seo.example.com
```

Then run the same `up -d` command again. Sign-in only works on the address set here.

If you use your own reverse proxy instead, send HTTPS traffic to `127.0.0.1:PORT` and set `BETTER_AUTH_URL` the same way.
