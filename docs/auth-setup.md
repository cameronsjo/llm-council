# Authentication Setup

LLM Council supports authentication via reverse proxy headers, compatible with Authelia, OAuth2 Proxy, Authentik, and similar OIDC/SSO solutions.

## How It Works

1. Your reverse proxy (nginx, Traefik, Caddy) sits in front of LLM Council
2. The proxy authenticates users via OIDC/OAuth2 (Authelia, Keycloak, etc.)
3. After authentication, the proxy passes user identity via trusted headers
4. LLM Council reads these headers and isolates conversations per user

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLMCOUNCIL_AUTH_ENABLED` | `false` | Enable trusted header authentication |
| `LLMCOUNCIL_TRUSTED_PROXY_IPS` | `127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16` | Trusted proxy IPs (CIDR supported) |
| `LLMCOUNCIL_DATA_DIR` | `data` | Base directory for data storage |

## Trusted Headers

The following headers are read from authenticated requests:

| Header | Required | Description |
|--------|----------|-------------|
| `Remote-User` | Yes | Username (used for conversation isolation) |
| `Remote-Email` | No | User's email address |
| `Remote-Name` | No | Display name |
| `Remote-Groups` | No | Comma-separated group memberships |

## Example: Authelia + nginx

### 1. Enable auth in LLM Council

```yaml
# docker-compose.yml
services:
  llm-council:
    environment:
      - LLMCOUNCIL_AUTH_ENABLED=true
      - LLMCOUNCIL_TRUSTED_PROXY_IPS=172.16.0.0/12
```

### 2. Configure nginx

```nginx
server {
    listen 443 ssl;
    server_name council.example.com;

    # Authelia auth request
    location /authelia {
        internal;
        proxy_pass http://authelia:9091/api/verify;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        # Require authentication
        auth_request /authelia;

        # Pass auth headers to backend
        auth_request_set $user $upstream_http_remote_user;
        auth_request_set $email $upstream_http_remote_email;
        auth_request_set $name $upstream_http_remote_name;
        auth_request_set $groups $upstream_http_remote_groups;

        proxy_set_header Remote-User $user;
        proxy_set_header Remote-Email $email;
        proxy_set_header Remote-Name $name;
        proxy_set_header Remote-Groups $groups;

        proxy_pass http://llm-council:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Configure Authelia

```yaml
# authelia configuration.yml
access_control:
  default_policy: deny
  rules:
    - domain: council.example.com
      policy: one_factor
      # or two_factor for MFA
```

## Example: Traefik + Authelia

```yaml
# docker-compose.yml with Traefik labels
services:
  llm-council:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.council.rule=Host(`council.example.com`)"
      - "traefik.http.routers.council.middlewares=authelia@docker"
      - "traefik.http.services.council.loadbalancer.server.port=8001"
```

## Data Storage Structure

With authentication enabled, conversations are isolated per user:

```
data/
├── user_config.json          # Global config
└── users/
    ├── alice/
    │   └── conversations/
    │       ├── conv-uuid-1.json
    │       └── conv-uuid-2.json
    └── bob/
        └── conversations/
            └── conv-uuid-3.json
```

Without authentication (default), all conversations are shared:

```
data/
├── user_config.json
└── conversations/
    ├── conv-uuid-1.json
    └── conv-uuid-2.json
```

## Security Considerations

1. **Trust boundaries**: Only enable auth when behind a trusted reverse proxy
2. **IP validation**: Configure `LLMCOUNCIL_TRUSTED_PROXY_IPS` to match your proxy's IP
3. **Header security**: Never expose LLM Council directly to the internet with auth enabled - headers can be spoofed without the proxy
4. **HTTPS**: Always use HTTPS between clients and your reverse proxy

## API Endpoints

### GET /api/user

Returns current user information:

```json
{
  "authenticated": true,
  "username": "alice",
  "email": "alice@example.com",
  "display_name": "Alice Smith",
  "groups": ["developers", "admin"]
}
```

When auth is disabled:

```json
{
  "authenticated": false
}
```

### GET /api/config

Includes auth status:

```json
{
  "auth_enabled": true,
  "web_search_available": true,
  "council_models": [...],
  ...
}
```

## Troubleshooting

### Headers not being read

1. Check that `LLMCOUNCIL_AUTH_ENABLED=true`
2. Verify your proxy IP is in `LLMCOUNCIL_TRUSTED_PROXY_IPS`
3. Confirm headers are being passed (check nginx/traefik logs)

### User sees all conversations

1. Ensure auth is enabled
2. Check that `Remote-User` header is being set
3. Verify the header name matches exactly (case-sensitive)

### 401 Unauthorized errors

1. Check that the proxy is passing the `Remote-User` header
2. Verify the request is coming from a trusted IP
3. Check application logs for auth rejection messages
