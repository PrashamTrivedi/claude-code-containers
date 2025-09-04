# Purpose

Fix the bug where sandbox creation fails after clearing all sandboxes, causing
"sandbox is not running" errors during repository cloning

## Original Ask

Bug in reusable sandbox container (Refer what we did). I have cleared all
sandboxes on daytona, and edited an issue, here is the error log. If it's not
started start it, if it's not created, create new and remove the old one

Error: "Failed to clone repository: Failed to execute command: \"Sandbox is not
running\""

**Key Context**: All sandboxes were manually cleared from Daytona, so the system
needs to create a completely new sandbox but is failing.

## Complexity and the reason behind it

**Complexity: 4/5**

The bug involves a state synchronization issue between the Durable Object's
stored state and the actual Daytona platform state. When sandboxes are manually
cleared, the DO still has stale references to non-existent sandboxes, causing
the reuse logic to fail and new sandbox creation to encounter state management
issues.

## Architectural changes required

None required - the architecture is sound, but we need to add better state
validation and recovery mechanisms.

## Backend changes required

### 1. **State Synchronization After Manual Sandbox Clearing**

- Add validation in `findSandboxByIssueId` to verify stored sandboxes actually
  exist on Daytona
- When sandbox doesn't exist on Daytona but exists in stored state, remove it
  from stored state
- Ensure clean slate when all sandboxes are manually cleared

### 2. **Robust New Sandbox Creation Process**

- Add proper state validation after `createSandbox` call
- Ensure sandbox reaches "running" state before proceeding to clone operation
- Add timeout and retry logic for sandbox startup

### 3. **Enhanced Clone Operation with State Checks**

- Validate sandbox is running before attempting clone in `handleCloneAndSetup`
- If sandbox exists but not running, attempt to start it first
- If start fails or sandbox doesn't exist, create a new one and cleanup old
  references

### 4. **Improved Error Recovery in Issue Processing**

- Add comprehensive error handling for sandbox state mismatches
- Implement fallback flow: check state -> start if stopped -> create if missing
  -> retry operation
- Clean up stale state references when operations fail due to missing sandboxes

## Frontend changes required

None required - this is purely a backend issue with sandbox state management.

## Acceptance Criteria

1. **Post-Clear Recovery**
   - System correctly handles scenario where all sandboxes have been manually
     cleared
   - Stored state is automatically synchronized with actual Daytona platform
     state
   - New sandboxes are created successfully when none exist

2. **State Synchronization**
   - Durable Object state matches actual Daytona platform state
   - Stale references to deleted sandboxes are automatically cleaned up
   - System gracefully handles state mismatches

3. **Robust Sandbox Operations**
   - New sandbox creation works reliably after manual clearing
   - Repository cloning succeeds consistently with proper sandbox state
     validation
   - All operations complete successfully even starting from empty Daytona
     platform

4. **Error Elimination**
   - No "sandbox is not running" errors when sandboxes have been cleared
   - Proper error messages if sandbox creation actually fails
   - Clean error recovery without exposing internal state issues

## Validation

**Important: To test this locally, ensure we send mock events to local server
using curl and observe the logs. For sandbox management, ask me to do the sandbox
operations on daytona website and wait for my response**

### Commands to test:

1. Clear all sandboxes on Daytona platform
2. Edit a GitHub issue to trigger webhook
3. Monitor logs for successful processing without "sandbox not running" errors

### Expected behavior:

- System detects sandbox state issues
- Automatically recovers by starting or recreating sandbox
- Successfully clones repository and processes issue
- Posts appropriate comment on GitHub issue

### Backend API Flow:

1. **Create/Reuse Sandbox**: GET `/create` -> Verify sandbox state
2. **Clone Repository**: POST `/clone-and-setup` -> Check state, restart if
   needed, then clone
3. **Execute Claude**: POST `/execute-claude` -> Verify running state before
   execution
4. **Get Changes**: POST `/get-changes` -> Ensure sandbox still active
