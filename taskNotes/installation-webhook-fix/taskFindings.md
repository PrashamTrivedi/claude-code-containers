# Purpose

Fix webhook installation ID issue where GitHub issue webhooks don't contain installation details, preventing token generation.

## Original Ask

The webhook expects that either issue or repository has the installation. But none of those events have the installation details. If we can't get the details from webhook, we need to make sure that we get the installation the other-way to continue fetching the token. The github app details are in KV and there must be an installation Github API which is giving us the installation id. Or some other API...

## Complexity and the reason behind it

Complexity score: **4/5**

**Reasons for complexity:**
1. The bug involves webhook payload structure misunderstanding 
2. Requires API research and integration for fallback installation detection
3. Multiple code paths need updating (issue handler, token generation)
4. Error handling for edge cases where installation cannot be determined
5. Testing across different webhook scenarios

## Architectural changes required

**Current Architecture Issue:**
- Code incorrectly looks for `repository.installation?.id` in issue.ts:35
- According to GitHub webhook docs, `installation` field is at the top level of webhook payload, not nested under repository
- Need fallback mechanism using GitHub Apps API when installation ID is missing

**Proposed Architecture:**
1. **Primary Path:** Extract installation ID from top-level `data.installation` field in webhook payload
2. **Fallback Path:** Use GitHub Apps API `GET /repos/{owner}/{repo}/installation` to get installation details
3. **Error Handling:** Graceful degradation when installation cannot be determined

## Backend changes required

**File: `/src/handlers/github_webhooks/issue.ts`**

1. **Fix Primary Installation Detection:**
   - Change line 35 from `repository.installation?.id?.toString()` to `data.installation?.id?.toString()`
   - Update `routeToClaudeCodeContainer` to accept `installation` parameter from webhook payload

2. **Add Fallback Installation Detection:**
   - Create `getInstallationIdFallback()` function using GitHub Apps API
   - Use `GET /repos/{owner}/{repo}/installation` endpoint with JWT authentication
   - Import and use existing JWT generation from crypto.ts

3. **Update Token Generation Flow:**
   ```typescript
   // Primary: Get from webhook payload
   let installationId = data.installation?.id?.toString()
   
   // Fallback: Use GitHub API
   if (!installationId) {
     installationId = await getInstallationIdFallback(repository.owner.login, repository.name, env)
   }
   ```

**File: `/src/handlers/github_webhook.ts`**
- Update `handleIssuesEvent()` call to pass the full `data` object instead of destructuring

**New Utility Function:**
- Add `getInstallationIdFromRepository()` function to handle API-based installation detection

## Frontend changes required

No frontend changes required - this is a backend webhook processing issue.

## Acceptance Criteria

1. **Issue webhooks process successfully** when installation ID is in webhook payload
2. **Fallback mechanism works** when installation ID is missing from webhook payload
3. **Token generation succeeds** for both primary and fallback scenarios
4. **Proper logging** shows which method was used to obtain installation ID
5. **Error handling** gracefully handles cases where installation cannot be determined
6. **No breaking changes** to existing webhook processing flow

## Validation

**Testing Commands:**
```bash
# Deploy and test with actual GitHub webhook
npm run deploy

# Test with webhook delivery that has installation field
curl -X POST {webhook-url}/webhooks/github \
  -H "X-GitHub-Event: issues" \
  -H "X-Hub-Signature-256: sha256=..." \
  -d @test-issue-payload.json

# Monitor logs for successful installation ID detection
npx wrangler tail --format pretty
```

**Test Cases:**

1. **Normal Webhook with Installation:**
   - Send issue webhook with `installation` field present
   - Verify installation ID extracted from `data.installation.id`
   - Verify token generation succeeds

2. **Webhook Missing Installation (Fallback):**
   - Send issue webhook without `installation` field
   - Verify fallback API call to GitHub Apps endpoint
   - Verify installation ID retrieved via API
   - Verify token generation succeeds

3. **Error Cases:**
   - Repository not found/private access
   - GitHub App not installed on repository
   - API rate limiting scenarios
   - Verify graceful error handling and logging

**API Testing:**
- Use GitHub API to verify installation exists: `GET /repos/{owner}/{repo}/installation`
- Validate JWT token generation works for GitHub Apps API calls
- Test with both public and private repositories (if app has access)

**Verification Steps:**
1. Check webhook logs show installation ID detection method used
2. Verify Claude Code container receives valid GitHub token
3. Confirm issue processing completes without installation-related errors
4. Test both webhook scenarios (with and without installation field)