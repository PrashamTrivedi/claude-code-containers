import {GitHubAPI} from "../../github_client"
import {logWithContext} from "../../log"
import {generateInstallationToken, getClaudeApiKey} from '../../kv_storage'
import {getOrDiscoverInstallationId} from '../../github_installation_discovery'
import {getDaytonaCredentials} from '../daytona_setup'

// Interface for Claude CLI JSON output
interface ClaudeCliOutput {
  success: boolean
  result?: string
  error?: string
  changes?: {
    files: string[]
    summary: string
  }
}

// Route GitHub issue to Claude Code Daytona sandbox with new architecture
async function routeToClaudeCodeSandbox(issue: any, repository: any, env: any, webhookData?: any): Promise<void> {
  const sandboxName = `claude-issue-${issue.id}`

  logWithContext('CLAUDE_ROUTING', 'Routing issue to Claude Code Daytona sandbox with new architecture', {
    issueNumber: issue.number,
    issueId: issue.id,
    sandboxName,
    repository: repository.full_name
  })

  // Get Daytona sandbox manager DO
  const id = env.DAYTONA_SANDBOX_MANAGER.idFromName('default')
  const sandboxManager = env.DAYTONA_SANDBOX_MANAGER.get(id)

  // Extract repository owner/name
  const [owner, repo] = repository.full_name.split('/')
  
  // Get installation ID with discovery fallback
  logWithContext('CLAUDE_ROUTING', 'Discovering installation ID for repository', {
    owner,
    repo,
    webhookInstallationId: webhookData?.installation?.id?.toString()
  })

  const installationId = await getOrDiscoverInstallationId(
    env,
    owner,
    repo,
    webhookData?.installation?.id?.toString()
  )

  if (!installationId) {
    logWithContext('CLAUDE_ROUTING', 'No installation ID found for repository', {
      owner,
      repo,
      repository: repository.full_name
    })
    throw new Error(`No GitHub App installation found for repository ${repository.full_name}`)
  }

  // Generate installation token
  logWithContext('CLAUDE_ROUTING', 'Generating installation token', {
    installationId,
    repository: repository.full_name
  })

  const installationToken = await generateInstallationToken(env, installationId)

  logWithContext('CLAUDE_ROUTING', 'Installation token retrieved', {
    hasToken: !!installationToken,
    installationId
  })

  if (!installationToken) {
    logWithContext('CLAUDE_ROUTING', 'Failed to generate installation token')
    throw new Error('Failed to generate GitHub installation token')
  }

  // Get Claude API key from secure storage
  logWithContext('CLAUDE_ROUTING', 'Retrieving Claude API key from KV storage')

  const claudeApiKey = await getClaudeApiKey(env)

  logWithContext('CLAUDE_ROUTING', 'Claude API key check', {
    hasApiKey: !!claudeApiKey
  })

  if (!claudeApiKey) {
    logWithContext('CLAUDE_ROUTING', 'Claude API key not configured')
    throw new Error('Claude API key not configured. Please visit /claude-setup first.')
  }

  // Initialize GitHub API client for Worker-based operations
  const githubAPI = new GitHubAPI({
    async getInstallationToken() {
      return installationToken
    }
  })

  try {
    // Step 1: Create Daytona sandbox for the issue
    logWithContext('CLAUDE_ROUTING', 'Creating Daytona sandbox for issue processing', {
      sandboxName,
      issueId: issue.id.toString()
    })

    const createResponse = await sandboxManager.fetch(new Request('http://internal/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: sandboxName,
        projectName: repository.name,
        gitUrl: repository.clone_url,
        envVars: {
          ANTHROPIC_API_KEY: claudeApiKey,
          GITHUB_TOKEN: installationToken
        },
        issueId: issue.id.toString(),
        repositoryName: repository.full_name
      })
    }))

    if (!createResponse.ok) {
      const errorText = await createResponse.text().catch(() => 'Unable to read sandbox creation error')
      logWithContext('CLAUDE_ROUTING', 'Sandbox creation failed', {
        status: createResponse.status,
        errorText
      })
      throw new Error(`Sandbox creation failed with status ${createResponse.status}: ${errorText}`)
    }

    const createResult = await createResponse.json()

    if (!createResult.success) {
      logWithContext('CLAUDE_ROUTING', 'Sandbox creation unsuccessful', {
        error: createResult.error
      })
      throw new Error(`Sandbox creation failed: ${createResult.error}`)
    }

    const sandboxId = createResult.sandboxId

    logWithContext('CLAUDE_ROUTING', 'Sandbox created successfully', {
      sandboxId,
      sandboxName
    })

    // Step 2: Clone repository using Daytona git operations
    logWithContext('CLAUDE_ROUTING', 'Cloning repository in sandbox')

    const cloneResponse = await sandboxManager.fetch(new Request('http://internal/clone-and-setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sandboxId,
        gitUrl: repository.clone_url,
        installationToken,
        workspaceDir: '/workspace'
      })
    }))

    if (!cloneResponse.ok) {
      const errorText = await cloneResponse.text().catch(() => 'Unable to read clone error')
      logWithContext('CLAUDE_ROUTING', 'Repository cloning failed', {
        status: cloneResponse.status,
        errorText
      })
      throw new Error(`Repository cloning failed: ${errorText}`)
    }

    const cloneResult = await cloneResponse.json()
    if (!cloneResult.success) {
      throw new Error(`Repository cloning failed: ${cloneResult.error}`)
    }

    logWithContext('CLAUDE_ROUTING', 'Repository cloned successfully')

    // Step 3: Execute Claude CLI with specific command format
    const prompt = `You are working on GitHub issue #${issue.number}: "${issue.title}"

Issue Description:
${issue.body || 'No description provided'}

Labels: ${issue.labels?.map((label: any) => label.name).join(', ') || 'None'}
Author: ${issue.user.login}

The repository has been cloned to your current working directory. Please:
1. Explore the codebase to understand the structure and relevant files
2. Analyze the issue requirements thoroughly
3. Implement a solution that addresses the issue
4. Write appropriate tests if needed
5. Ensure code quality and consistency with existing patterns

**IMPORTANT: If you make any file changes, please create a file called '.claude-pr-summary.md' in the root directory with a concise summary (1-3 sentences) of what changes you made and why. This will be used for the pull request description.**

Work step by step and provide clear explanations of your approach.`

    logWithContext('CLAUDE_ROUTING', 'Executing Claude CLI with issue prompt')

    const executeResponse = await sandboxManager.fetch(new Request('http://internal/execute-claude', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sandboxId,
        prompt
      })
    }))

    if (!executeResponse.ok) {
      const errorText = await executeResponse.text().catch(() => 'Unable to read execution error')
      logWithContext('CLAUDE_ROUTING', 'Claude execution failed', {
        status: executeResponse.status,
        errorText
      })
      throw new Error(`Claude execution failed: ${errorText}`)
    }

    const executeResult = await executeResponse.json()

    logWithContext('CLAUDE_ROUTING', 'Claude CLI execution completed', {
      success: executeResult.success,
      exitCode: executeResult.data?.exitCode,
      stdoutLength: executeResult.data?.stdout?.length || 0,
      stderrLength: executeResult.data?.stderr?.length || 0
    })

    // Step 4: Check for git changes
    logWithContext('CLAUDE_ROUTING', 'Checking for file changes')

    const changesResponse = await sandboxManager.fetch(new Request('http://internal/get-changes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sandboxId,
        workspaceDir: '/workspace'
      })
    }))

    if (!changesResponse.ok) {
      const errorText = await changesResponse.text().catch(() => 'Unable to read changes error')
      logWithContext('CLAUDE_ROUTING', 'Failed to get changes', {
        status: changesResponse.status,
        errorText
      })
      throw new Error(`Failed to get changes: ${errorText}`)
    }

    const changesResult = await changesResponse.json()

    if (!changesResult.success) {
      throw new Error(`Failed to get changes: ${changesResult.error}`)
    }

    const { hasChanges, prSummary } = changesResult.data

    logWithContext('CLAUDE_ROUTING', 'Changes analysis completed', {
      hasChanges,
      prSummaryLength: prSummary?.length || 0
    })

    if (hasChanges) {
      // Step 5: Create branch, commit and push changes using Daytona
      const branchName = `claude-fix-issue-${issue.number}`
      const commitMessage = `🤖 Claude Code: Fix issue #${issue.number} - ${issue.title}

${prSummary}

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`

      logWithContext('CLAUDE_ROUTING', 'Creating commit and pushing changes', {
        branchName,
        commitMessage: commitMessage.substring(0, 100) + '...'
      })

      // Use Daytona git operations to commit and push
      const commitResponse = await sandboxManager.fetch(new Request('http://internal/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sandboxId,
          command: `cd /workspace && git checkout -b ${branchName} && git add . && git commit -m "${commitMessage}" && git push origin ${branchName}`,
          workingDirectory: '/workspace'
        })
      }))

      if (!commitResponse.ok) {
        const errorText = await commitResponse.text().catch(() => 'Unable to read commit error')
        logWithContext('CLAUDE_ROUTING', 'Commit and push failed', {
          status: commitResponse.status,
          errorText
        })
        throw new Error(`Commit and push failed: ${errorText}`)
      }

      const commitResult = await commitResponse.json()

      if (!commitResult.success || commitResult.data.exitCode !== 0) {
        logWithContext('CLAUDE_ROUTING', 'Git operations failed', {
          exitCode: commitResult.data?.exitCode,
          stderr: commitResult.data?.stderr
        })
        throw new Error(`Git operations failed: ${commitResult.data?.stderr}`)
      }

      logWithContext('CLAUDE_ROUTING', 'Changes committed and pushed successfully')

      // Step 6: Create pull request using Worker GitHub API
      try {
        const prTitle = `🤖 Claude Code: Fix issue #${issue.number} - ${issue.title}`
        const prBody = `## Summary

${prSummary}

## Issue Context
- **Issue**: #${issue.number}
- **Author**: ${issue.user.login}
- **Labels**: ${issue.labels?.map((label: any) => label.name).join(', ') || 'None'}

## Changes Made
This pull request contains changes generated by Claude Code to address the reported issue.

---

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>`

        logWithContext('CLAUDE_ROUTING', 'Creating pull request from Worker', {
          branchName,
          prTitle
        })

        const pullRequest = await githubAPI.createPullRequestFromWorker(
          owner,
          repo,
          prTitle,
          prBody,
          branchName,
          'main'  // Assuming main as default branch
        )

        logWithContext('CLAUDE_ROUTING', 'Pull request created successfully', {
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.html_url
        })

        // Step 7: Post comment on original issue
        const issueComment = `🤖 **Claude Code has analyzed this issue and created a solution!**

I've created pull request #${pullRequest.number} with the following changes:

${prSummary}

Please review the changes and merge if they address your issue. If you need any modifications, please let me know in the comments.

**Pull Request**: ${pullRequest.html_url}

---
🤖 Powered by [Claude Code](https://claude.ai/code)`

        await githubAPI.postIssueComment(owner, repo, issue.number, issueComment)

        logWithContext('CLAUDE_ROUTING', 'Issue comment posted successfully')

      } catch (error) {
        logWithContext('CLAUDE_ROUTING', 'Failed to create PR, posting comment instead', {
          error: (error as Error).message
        })

        // Fallback: Post comment about the changes
        const fallbackComment = `🤖 **Claude Code has analyzed this issue and made changes!**

I've successfully processed your issue and made the following changes:

${prSummary}

However, I encountered an issue creating the pull request automatically. The changes have been committed to branch \`${branchName}\` and are ready for manual review.

**Branch**: \`${branchName}\`

---
🤖 Powered by [Claude Code](https://claude.ai/code)`

        await githubAPI.postIssueComment(owner, repo, issue.number, fallbackComment)
      }

    } else {
      // No changes made - post analysis comment
      logWithContext('CLAUDE_ROUTING', 'No changes made, posting analysis comment')

      const analysisComment = `🤖 **Claude Code has analyzed this issue.**

I've thoroughly reviewed the issue and explored the codebase, but I determined that no code changes are needed at this time. This could be because:

- The issue has already been resolved
- The issue requires clarification or more information
- The requested change is not appropriate for the current codebase
- The issue is a question or discussion rather than a code change

${executeResult.data?.stdout ? `

**Analysis Details:**
\`\`\`
${executeResult.data.stdout.substring(0, 1000)}${executeResult.data.stdout.length > 1000 ? '...' : ''}
\`\`\`
` : ''}

