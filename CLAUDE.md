# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
npm run dev                        # Start local development server (http://localhost:8787)
npm run deploy                     # Deploy to Cloudflare Workers
npm run cf-typegen                 # Generate TypeScript types after wrangler config changes
npm run build-daytona-container    # Build custom Daytona container image
npm run create-daytona-snapshot    # Create Daytona snapshot for sandboxes
```

**⚠️ Important:** Always run `npm run cf-typegen` after making changes to `wrangler.jsonc`. This regenerates the TypeScript types and updates `worker-configuration.d.ts` to match your bindings and configuration.

### Wrangler CLI Commands

```bash
npx wrangler dev                    # Start local development (same as npm run dev)
npx wrangler dev --remote          # Use remote Cloudflare resources
npx wrangler deploy                 # Deploy to production (same as npm run deploy)
npx wrangler login                  # Authenticate with Cloudflare
npx wrangler versions upload        # Upload new version with preview URL
```

## Tech Stack & Architecture

This is a **Cloudflare Workers project with Daytona integration** that provides automated GitHub issue processing through Claude Code. It combines:
- **TypeScript Worker** (`src/index.ts`) - Main request router and GitHub integration
- **Daytona SDK Integration** (`src/daytona_client.ts`) - Manages remote sandbox environments for code execution
- **Durable Objects** - `DaytonaSandboxManagerDO` for sandbox lifecycle management and state persistence
- **GitHub App Integration** - Automated webhook processing and repository access

### Key Architecture Points

**Request Flow:**
1. Worker receives requests and routes based on path
2. GitHub webhooks trigger issue processing through Daytona sandbox creation
3. Setup routes (`/claude-setup`, `/daytona-setup`, `/gh-setup/*`) handle API key configuration and service OAuth
4. Status dashboard (`/`) provides comprehensive system health monitoring

**Daytona Sandbox Management:**
- **DaytonaSandboxManagerDO** - Durable Object managing sandbox lifecycle and state
- **DaytonaClient** - TypeScript SDK wrapper for Daytona API operations
- Sandboxes use `claude-code-env` snapshot with pre-installed development tools
- Automatic cleanup of old/unused sandboxes to optimize resource usage
- Complete sandbox workflow: create → clone repository → execute Claude Code → extract changes

**GitHub Integration:**
- Uses GitHub App Manifests for one-click app creation
- Each deployment gets isolated GitHub app with dynamic webhook URLs
- OAuth flow: `/gh-setup` → GitHub → `/gh-setup/callback` → `/gh-setup/install`
- Webhook processing: `/webhooks/github` handles issues, installation events
- Encrypted credential storage in KV storage for GitHub tokens

## Configuration Files

- **`wrangler.jsonc`** - Workers configuration with Daytona SDK, Durable Objects, and KV bindings
- **`worker-configuration.d.ts`** - Auto-generated types (run `npm run cf-typegen` after config changes)
- **`.dev.vars`** - Local environment variables (not committed to git)
- **`scripts/`** - Daytona container building and snapshot creation scripts
- **`package.json`** - Dependencies including `@daytonaio/sdk` and JWT handling

### Key Wrangler Configuration Patterns

```jsonc
{
  "compatibility_date": "2025-08-23",  // Controls API behavior and features
  "compatibility_flags": ["nodejs_compat"], // Enable Node.js API compatibility
  "vars": {                            // Environment variables
    "DAYTONA_API_URL": "https://api.daytona.io",
    "ENVIRONMENT": "development"
  },
  "durable_objects": {                 // Durable Object bindings
    "bindings": [
      { "name": "DAYTONA_SANDBOX_MANAGER", "class_name": "DaytonaSandboxManagerDO" }
    ]
  },
  "kv_namespaces": [                   // KV storage for credentials
    { "binding": "GITHUB_CONFIG", "id": "..." }
  ]
}
```

**After modifying bindings or vars in wrangler.jsonc:**
1. Run `npm run cf-typegen` to update TypeScript types
2. Check that `worker-configuration.d.ts` reflects your changes
3. Update your `Env` interface in TypeScript code if needed

## Development Patterns

**Key Endpoints:**
- `/` - Comprehensive status dashboard with system health monitoring
- `/claude-setup` - Configure Claude API key
- `/daytona-setup` - Configure Daytona API credentials
- `/gh-setup` - GitHub app creation and OAuth setup
- `/gh-status` - Check GitHub configuration status
- `/webhooks/github` - GitHub webhook processor for issue events

**Daytona Sandbox Operations (via DO):**
- `/create` - Create new sandbox with repository clone
- `/execute` - Execute commands in sandbox environment
- `/process-issue` - Complete end-to-end issue processing workflow
- `/get-changes` - Extract git changes and PR summary from sandbox
- `/cleanup` - Remove old/unused sandboxes

**Environment Variables:**
- `DAYTONA_API_URL` - Daytona service endpoint (default: https://api.daytona.io)
- `ENVIRONMENT` - Deployment environment (development/production)
- Sensitive credentials (API keys, tokens) stored in KV storage with encryption

## Cloudflare Workers Best Practices

### Worker Code Structure
```typescript
export interface Env {
  DAYTONA_SANDBOX_MANAGER: DurableObjectNamespace;
  GITHUB_CONFIG: KVNamespace;
  DAYTONA_API_URL?: string;
  ENVIRONMENT?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Worker logic here
    return new Response("Hello World");
  },
} satisfies ExportedHandler<Env>;
```

### Resource Bindings
- **Durable Objects**: Access via `env.DAYTONA_SANDBOX_MANAGER.get(id)` 
- **KV Storage**: Access via `env.GITHUB_CONFIG.get(key)` for encrypted credentials
- **Environment Variables**: Access via `env.VARIABLE_NAME`

### Development Tips
- Use `console.log()` for debugging - visible in `wrangler dev` and deployed logs
- Workers must start within 400ms - keep imports and initialization lightweight  
- Use `.dev.vars` for local secrets (never commit this file)
- Test with `--remote` flag to use actual Cloudflare resources during development
- Daytona SDK operations can be slow - use appropriate timeouts and error handling

## Current Implementation Status

**✅ Completed:**
- Migration from Cloudflare Workers Containers to Daytona sandbox architecture
- Daytona SDK integration with TypeScript client wrapper
- Complete sandbox lifecycle management via Durable Objects
- GitHub App Manifest setup and OAuth flow with KV storage
- End-to-end issue processing: sandbox creation → repository cloning → Claude Code execution → change extraction
- Comprehensive status dashboard with real-time system health monitoring
- Secure credential storage in KV with proper encryption

**🔧 Recent Architectural Changes:**
- **Container → Daytona Migration**: Moved from `cf-containers` to Daytona SDK for better reliability and features
- **Simplified Storage**: Replaced complex Durable Object encryption with KV storage patterns
- **Enhanced Logging**: Improved contextual logging throughout the system with `logWithContext` utility

**Important:** Daytona SDK version is pinned to `@daytonaio/sdk@0.25.6` for stability.

## Project Architecture Summary

This project creates an automated GitHub issue processor powered by Claude Code running in Daytona sandboxes:

1. **Setup Phase**: Configure Claude API key, Daytona credentials, and GitHub app via web interface
2. **Issue Processing**: GitHub webhooks trigger Daytona sandbox creation and repository cloning  
3. **Code Analysis**: Claude Code executes within isolated sandbox environments with full repository access
4. **Solution Implementation**: Changes are tracked via git status and PR summaries are extracted
5. **Result Delivery**: Solutions are delivered as GitHub comments or pull requests

**Key Integration Points:**
- `src/index.ts` - Main Worker with comprehensive status dashboard and request routing
- `src/handlers/github_webhook.ts` - GitHub webhook processing entry point  
- `src/daytona_sandbox_manager.ts` - Durable Object managing complete sandbox workflows
- `src/daytona_client.ts` - TypeScript wrapper for Daytona SDK operations
- `src/handlers/daytona_setup.ts` - Daytona credential configuration and health checking
- `src/kv_storage.ts` - Secure credential storage and retrieval utilities