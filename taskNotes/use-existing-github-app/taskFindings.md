# Purpose

Use an existing GitHub app from KV storage instead of creating new apps every time.

## Original Ask

Instead of creating a new app. We should use an existing APP. There is a KV store called GITHUB_CONFIG. It has key called `github_config` which hosts stringified JSON with app_id, private_key and webhook_secret properties. We should use that app instead of creating new app all the time.

## Complexity and the reason behind it

Complexity score: 2/5 - Simple refactoring since no backward compatibility needed for local deployment.

## Architectural changes required

1. **KV Integration**: Replace Durable Object GitHub app storage with GITHUB_CONFIG KV namespace
2. **Setup Flow Modification**: Modify `/gh-setup` route to check for existing app before creating new one
3. **Single Source of Truth**: Use KV as the primary storage for GitHub app credentials

## Backend changes required

1. **KV Access Layer**: Create new functions to read/write GitHub app config from GITHUB_CONFIG KV namespace
2. **GitHub Setup Handler**: Modify `handleGitHubSetup` to:
   - Check GITHUB_CONFIG KV for existing app
   - If found, display existing app details and installation link
   - If not found, proceed with current app creation flow
3. **Webhook Handler**: Update `handleGitHubWebhook` to get credentials directly from KV
4. **OAuth Callback**: Update `handleOAuthCallback` to store newly created app credentials only in KV
5. **Status Handler**: Update `handleGitHubStatus` to read from KV only

## Frontend changes required

None required - this is a backend-only change that maintains the same user interface.

## Acceptance Criteria

1. System should check GITHUB_CONFIG KV for existing app configuration before creating new app
2. If app exists in KV, use those credentials for webhook verification and API calls
3. New apps created should be stored only in KV
4. Webhook processing should work seamlessly with credentials from KV
5. Status endpoint should read from KV only

## Validation

### Testing Steps:
1. **KV Config Check**: 
   - Store test GitHub app config in GITHUB_CONFIG KV
   - Navigate to `/gh-setup` - should show existing app instead of creating new one
   
2. **Webhook Processing**:
   - Send test webhook with existing app credentials
   - Verify signature validation works with KV-stored credentials
   
3. **New App Creation**:
   - Clear KV
   - Create new app via `/gh-setup`
   - Verify credentials stored in KV only

### Commands to verify:
```bash
# Deploy the updated worker
npm run deploy

# Check KV namespace for config
npx wrangler kv key get --namespace-id=cbbd79b3c302416e812474f4416fb663 "github_config"

# Test webhook endpoint
curl -X POST https://[worker-url]/webhooks/github \
  -H "x-github-event: ping" \
  -H "x-github-delivery: test-123" \
  -H "x-hub-signature-256: [signature]" \
  -d '{"zen": "test"}'
```

### API Flow Cases:
1. **Existing App Flow**: KV has config → Use existing app → Process webhooks
2. **New App Flow**: KV empty → Create new app → Store in KV → Process webhooks