import {GitHubAPI} from "../../github_client"
import {logWithContext} from "../../log"
import {generateInstallationToken, getClaudeApiKey} from '../../kv_storage'
import {getOrDiscoverInstallationId} from '../../github_installation_discovery'
import {getDaytonaCredentials} from '../daytona_setup'

// Simplified sandbox response interface
interface SandboxResponse {
  success: boolean
  message: string
  error?: string
}

// Route GitHub issue to Claude Code Daytona sandbox
async function routeToClaudeCodeSandbox(issue: any, repository: any, env: any, webhookData?: any): Promise<void> {
  const sandboxName = `claude-issue-${issue.id}`

  logWithContext('CLAUDE_ROUTING', 'Routing issue to Claude Code Daytona sandbox', {
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

  // Prepare environment variables for the sandbox
  const issueEnvVars = {
    ANTHROPIC_API_KEY: claudeApiKey,
    GITHUB_TOKEN: installationToken,
    ISSUE_ID: issue.id.toString(),
    ISSUE_NUMBER: issue.number.toString(),
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body || '',
    ISSUE_LABELS: JSON.stringify(issue.labels?.map((label: any) => label.name) || []),
    REPOSITORY_URL: repository.clone_url,
    REPOSITORY_NAME: repository.full_name,
    ISSUE_AUTHOR: issue.user.login
  }

  // Create and start Claude Code processing in Daytona sandbox
  logWithContext('CLAUDE_ROUTING', 'Creating Daytona sandbox for issue processing', {
    sandboxName,
    issueId: issue.id.toString()
  })

  try {
    // Step 1: Create sandbox with the repository cloned
    const createResponse = await sandboxManager.fetch(new Request('http://internal/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: sandboxName,
        projectName: repository.name,
        gitUrl: repository.clone_url,
        envVars: issueEnvVars,
        issueId: issue.id.toString(),
        repositoryName: repository.full_name
      })
    }))

    logWithContext('CLAUDE_ROUTING', 'Sandbox creation response', {
      status: createResponse.status,
      statusText: createResponse.statusText
    })

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

    // Step 2: Execute Claude Code CLI in the sandbox to process the issue
    const processCommand = `cd /workspace && /root/.local/bin/claude -p "
You are working on GitHub issue #${issue.number}: \\"${issue.title}\\"

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

Work step by step and provide clear explanations of your approach.
" --output-format json --permission-mode bypassPermissions --allowedTools Bash,Read,Edit,Write,Grep,Glob`

    const executeResponse = await sandboxManager.fetch(new Request('http://internal/execute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sandboxId,
        command: processCommand,
        workingDirectory: '/workspace',
        envVars: issueEnvVars
      })
    }))

    logWithContext('CLAUDE_ROUTING', 'Command execution response', {
      status: executeResponse.status,
      statusText: executeResponse.statusText
    })

    if (!executeResponse.ok) {
      const errorText = await executeResponse.text().catch(() => 'Unable to read execution error')
      logWithContext('CLAUDE_ROUTING', 'Command execution failed', {
        status: executeResponse.status,
        errorText
      })
      throw new Error(`Command execution failed with status ${executeResponse.status}: ${errorText}`)
    }

    const executeResult = await executeResponse.json()

    logWithContext('CLAUDE_ROUTING', 'Command execution completed', {
      success: executeResult.success,
      exitCode: executeResult.data?.exitCode,
      stdoutLength: executeResult.data?.stdout?.length || 0,
      stderrLength: executeResult.data?.stderr?.length || 0
    })

    if (executeResult.success && executeResult.data?.exitCode === 0) {
      logWithContext('CLAUDE_ROUTING', 'Sandbox processing completed successfully', {
        stdout: executeResult.data.stdout?.substring(0, 200) + '...'
      })
    } else {
      logWithContext('CLAUDE_ROUTING', 'Sandbox processing had issues', {
        exitCode: executeResult.data?.exitCode,
        stderr: executeResult.data?.stderr
      })
    }

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

  logWithContext('ISSUES_EVENT', 'Processing issue event', {
    action,
    issueNumber: issue.number,
    issueTitle: issue.title,
    repository: repository.full_name,
    author: issue.user?.login,
    labels: issue.labels?.map((label: any) => label.name) || [],
    installationId: data.installation?.id
  })

  // TODO: Update GitHubAPI to work with KV storage instead of gitHubConfigKV
  // For now, we'll skip the GitHubAPI creation
  // const githubAPI = new GitHubAPI(env);

  // Handle new issue creation with Claude Code
  if (action === 'opened') {
    logWithContext('ISSUES_EVENT', 'Handling new issue creation')

    try {
      // TODO: Implement GitHub comment posting with KV credentials
      logWithContext('ISSUES_EVENT', 'Skipping initial acknowledgment comment (needs GitHub API update for KV)')

      // Route to Claude Code sandbox for processing
      logWithContext('ISSUES_EVENT', 'Routing to Claude Code sandbox')
      await routeToClaudeCodeSandbox(issue, repository, env, data)

      logWithContext('ISSUES_EVENT', 'Issue routed to Claude Code sandbox successfully')

    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to process new issue', {
        error: error instanceof Error ? error.message : String(error),
        issueNumber: issue.number
      })

      // TODO: Implement error comment posting with KV credentials
      logWithContext('ISSUES_EVENT', 'Skipping error comment (needs GitHub API update for KV)')
    }
  }

  // Handle issue edits (title/description updates)
  if (action === 'edited') {
    const changes = data.changes

    logWithContext('ISSUES_EVENT', 'Handling issue edit', {
      issueNumber: issue.number,
      hasChanges: !!changes,
      changedFields: changes ? Object.keys(changes) : [],
      issue
    })

    // Check if title or body was changed
    const titleChanged = changes?.title?.from !== undefined
    const bodyChanged = changes?.body?.from !== undefined

    if (titleChanged || bodyChanged) {
      logWithContext('ISSUES_EVENT', 'Issue title or description changed - triggering Claude Code analysis', {
        titleChanged,
        bodyChanged,
        oldTitle: changes?.title?.from,
        newTitle: issue.title,
        oldBodyPreview: changes?.body?.from ? changes.body.from.substring(0, 100) + '...' : null,
        newBodyPreview: issue.body ? issue.body.substring(0, 100) + '...' : null
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

  return new Response('Issues event processed', {status: 200})
}