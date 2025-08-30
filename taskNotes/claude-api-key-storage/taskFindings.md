# Purpose

Fix Claude API key storage in KV namespace to enable usage in GitHub webhooks

## Original Ask

API key storage not implemented for KV yet... I saved Claude Code key. But it's not stored anywhere... Verify this and fix this if Key can't be used in webhooks

## Complexity and the reason behind it

Complexity score: 2/5
- Simple storage implementation similar to existing GitHub credentials
- Already has KV namespace configured
- Follows existing patterns in the codebase

## Architectural changes required

None required - using existing KV storage architecture already in place for GitHub credentials

## Backend changes required

1. **Update kv_storage.ts**:
   - Add `storeClaudeApiKey()` function to store Claude API key in KV
   - Add `getClaudeApiKey()` function to retrieve Claude API key from KV
   - Add `isClaudeApiKeyConfigured()` function to check if key is configured

2. **Update claude_setup.ts handler**:
   - Replace TODO comment (line 27-28) with actual storage implementation
   - Call `storeClaudeApiKey()` after validating the API key

3. **Update webhook handler (issue.ts)**:
   - Replace TODO comment (line 77) with `getClaudeApiKey()` call
   - Remove hardcoded null value (line 77)

4. **Update github_status.ts**:
   - Add Claude API key configuration status check

## Frontend changes required

None required - existing UI already provides feedback that key is stored

## Acceptance Criteria

Not applicable (complexity < 3)

## Validation

**Test the implementation:**

1. **Store API key:**
   - Navigate to `/claude-setup`
   - Enter a valid Claude API key (sk-ant-...)
   - Verify success message appears
   - Check KV storage contains the key

2. **Verify webhook usage:**
   - Create a new GitHub issue in connected repository
   - Check webhook logs to confirm Claude API key is retrieved from KV
   - Verify no errors about missing Claude API key

3. **Check status endpoint:**
   - Navigate to `/gh-status`
   - Verify Claude API key status shows as configured

**Commands to verify:**
```bash
# Check local development
npm run dev (ALREADY STARTED BY DEVELOPER)

# Test KV storage (using wrangler)
npx wrangler kv key list --namespace-id=04d6303aa26649e7ab79a8184d074ba9

# View stored key (for debugging)
npx wrangler kv key get "claude_api_key" --namespace-id=04d6303aa26649e7ab79a8184d074ba9
```

## Implementation Notes

**Current State Analysis:**
- Claude setup handler receives and validates API key but doesn't store it (line 27-28 in claude_setup.ts)
- Webhook handler expects Claude API key but always gets null (line 77 in issue.ts)
- KV namespace "GITHUB_CONFIG" already exists and is used for GitHub credentials
- Storage pattern already established for GitHub credentials can be reused

**Key Storage Strategy:**
- Store Claude API key in same KV namespace as GitHub config
- Use key name: "claude_api_key"
- Plain text storage (matching GitHub credential pattern)
- Note: While the UI claims encryption, actual implementation stores in plain text like GitHub credentials

**Error Handling:**
- Graceful fallback if key not found
- Clear error messages in webhook logs
- Status endpoint to verify configuration