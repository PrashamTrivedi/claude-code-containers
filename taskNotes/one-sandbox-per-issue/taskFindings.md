# Purpose

Ensure exactly one Daytona sandbox per GitHub issue with proper lifecycle
management

## Original Ask

The sandbox name must be the same as issue id. There must be exactly one sandbox
per issue. If it is not created, create it, if it's stopped, re-start it. If
it's running, use it

## Complexity and the reason behind it

Complexity score: 3/5

Reason: This requires modifying the sandbox lifecycle management to track
sandboxes by issue ID, implement lookup logic, handle different sandbox states
(running/stopped), and ensure idempotent operations. The integration touches
multiple components but the overall architecture remains intact.

## Architectural changes required

- Add sandbox lookup mechanism by issue ID in DaytonaSandboxManagerDO
- Implement sandbox state checking and reuse logic
- Ensure unique sandbox mapping per issue ID
- Add sandbox restart capability for stopped instances

## Backend changes required

1. **DaytonaSandboxManagerDO (`src/daytona_sandbox_manager.ts`)**:
   - Add `findSandboxByIssueId()` method to lookup existing sandboxes
   - Modify `handleCreateSandbox()` to check for existing sandboxes first
   - Add logic to restart stopped sandboxes instead of creating new ones
   - Ensure sandboxes are properly tagged with issue IDs for tracking

2. **Issue Handler (`src/handlers/github_webhooks/issue.ts`)**:
   - Update `routeToClaudeCodeSandbox()` to check for existing sandboxes
   - Implement conditional logic: use existing, restart stopped, or create new
   - Ensure sandbox ID consistency using issue ID

3. **DaytonaClient (`src/daytona_client.ts`)**:
   - Already has `startSandbox()` method for restarting stopped sandboxes
   - May need to add sandbox lookup by labels/tags

## Frontend changes required

None required - this is purely a backend optimization

## Acceptance Criteria

1. Each GitHub issue has exactly one sandbox
2. Sandbox names follow format `claude-issue-{issueId}`
3. When processing an issue:
   - If sandbox exists and running: use it
   - If sandbox exists and stopped: restart it
   - If sandbox doesn't exist: create it
4. No duplicate sandboxes for the same issue
5. Proper error handling for all sandbox states

## Validation

**Important: To test this locally, ensure we send mock events to local server
using curl and observe the logs. For sandbox management, ask me to do the sandox
operations on daytona website and wait for my response**

1. **Create new sandbox for first issue**: Submit GitHub issue #1, verify
   sandbox `claude-issue-1` is created
2. **Reuse running sandbox**: Re-trigger processing for issue #1, verify same
   sandbox is used
3. **Restart stopped sandbox**: Stop sandbox for issue #1, re-trigger
   processing, verify sandbox is restarted
4. **Multiple issues**: Submit issues #2 and #3, verify separate sandboxes are
   created
5. **Check logs**: Verify proper logging for sandbox lookup, reuse, and restart
   operations
6. **Error cases**: Test with invalid sandbox states and network failures
