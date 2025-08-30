import {GitHubAPI} from "../../github_client"
import {logWithContext} from "../../log"
import {containerFetch, getRouteFromRequest} from "../../fetch"
import {generateInstallationToken, getClaudeApiKey} from '../../kv_storage'
import {getOrDiscoverInstallationId} from '../../github_installation_discovery'

// Simplified container response interface
interface ContainerResponse {
  success: boolean
  message: string
  error?: string
}

// Route GitHub issue to Claude Code container
async function routeToClaudeCodeContainer(issue: any, repository: any, env: any, webhookData?: any): Promise<void> {
  const containerName = `claude-issue-${issue.id}`

  logWithContext('CLAUDE_ROUTING', 'Routing issue to Claude Code container', {
    issueNumber: issue.number,
    issueId: issue.id,
    containerName,
    repository: repository.full_name,
    issue
  })

  // Create unique container for this issue
  const id = env.MY_CONTAINER.idFromName(containerName)
  const container = env.MY_CONTAINER.get(id)

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

  // Prepare environment variables for the container
  const issueContext = {
    ANTHROPIC_API_KEY: claudeApiKey,
    GITHUB_TOKEN: installationToken,
    ISSUE_ID: issue.id.toString(),
    ISSUE_NUMBER: issue.number.toString(),
    ISSUE_TITLE: issue.title,
    ISSUE_BODY: issue.body || '',
    ISSUE_LABELS: JSON.stringify(issue.labels?.map((label: any) => label.name) || []),
    REPOSITORY_URL: repository.clone_url,
    REPOSITORY_NAME: repository.full_name,
    ISSUE_AUTHOR: issue.user.login,
    MESSAGE: `Processing issue #${issue.number}: ${issue.title}`
  }

  // Start Claude Code processing by calling the container
  logWithContext('CLAUDE_ROUTING', 'Starting Claude Code container processing', {
    containerName,
    issueId: issueContext.ISSUE_ID
  })

  try {
    const response = await containerFetch(container, new Request('http://internal/process-issue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(issueContext)
    }), {
      containerName,
      route: '/process-issue'
    })

    logWithContext('CLAUDE_ROUTING', 'Claude Code container response', {
      status: response.status,
      statusText: response.statusText
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response')
      logWithContext('CLAUDE_ROUTING', 'Container returned error', {
        status: response.status,
        errorText
      })
      throw new Error(`Container returned status ${response.status}: ${errorText}`)
    }

    // Parse container response
    const containerResponse: ContainerResponse = await response.json()

    logWithContext('CLAUDE_ROUTING', 'Container response parsed', {
      success: containerResponse.success,
      message: containerResponse.message,
      hasError: !!containerResponse.error
    })

    if (containerResponse.success) {
      logWithContext('CLAUDE_ROUTING', 'Container processing completed successfully', {
        message: containerResponse.message
      })
    } else {
      logWithContext('CLAUDE_ROUTING', 'Container processing failed', {
        error: containerResponse.error
      })
    }

  } catch (error) {
    logWithContext('CLAUDE_ROUTING', 'Failed to process Claude Code response', {
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

      // Route to Claude Code container for processing
      logWithContext('ISSUES_EVENT', 'Routing to Claude Code container')
      await routeToClaudeCodeContainer(issue, repository, env, data)

      logWithContext('ISSUES_EVENT', 'Issue routed to Claude Code container successfully')

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
        // Route updated issue to Claude Code container for re-analysis
        await routeToClaudeCodeContainer(issue, repository, env, data)

        logWithContext('ISSUES_EVENT', 'Updated issue routed to Claude Code container successfully')

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

  // For other issue actions, use the standard container routing
  const containerName = `repo-${repository.id}`
  const id = env.MY_CONTAINER.idFromName(containerName)
  const container = env.MY_CONTAINER.get(id)

  const webhookPayload = {
    event: 'issues',
    action,
    repository: repository.full_name,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_author: issue.user.login
  }

  await containerFetch(container, new Request('http://internal/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(webhookPayload)
  }), {
    containerName,
    route: '/webhook'
  })

  return new Response('Issues event processed', {status: 200})
}