# openpave-cloudflare

Cloudflare deployment skill for [PAVE](https://github.com/cnrai/openpave) - deploy and manage Workers, Pages, and AI Workers directly from your terminal.

## Installation

```bash
pave install cloudflare
```

## Setup

1. Create a Cloudflare API Token at https://dash.cloudflare.com/profile/api-tokens
2. Set environment variables:

```bash
export CLOUDFLARE_API_TOKEN=your_api_token_here
export CLOUDFLARE_ACCOUNT_ID=your_account_id_here
```

3. Add token configuration to `~/.pave/permissions.yaml`:

```yaml
tokens:
  cloudflare:
    env: CLOUDFLARE_API_TOKEN
    type: api_key
    domains:
      - api.cloudflare.com
    placement:
      type: header
      name: Authorization
      format: "Bearer {token}"
```

## Commands

### Account
| Command | Description |
|---------|-------------|
| `cloudflare account` | Show account info and verify token |

### Workers (Phase 1)
| Command | Description |
|---------|-------------|
| `cloudflare workers-list` | List all Workers scripts |
| `cloudflare workers-get <name>` | Get Worker details (bindings, settings) |
| `cloudflare workers-deploy <name> --input <file>` | Deploy a Worker script |
| `cloudflare workers-delete <name> --force` | Delete a Worker |
| `cloudflare workers-tail <name>` | Create a tail for Worker logs |
| `cloudflare workers-subdomain` | Show Workers subdomain |

### Pages (Phase 2)
| Command | Description |
|---------|-------------|
| `cloudflare pages-list` | List Pages projects |
| `cloudflare pages-get <name>` | Get project details |
| `cloudflare pages-create <name>` | Create a new Pages project |
| `cloudflare pages-deploy <name> -d <dir>` | Deploy to Pages |
| `cloudflare pages-deployments <name>` | List deployments |

### AI Workers (Phase 3)
| Command | Description |
|---------|-------------|
| `cloudflare ai-models` | List available AI models |
| `cloudflare ai-run <model> --prompt "text"` | Run an AI model |

### Global Options
- `--json` - Output raw JSON response
- `--summary` - Brief output

## Examples

```bash
# Check account
cloudflare account

# List workers
cloudflare workers-list

# Deploy a worker (auto-detects ES modules vs service worker format)
cloudflare workers-deploy my-api --input src/worker.js

# Deploy with specific compatibility date
cloudflare workers-deploy my-api --input src/worker.js --compatibility-date 2024-01-01

# Delete a worker
cloudflare workers-delete old-worker --force

# List Pages projects
cloudflare pages-list

# Create and deploy to Pages
cloudflare pages-create my-site
cloudflare pages-deploy my-site --directory ./dist

# Run AI model
cloudflare ai-run @cf/meta/llama-3-8b-instruct --prompt "Explain serverless computing"

# Search AI models
cloudflare ai-models --search llama
cloudflare ai-models --task text-generation
```

## Security

- API tokens are **never exposed** to sandbox code
- Authentication is handled by the PAVE secure token system (`authenticatedFetch`)
- The skill only has network access to `api.cloudflare.com`
- File read permission is needed to read files for deployment

## API Reference

This skill uses the [Cloudflare API v4](https://developers.cloudflare.com/api/) directly, without requiring `wrangler` CLI.

## License

MIT
