import { GitHubAPI } from "../../github_client";
import { logWithContext } from "../../log";
import { containerFetch, getRouteFromRequest } from "../../fetch";

// Simplified container response interface
interface ContainerResponse {
  success: boolean;
  message: string;
  error?: string;
}

// Route GitHub issue to Claude Code container
async function routeToClaudeCodeContainer(issue: any, repository: any, env: any): Promise<void> {
  const containerName = `claude-issue-${issue.id}`;

  logWithContext('CLAUDE_ROUTING', 'Routing issue to Claude Code container', {
    issueNumber: issue.number,
    issueId: issue.id,
    containerName,
    repository: repository.full_name
  });

  // Create unique container for this issue
  const id = env.MY_CONTAINER.idFromName(containerName);
  const container = env.MY_CONTAINER.get(id);

  // Get GitHub credentials from KV
  logWithContext('CLAUDE_ROUTING', 'Retrieving GitHub credentials from KV');

  // For now, we'll skip the installation token generation as it requires more complex logic
  // that would need the GitHub API integration to be properly updated for KV storage
  const installationToken = null;

  logWithContext('CLAUDE_ROUTING', 'Installation token retrieved', {
    hasToken: !!installationToken
  });

  if (!installationToken) {
    logWithContext('CLAUDE_ROUTING', 'Failed to generate installation token');
    throw new Error('Failed to generate GitHub installation token');
  }

  // Get Claude API key from secure storage
  logWithContext('CLAUDE_ROUTING', 'Retrieving Claude API key from KV');

  const claudeApiKey = await gitHubConfigKV.getClaudeApiKey();

  logWithContext('CLAUDE_ROUTING', 'Claude API key check', {
    hasApiKey: !!claudeApiKey
  });

  if (!claudeApiKey) {
    logWithContext('CLAUDE_ROUTING', 'Claude API key not configured');
    throw new Error('Claude API key not configured. Please visit /claude-setup first.');
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
  };

  // Start Claude Code processing by calling the container
  logWithContext('CLAUDE_ROUTING', 'Starting Claude Code container processing', {
    containerName,
    issueId: issueContext.ISSUE_ID
  });

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
    });

    logWithContext('CLAUDE_ROUTING', 'Claude Code container response', {
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      logWithContext('CLAUDE_ROUTING', 'Container returned error', {
        status: response.status,
        errorText
      });
      throw new Error(`Container returned status ${response.status}: ${errorText}`);
    }

    // Parse container response
    const containerResponse: ContainerResponse = await response.json();
    
    logWithContext('CLAUDE_ROUTING', 'Container response parsed', {
      success: containerResponse.success,
      message: containerResponse.message,
      hasError: !!containerResponse.error
    });

    if (containerResponse.success) {
      logWithContext('CLAUDE_ROUTING', 'Container processing completed successfully', {
        message: containerResponse.message
      });
    } else {
      logWithContext('CLAUDE_ROUTING', 'Container processing failed', {
        error: containerResponse.error
      });
    }

  } catch (error) {
    logWithContext('CLAUDE_ROUTING', 'Failed to process Claude Code response', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

// Handle issues events
export async function handleIssuesEvent(data: any, env: any): Promise<Response> {
  const action = data.action;
  const issue = data.issue;
  const repository = data.repository;

  logWithContext('ISSUES_EVENT', 'Processing issue event', {
    action,
    issueNumber: issue.number,
    issueTitle: issue.title,
    repository: repository.full_name,
    author: issue.user?.login,
    labels: issue.labels?.map((label: any) => label.name) || []
  });

  // TODO: Update GitHubAPI to work with KV storage instead of gitHubConfigKV
  // For now, we'll skip the GitHubAPI creation
  // const githubAPI = new GitHubAPI(env);

  // Handle new issue creation with Claude Code
  if (action === 'opened') {
    logWithContext('ISSUES_EVENT', 'Handling new issue creation');

    try {
      // TODO: Implement GitHub comment posting with KV credentials
      logWithContext('ISSUES_EVENT', 'Skipping initial acknowledgment comment (needs GitHub API update for KV)');

      // Route to Claude Code container for processing
      logWithContext('ISSUES_EVENT', 'Routing to Claude Code container');
      await routeToClaudeCodeContainer(issue, repository, env);

      logWithContext('ISSUES_EVENT', 'Issue routed to Claude Code container successfully');

    } catch (error) {
      logWithContext('ISSUES_EVENT', 'Failed to process new issue', {
        error: error instanceof Error ? error.message : String(error),
        issueNumber: issue.number
      });

      // TODO: Implement error comment posting with KV credentials
      logWithContext('ISSUES_EVENT', 'Skipping error comment (needs GitHub API update for KV)');
    }
  }

  // For other issue actions, use the standard container routing
  const containerName = `repo-${repository.id}`;
  const id = env.MY_CONTAINER.idFromName(containerName);
  const container = env.MY_CONTAINER.get(id);

  const webhookPayload = {
    event: 'issues',
    action,
    repository: repository.full_name,
    issue_number: issue.number,
    issue_title: issue.title,
    issue_author: issue.user.login
  };

  await containerFetch(container, new Request('http://internal/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(webhookPayload)
  }), {
    containerName,
    route: '/webhook'
  });

  return new Response('Issues event processed', { status: 200 });
}