If you believe changes are still needed, please provide more details or clarify the requirements.

---
🤖 Powered by [Claude Code](https://claude.ai/code)`

      await githubAPI.postIssueComment(owner, repo, issue.number, analysisComment)

      logWithContext('CLAUDE_ROUTING', 'Analysis comment posted successfully')
    }

    // Cleanup sandbox (optional - could be kept for debugging)
    // await sandboxManager.fetch(new Request(`http://internal/cleanup?maxAgeHours=0`, { method: 'POST' }))

  } catch (error) {
    logWithContext('CLAUDE_ROUTING', 'Failed to process with Daytona sandbox', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    throw error
  }
}

// Handle issues events
export async function handleIssuesEvent(data: any, env: any): Promise<Response> {
  const action = data.action
  const issue = data.issue
  const repository = data.repository

  logWithContext('ISSUES_EVENT', 'Processing issue event with new architecture', {
    action,
    issueNumber: issue.number,
    issueTitle: issue.title,
    repository: repository.full_name,
    author: issue.user?.login,
    labels: issue.labels?.map((label: any) => label.name) || [],
    installationId: data.installation?.id
  })

  // Handle new issue creation with Claude Code
  if (action === 'opened') {
    logWithContext('ISSUES_EVENT', 'Handling new issue creation with new architecture')

    try {
      // Route to Claude Code sandbox for processing
      logWithContext('ISSUES_EVENT', 'Routing to Claude Code sandbox')
      await routeToClaudeCodeSandbox(issue, repository, env, data)

      logWithContext('ISSUES_EVENT', 'Issue routed to Claude Code sandbox successfully')

    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to process new issue', {
        error: error instanceof Error ? error.message : String(error),
        issueNumber: issue.number
      })

      // Post error comment on issue
      try {
        const [owner, repo] = repository.full_name.split('/')
        const installationId = await getOrDiscoverInstallationId(
          env,
          owner,
          repo,
          data?.installation?.id?.toString()
        )
        
        if (installationId) {
          const installationToken = await generateInstallationToken(env, installationId)
          if (installationToken) {
            const githubAPI = new GitHubAPI({
              async getInstallationToken() {
                return installationToken
              }
            })

            const errorComment = `🤖 **Claude Code encountered an error while processing this issue.**

Error: ${(error as Error).message}

Please check the issue requirements and try again. If the problem persists, this may indicate a configuration issue.

---
🤖 Powered by [Claude Code](https://claude.ai/code)`

            await githubAPI.postIssueComment(owner, repo, issue.number, errorComment)
          }
        }
      } catch (commentError) {
        logWithContext('ISSUES_EVENT', 'Failed to post error comment', {
          commentError: (commentError as Error).message
        })
      }
    }
  }

  // Handle issue edits (title/description updates)
  if (action === 'edited') {
    const changes = data.changes

    logWithContext('ISSUES_EVENT', 'Handling issue edit with new architecture', {
      issueNumber: issue.number,
      hasChanges: !!changes,
      changedFields: changes ? Object.keys(changes) : []
    })

    // Check if title or body was changed
    const titleChanged = changes?.title?.from !== undefined
    const bodyChanged = changes?.body?.from !== undefined

    if (titleChanged || bodyChanged) {
      logWithContext('ISSUES_EVENT', 'Issue title or description changed - triggering Claude Code analysis', {
        titleChanged,
        bodyChanged
      })

      try {
        // Route updated issue to Claude Code sandbox for re-analysis
        await routeToClaudeCodeSandbox(issue, repository, env, data)

        logWithContext('ISSUES_EVENT', 'Updated issue routed to Claude Code sandbox successfully')

      } catch (error) {
        logWithContext('ISSUES_EVENT', 'Failed to process issue update', {
          error: error instanceof Error ? error.message : String(error),
          issueNumber: issue.number,
          titleChanged,
          bodyChanged
        })
      }
    } else {
      logWithContext('ISSUES_EVENT', 'Issue edited but no title/description changes detected', {
        changedFields: changes ? Object.keys(changes) : []
      })
    }
  }

  // For other issue actions, just acknowledge the event
  logWithContext('ISSUES_EVENT', 'Issue action acknowledged', {
    action,
    issueNumber: issue.number
  })

  return new Response('Issues event processed with new architecture', {status: 200})
}