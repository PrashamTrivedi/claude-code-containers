# Purpose

Replace direct REST API calls with Daytona TypeScript SDK for cleaner and more maintainable code

## Original Ask
Update daytona calls with TypeScript SDK. Take Nightona worker and sandbox manager as inspiration. MUST HAVE: There must not be any Rest API calls for Daytona.

## Complexity and the reason behind it
Complexity score: 2/5
Reason: Simple refactoring required - replacing newly written REST API implementation with SDK methods. No backward compatibility concerns since this is fresh code.

## Architectural changes required

- Replace custom `DaytonaClient` class with SDK-based implementation
- Update Durable Object to use SDK methods instead of direct API calls
- Simplify code structure by leveraging SDK's built-in features
- Adopt SDK's native error handling patterns

## Backend changes required

### Files to modify:
1. **src/daytona_client.ts**
   - Replace REST API implementation with SDK-based approach
   - Create clean SDK wrapper class using `@daytonaio/sdk`
   - Design optimal interface leveraging SDK capabilities

2. **src/daytona_sandbox_manager.ts**
   - Update to use new SDK-based client
   - Replace direct API calls with SDK methods
   - Implement SDK-native error handling
   - Optimize state management using SDK features

3. **src/handlers/daytona_setup.ts** (if needed)
   - Update credential handling for SDK initialization
   - Ensure proper SDK configuration

### SDK Method Mappings:
- `createSandbox()` → `daytona.create()`
- `getSandbox()` → `daytona.findOne()`
- `listSandboxes()` → `daytona.list()`
- `startSandbox()` → `sandbox.start()`
- `stopSandbox()` → `sandbox.stop()`
- `deleteSandbox()` → `sandbox.delete()`
- `executeCommand()` → `sandbox.process.executeCommand()`
- `waitForSandboxStatus()` → `sandbox.waitUntilStarted()` / `sandbox.waitUntilStopped()`

## Frontend changes required

None required - this is purely a backend SDK migration

## Acceptance Criteria

1. All REST API calls to Daytona are replaced with SDK methods
2. SDK-based implementation provides clean, maintainable code
3. Error handling properly captures and handles SDK exceptions
4. All sandbox lifecycle operations work correctly
5. Command execution in sandboxes functions properly
6. Health check mechanism works with SDK connectivity

## Validation

### Backend API Flows:
1. **Sandbox Creation Flow**
   - Test creating a new sandbox via `/create` endpoint
   - Verify sandbox reaches 'running' state
   - Confirm proper error handling for invalid requests

2. **Command Execution Flow**
   - Execute test commands in running sandbox
   - Verify stdout/stderr capture
   - Test working directory and environment variable support

3. **Sandbox Lifecycle Management**
   - Test start/stop/delete operations
   - Verify state transitions are properly tracked
   - Confirm cleanup operations work correctly

4. **Health Check**
   - Verify `/health` endpoint returns correct status
   - Test SDK connectivity validation

### Commands to run:
```bash
npm run dev                    # Start local development
npm run cf-typegen            # Regenerate types if needed
npm run deploy                # Deploy to production
```

### Manual Testing Steps:
1. Configure Daytona API credentials via `/daytona-setup`
2. Create a test sandbox via API or UI
3. Execute commands in the sandbox
4. Test sandbox lifecycle operations
5. Verify cleanup and health check functionality