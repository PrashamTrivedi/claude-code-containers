# Purpose

Implement automatic GitHub installation ID discovery and caching to ensure webhooks always have the correct installation context

## Original Ask

Installation id is not always known. This has hampered in webhooks. What we need to do is to create another key in GITHUB_KV per repository that stores github installation id. If the installation id is not found in KV, or webhook, we should generate (or fetch) one for the repository.

## Complexity and the reason behind it

Complexity score: 3/5

Reason: This requires modifying the KV storage schema, implementing GitHub API calls to discover installations, and updating webhook handlers to use the new discovery mechanism. The complexity comes from ensuring backward compatibility and handling edge cases where repositories might be accessible through multiple installations.

## Architectural changes required

1. **KV Storage Schema Extension**:
   - Add new KV namespace pattern: `installation:{owner}/{repo}` → `installationId`
   - Maintain TTL-based cache invalidation (e.g., 7 Days) to handle installation changes

2. **Installation Discovery Service**:
   - New function to list all GitHub App installations
   - New function to find installation ID for a specific repository
   - Caching layer to reduce API calls

3. **Webhook Handler Enhancement**:
   - Check for installation ID in this order:
     1. Webhook payload (`data.installation?.id`)
     2. KV cache (`installation:{owner}/{repo}`)
     3. Dynamic discovery via GitHub API
   - Update cache after successful discovery

## Backend changes required

1. **Update `src/kv_storage.ts`**:
   - Add `getInstallationIdForRepository(owner: string, repo: string)` function
   - Add `storeInstallationIdForRepository(owner: string, repo: string, installationId: string)` function
   - Add TTL support for installation ID cache entries

2. **Create `src/github_installation_discovery.ts`**:
   - Implement `listAllInstallations()` - fetches all app installations
   - Implement `findInstallationForRepository(owner: string, repo: string)` - finds the right installation
   - Implement `getOrDiscoverInstallationId(owner: string, repo: string, webhookInstallationId?: string)` - main entry point

3. **Update webhook handlers**:
   - Modify `src/handlers/github_webhooks/issue.ts` to use new discovery mechanism
   - Update other webhook handlers to follow the same pattern
   - Add proper error handling for cases where no installation is found

4. **Update `src/crypto.ts`**:
   - Ensure `generateInstallationToken` has proper error handling
   - Consider adding retry logic for transient failures

## Frontend changes required

None required - this is a backend-only change for webhook processing

## Acceptance Criteria

1. **Installation Discovery**:
   - System can list all GitHub App installations
   - System can find the correct installation for any repository the app has access to
   - Installation IDs are cached in KV storage with proper TTL

2. **Webhook Processing**:
   - Webhooks work even when installation ID is not in the payload
   - System falls back to discovery when KV cache misses
   - Proper error messages when repository is not accessible through any installation

3. **Performance**:
   - Cached installation IDs are used when available
   - API calls to GitHub are minimized through caching
   - Discovery process completes within 5 seconds

## Validation

### Backend API Flows:

1. **Test Installation Discovery**:
   ```bash
   # Trigger a webhook without installation ID
   curl -X POST /webhooks/github \
     -H "X-GitHub-Event: issues" \
     -d '{"action": "opened", "repository": {"full_name": "owner/repo"}}'
   ```

2. **Verify KV Cache**:
   ```bash
   # Check if installation ID was cached
   wrangler kv:key get --binding=GITHUB_CONFIG "installation:owner/repo"
   ```

3. **Test Cache Expiry**:
   - Set a short TTL for testing
   - Verify re-discovery after expiry
   - Confirm new installation ID is cached

### Edge Cases to Test:

1. Repository accessible through multiple installations (org + user)
2. Repository removed from installation (should clear cache)
3. App uninstalled and reinstalled (new installation ID)
4. Rate limiting on GitHub API calls
5. Network failures during discovery