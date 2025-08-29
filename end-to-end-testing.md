# End-to-End Testing Guide

This guide explains how to test the complete Claude Code GitHub integration workflow.

## Prerequisites

Before testing, ensure the following components are configured:

### 1. Configure Claude API Key
Visit `/claude-setup` to configure your Anthropic API key for Claude Code processing.

### 2. Setup GitHub App
Visit `/gh-setup` to:
- Create a GitHub App with proper permissions
- Configure webhook URL and authentication
- Install the app on your test repositories

### 3. Install GitHub App on Repositories
Ensure the GitHub app is installed on repositories where you want to test issue processing.

## Testing Flow

### Step 1: Create Test Issue
Create a new issue in a GitHub repository where the app is installed. The issue should:
- Have a clear problem description
- Be actionable (something Claude Code can potentially solve)
- Include relevant labels if applicable

### Step 2: Webhook Processing
When the issue is created, the following automatic flow occurs:

1. **GitHub webhook triggers** → `POST /webhooks/github`
2. **Event routing** → `handleIssuesEvent()` processes the "opened" action
3. **Container creation** → Unique container spawned: `claude-issue-{issueId}`
4. **Authentication** → Installation token generated from stored GitHub credentials

### Step 3: Claude Code Processing
Inside the container:

1. **Repository cloning** → Full repo cloned with authenticated GitHub token
2. **Workspace setup** → Git configured for development workflow
3. **Claude Code execution** → Runs with issue context and repository access
4. **Solution implementation** → Claude analyzes codebase and implements fixes
5. **Change detection** → Git status checked for file modifications

### Step 4: Solution Delivery
Based on whether code changes were made:

**If Code Changes Made:**
- Feature branch created: `claude-code/issue-{number}-{timestamp}`
- Changes committed: `Fix issue #{number}: {title}`
- Branch pushed to remote repository
- Pull request created with solution
- Issue comment posted linking to PR

**If No Code Changes:**
- Solution posted as comment on original issue
- No PR created

## Development Commands

```bash
npm run dev          # Start local development server (http://localhost:8787)
npm run deploy       # Deploy to Cloudflare Workers for real webhook testing
npm run cf-typegen   # Generate TypeScript types after config changes
```

## Expected Outcomes

### Scenario 1: Successful Code Implementation
- **Timeline:** 30-60 seconds for simple issues
- **Deliverables:**
  - New feature branch in repository
  - Pull request with implemented solution
  - Issue comment linking to PR
  - Commit message following conventional format

### Scenario 2: Analysis/Guidance Only
- **Timeline:** 15-30 seconds
- **Deliverables:**
  - Detailed comment on issue with analysis
  - Recommendations or step-by-step guidance
  - No code changes or PR

### Scenario 3: Error Handling
- **Common Issues:**
  - Missing API keys → Check `/claude-setup` and `/gh-setup`
  - Repository access denied → Verify GitHub app installation
  - Container timeout → Issue too complex (45-second limit)
- **Fallback:** Error details posted as issue comment

## Testing Checklist

- [ ] Claude API key configured at `/claude-setup`
- [ ] GitHub app created and configured at `/gh-setup`
- [ ] App installed on test repository
- [ ] Test issue created with clear, actionable problem
- [ ] Webhook received and processed (check logs)
- [ ] Container spawned and executed successfully
- [ ] Solution delivered (PR or comment)
- [ ] Issue updated with result

## Monitoring and Debugging

### Local Development
- Use `npm run dev` for local testing
- Check console logs for detailed execution flow
- Test webhook endpoint: `http://localhost:8787/webhooks/github`

### Production Deployment
- Use `npm run deploy` for production testing
- Monitor Cloudflare Workers logs
- Test webhook endpoint: `https://your-worker.workers.dev/webhooks/github`

### Key Log Points
- `WEBHOOK`: Request received and signature verification
- `ISSUES_EVENT`: Issue processing start
- `CLAUDE_ROUTING`: Container creation and token generation
- `ISSUE_PROCESSOR`: Claude Code execution and results
- `GIT_WORKSPACE`: Repository operations and PR creation

## Current Limitations

1. **Claude API Key Storage**: Manual configuration required (KV integration pending)
2. **Processing Timeout**: 45-second container limit for complex issues
3. **Single Repository**: Each container processes one issue at a time
4. **Error Recovery**: Limited retry mechanisms for failed operations

## Advanced Testing

### Load Testing
Create multiple issues simultaneously to test container scaling and load balancing.

### Error Scenarios
- Test with invalid API keys
- Test with private repositories (access permissions)
- Test with large repositories (cloning performance)
- Test with complex issues requiring multiple file changes

### Integration Testing
- Test different issue types (bug reports, feature requests, documentation)
- Test with different repository structures and languages
- Test label-based routing or filtering