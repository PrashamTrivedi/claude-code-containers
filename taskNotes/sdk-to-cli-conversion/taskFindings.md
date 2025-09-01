# Purpose

Convert Claude Code SDK implementation to CLI-based approach for containerized GitHub issue processing

## Original Ask
Read about headless mode, native binary installations, and CLI Reference for Claude Code, then convert Claude Code SDK usage `import {query, type SDKMessage} from '@anthropic-ai/claude-code'` to CLI commands

## Complexity and the reason behind it
Complexity score: 3/5
- Medium complexity due to paradigm shift from SDK to CLI
- Requires refactoring Node.js async iterators to process-based command execution
- Need to handle CLI output parsing and error handling differently
- Must maintain existing GitHub integration functionality

## Architectural changes required

The current architecture uses the Claude Code SDK within a Node.js container to process GitHub issues. The conversion will:

1. **Replace SDK imports** with child process spawning of CLI commands
2. **Modify response handling** from async iterators to stdout/stderr parsing
3. **Update error handling** to account for process exit codes and CLI-specific errors
4. **Maintain existing endpoints** while changing internal implementation

## Backend changes required

### 1. Container Image Updates
- Install Claude Code CLI binary in Dockerfile
- Remove `@anthropic-ai/claude-code` SDK dependency
- Ensure proper PATH configuration for CLI access

### 2. Main Processing Logic (container_src/src/main.ts)
- Remove SDK import: `import {query, type SDKMessage} from '@anthropic-ai/claude-code'`
- Implement CLI wrapper functions using `child_process.spawn()`
- Convert async iterator pattern to process output streaming
- Parse CLI JSON output for structured responses

### 3. Key Function Conversions

#### Current SDK Usage:
```typescript
for await (const message of query({
  prompt,
  options: {permissionMode: 'bypassPermissions'}
})) {
  // Process message
}
```

#### CLI Equivalent:
```bash
claude -p "<prompt>" \
  --output-format json \
  --permission-mode bypassPermissions \
  --allowedTools "Bash,Read,Edit,Write,Grep,Glob"
```

### 4. Response Handling
- Parse JSON output from CLI when using `--output-format json`
- Handle streaming JSON for multi-turn conversations
- Extract relevant content from CLI response structure

### 5. Error Handling
- Check process exit codes (0 = success, non-zero = error)
- Parse stderr for error messages
- Implement timeout handling for long-running CLI processes

### 6. Environment Variables
- Continue using `ANTHROPIC_API_KEY` (CLI respects this)
- Ensure proper environment variable propagation to spawned processes

## Frontend changes required

None required - the container's HTTP endpoints remain unchanged

## Acceptance Criteria

1. **Functional Requirements**
   - GitHub issue processing continues to work as before
   - Pull requests are created successfully with code changes
   - Comments are posted to issues with solutions
   - Test endpoint `/test-claude` works with CLI

2. **Technical Requirements**
   - Claude Code CLI is properly installed in container
   - All SDK references are removed from codebase
   - CLI commands execute with appropriate flags
   - JSON output is properly parsed
   - Error handling captures CLI failures

3. **Performance Requirements**
   - Response times remain comparable to SDK version
   - Memory usage stays within container limits
   - Proper cleanup of spawned processes

## Validation

### Testing Commands:
```bash
# Build and test container locally
npm run dev

# Test Claude integration
curl -X POST http://localhost:8787/test-claude \
  -H "Content-Type: application/json" \
  -d '{
    "ANTHROPIC_API_KEY": "your-key",
    "CLAUDE_TEST_MODE": "true",
    "CLAUDE_TEST_PROMPT": "Hello, respond with a greeting"
  }'

# Verify CLI installation in container
docker exec <container-id> claude --version
docker exec <container-id> claude doctor
```

### API Flow Testing:
1. **Health Check**: GET `/` - Verify container is running
2. **Claude Test**: POST `/test-claude` - Test CLI execution
3. **Issue Processing**: POST `/process-issue` - Full GitHub issue workflow

### Expected CLI Command Structure:
The main CLI invocation will be:
```javascript
const claudeProcess = spawn('claude', [
  '-p', prompt,
  '--output-format', 'json',
  '--permission-mode', 'bypassPermissions',
  '--allowedTools', 'Bash,Read,Edit,Write,Grep,Glob',
  '--model', 'sonnet'  // or configurable
]);
```

### Key Implementation Notes:
1. Use `--output-format json` for structured parsing
2. Include `--permission-mode bypassPermissions` for automated execution
3. Specify allowed tools to match SDK functionality
4. Handle both stdout and stderr streams
5. Implement proper process cleanup on completion/error