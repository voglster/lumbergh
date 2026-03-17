---
title: Mobile & PWA
---

# Mobile & PWA

Lumbergh is designed mobile-first with a fully responsive UI. Every feature works on your phone or tablet.

## PWA Support

Lumbergh is a Progressive Web App. Once installed, it looks and feels like a native app -- with its own icon, splash screen, and full-screen mode.

**To install:** open Lumbergh in your mobile browser and tap **Add to Home Screen** (or the install prompt if your browser shows one).

!!! warning "HTTPS required for PWA"
    Browsers only allow PWA installation over HTTPS (or localhost). Use Tailscale or another method to serve over TLS.

## Remote Access with Tailscale (Recommended)

[Tailscale](https://tailscale.com/) is a free VPN that connects your devices into a private mesh network. It's the easiest way to access Lumbergh securely from anywhere.

### Setup

1. Install Tailscale on your server and your phone/tablet
2. Serve Lumbergh with automatic TLS:

```bash
tailscale serve --bg 8420
```

3. Access Lumbergh at:

```
https://YOUR-MACHINE.tailnet-name.ts.net
```

!!! tip "Find your hostname"
    ```bash
    tailscale status --self
    ```

### Development Mode

When running the Vite dev server, use the provided script to generate local TLS certs:

```bash
./setup-https.sh
```

Certs expire after roughly 90 days -- just re-run the script to renew.

## Without Tailscale

Lumbergh binds to `0.0.0.0` by default, so it's accessible to any device on your local network. However, without HTTPS you lose:

- PWA installation
- Service worker caching

For remote access without Tailscale, consider an SSH tunnel:

```bash
ssh -L 8420:localhost:8420 your-server
```

## Security

Lumbergh includes **optional password protection**. When a password is set (via Settings or the `LUMBERGH_PASSWORD` environment variable), all API and WebSocket connections require authentication via a signed session cookie.

See [Authentication](#authentication) below for details.

!!! tip "Tailscale + password = defense in depth"
    Even with Tailscale, setting a password adds an extra layer of protection. Tailscale handles network-level security; the password prevents unauthorized access from other devices on your tailnet.

## Authentication

When enabled, Lumbergh uses a single shared password with cookie-based sessions:

1. Set a password in **Settings** or via the `LUMBERGH_PASSWORD` environment variable
2. On first visit, you'll see a login page
3. After logging in, a signed cookie (HMAC-SHA256, 30-day expiry) keeps you authenticated
4. The `/api/health` endpoint is always accessible without auth (for monitoring)

To disable auth, clear the password in Settings.
