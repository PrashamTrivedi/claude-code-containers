# Purpose

Simplify architecture by migrating from containerized Claude Code to direct Worker orchestration with Daytona sandboxes

## Original Ask
Worker manages github operations, we can checkout it in a daytona sandbox with the URL based on installation token and use filesystem+git there. Claude will run on `claude -c "cd /tmp/project && claude --dangerously-skip-permissions -p \"$(echo '${messageBase64}' | base64 -d)\" --continue --output-format json"` command

## Complexity and the reason behind it
Complexity score: 4/5 - This is a significant architectural refactoring that affects the core processing flow, requires careful migration of functionality from containers to Worker/Daytona, and changes how Claude Code is invoked.

## Architectural changes required

### Current Architecture
1. **Worker (src/index.ts)**: Routes requests, handles GitHub webhooks
2. **Container (container_src/src/main.ts)**: Heavy Node.js container with Claude Code CLI, handles git operations, runs Claude, creates PRs
3. **Daytona Sandbox Manager DO**: Manages sandbox lifecycle but delegates actual work to container
4. **Flow**: Worker → Container → Clone Repo → Run Claude → Create PR

### Proposed Architecture
1. **Worker**: Orchestrates entire flow, manages GitHub operations (PR creation, comments)
2. **Daytona Sandbox**: Lightweight environment for git/filesystem operations
3. **Claude CLI**: Executed directly in sandbox via command
4. **Flow**: Worker → Clone to Daytona → Execute Claude CLI → Worker creates PR

### Key Changes
- Eliminate container_src directory and container-specific code
- Move GitHub operations from container to Worker
- Use Daytona SDK's native git and filesystem operations
- Execute Claude CLI via Daytona's process execution API
- Remove Docker-related files and build scripts

## Backend changes required

### 1. Update Issue Handler (src/handlers/github_webhooks/issue.ts)
- Remove container routing logic
- Implement new flow:
  - Clone repository to Daytona sandbox using SDK
  - Prepare Claude prompt as base64-encoded message
  - Execute Claude CLI command in sandbox
  - Parse Claude's JSON output
  - Check for file changes using Daytona's git operations
  - Create PR directly from Worker using GitHub API

### 2. Enhance Daytona Sandbox Manager (src/daytona_sandbox_manager.ts)
- Add method for git operations (status, diff, commit, push)
- Add method for file operations (read PR summary file)
- Improve command execution with better output parsing

### 3. Update Daytona Client (src/daytona_client.ts)
- Add git operation methods using SDK's git module
- Add filesystem operation methods using SDK's fs module
- Enhance executeCommand to handle Claude CLI output

### 4. Refactor GitHub Client (src/github_client.ts)
- Move PR creation logic from container to Worker
- Add methods for creating branches and pushing changes
- Ensure proper authentication with installation tokens

### 5. Remove Container Components
- Delete container_src directory 
- Remove Dockerfile and Dockerfile.slim
- Remove container build scripts
- Update wrangler.jsonc to remove container bindings if any

*Note After Review: Running rm commands is not available to you as we speak, you need to ask me to do it once everything else is done*
## Frontend changes required

None required - the frontend dashboard remains unchanged as it only displays status information.

## Acceptance Criteria

1. **Successful Issue Processing**
   - GitHub issues trigger Claude Code analysis in Daytona sandbox
   - Claude CLI executes successfully with proper prompt
   - Solution is generated and returned

2. **Git Operations**
   - Repository cloned to Daytona sandbox with installation token auth
   - File changes detected correctly
   - Commits created with proper message
   - Branch pushed to GitHub

3. **PR Creation**
   - Pull requests created from Worker
   - PR includes Claude's solution and changes
   - Comments posted to original issue

4. **Clean Architecture**
   - No container-related code remains
   - All operations handled by Worker + Daytona
   - Simplified deployment without Docker builds

5. **Error Handling**
   - Graceful handling of Claude CLI failures
   - Proper error messages for git operation failures
   - Fallback to comment posting if PR creation fails

## Validation

### Backend API Flows

1. **Issue Processing Flow**
   ```
   POST /webhooks/github (issue opened)
   → Worker creates Daytona sandbox
   → Clone repo with installation token
   → Execute: claude -c "cd /workspace && claude --dangerously-skip-permissions -p \"$(echo '${messageBase64}' | base64 -d)\" --continue --output-format json"
   → Parse Claude output
   → Check git status for changes
   → Create branch, commit, push
   → Create PR via GitHub API
   → Post comment on issue
   ```

2. **Error Cases**
   - Test with invalid Claude API key
   - Test with non-existent repository
   - Test with insufficient GitHub permissions
   - Test with Claude CLI execution failures

### Commands to Test

```bash
# Start development server
npm run dev


```

### Expected Results
- Issue triggers processing within 30 seconds
- Daytona sandbox created and repository cloned
- Claude CLI executes and generates solution
- PR created with changes (if any)
- Comment posted on issue with solution or PR link
- No container-related errors in logs