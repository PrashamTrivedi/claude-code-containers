import {DurableObject} from 'cloudflare:workers'
import {DaytonaClient, type DaytonaSandbox, type CreateSandboxRequest} from './daytona_client'
import {logWithContext} from './log'

// Sandbox state stored in Durable Object
interface SandboxState {
  sandboxId: string
  name: string
  status: DaytonaSandbox['status']
  projectName: string
  gitUrl: string
  created: string
  lastUpdated: string
  issueId?: string
  repositoryName?: string
}

// Request/Response interfaces for the Durable Object
export interface CreateSandboxDORequest {
  name: string
  projectName: string
  gitUrl: string
  envVars?: Record<string, string>
  issueId?: string
  repositoryName?: string
}

export interface ProcessIssueRequest {
  issue: any
  repository: any
  installationToken: string
  claudeApiKey: string
}

export interface CloneAndSetupRequest {
  sandboxId: string
  gitUrl: string
  installationToken: string
  workspaceDir?: string
}

export interface ExecuteClaudeRequest {
  sandboxId: string
  prompt: string
}

export interface GetChangesRequest {
  sandboxId: string
  workspaceDir?: string
}

export interface ExecuteCommandDORequest {
  sandboxId: string
  command: string
  workingDirectory?: string
  envVars?: Record<string, string>
}

export interface SandboxManagerResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  sandboxId?: string
}

/**
 * Durable Object for managing Daytona sandbox lifecycle and state
 */
export class DaytonaSandboxManagerDO extends DurableObject {
  private daytonaClient: DaytonaClient | null = null
  private sandboxes: Map<string, SandboxState> = new Map()

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env)

    // We'll initialize the Daytona client dynamically when needed
    // since the API key is stored in KV storage, not environment variables

    // Load sandbox state from storage on startup
    this.loadSandboxState()
  }

  /**
   * Initialize Daytona SDK client with credentials from KV storage
   */
  private async initializeDaytonaClient(): Promise<void> {
    if (this.daytonaClient) {
      return // Already initialized
    }

    try {
      const {getDaytonaCredentials} = await import('./handlers/daytona_setup')
      const credentials = await getDaytonaCredentials((this as any).env)

      if (!credentials) {
        throw new Error('Daytona credentials not configured. Please visit /daytona-setup first.')
      }

      this.daytonaClient = new DaytonaClient(credentials.apiKey, credentials.apiUrl)

      logWithContext('SANDBOX_MANAGER_DO', 'Daytona SDK client initialized', {
        apiUrl: credentials.apiUrl
      })
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Failed to initialize Daytona SDK client', {
        error: (error as Error).message
      })
      throw error
    }
  }

  /**
   * Load sandbox state from Durable Object storage
   */
  private async loadSandboxState(): Promise<void> {
    try {
      const storedState = await this.ctx.storage.get<Record<string, SandboxState>>('sandboxes')
      if (storedState) {
        this.sandboxes = new Map(Object.entries(storedState))
        logWithContext('SANDBOX_MANAGER_DO', 'Loaded sandbox state from storage', {
          sandboxCount: this.sandboxes.size
        })
      }
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error loading sandbox state', {
        error: (error as Error).message
      })
    }
  }

  /**
   * Save sandbox state to Durable Object storage
   */
  private async saveSandboxState(): Promise<void> {
    try {
      const stateObject = Object.fromEntries(this.sandboxes.entries())
      await this.ctx.storage.put('sandboxes', stateObject)

      logWithContext('SANDBOX_MANAGER_DO', 'Saved sandbox state to storage', {
        sandboxCount: this.sandboxes.size
      })
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error saving sandbox state', {
        error: (error as Error).message
      })
    }
  }

  /**
   * Handle HTTP requests to the Durable Object
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname

    logWithContext('SANDBOX_MANAGER_DO', 'Received request', {
      method: request.method,
      pathname
    })

    try {
      // Initialize Daytona SDK client if not already done
      await this.initializeDaytonaClient()
      switch (pathname) {
        case '/create':
          return this.handleCreateSandbox(request)

        case '/execute':
          return this.handleExecuteCommand(request)

        case '/get':
          return this.handleGetSandbox(request)

        case '/list':
          return this.handleListSandboxes(request)

        case '/cleanup':
          return this.handleCleanupSandboxes(request)

        case '/health':
          return this.handleHealthCheck(request)

        case '/process-issue':
          return this.handleProcessIssue(request)

        case '/clone-and-setup':
          return this.handleCloneAndSetup(request)

        case '/execute-claude':
          return this.handleExecuteClaude(request)

        case '/get-changes':
          return this.handleGetChanges(request)

        default:
          return Response.json({
            success: false,
            error: 'Unknown endpoint'
          } as SandboxManagerResponse, {status: 404})
      }
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error handling request', {
        pathname,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Create a new sandbox
   */
  private async handleCreateSandbox(request: Request): Promise<Response> {
    const createRequest: CreateSandboxDORequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Creating sandbox', {
      name: createRequest.name,
      projectName: createRequest.projectName,
      gitUrl: createRequest.gitUrl,
      issueId: createRequest.issueId
    })

    try {
      const sandbox = await this.daytonaClient!.createSandbox({

        name: createRequest.name,
        projectName: createRequest.projectName,
        gitUrl: createRequest.gitUrl,
        image: 'claude-code-env', // Use our custom container image
        envVars: createRequest.envVars
      })

      // Store sandbox state
      const sandboxState: SandboxState = {
        sandboxId: sandbox.id,
        name: sandbox.name,
        status: sandbox.status,
        projectName: sandbox.projectName,
        gitUrl: createRequest.gitUrl,
        created: sandbox.created,
        lastUpdated: sandbox.updated,
        issueId: createRequest.issueId,
        repositoryName: createRequest.repositoryName
      }

      this.sandboxes.set(sandbox.id, sandboxState)
      await this.saveSandboxState()

      // Wait for sandbox to be running using SDK's waitUntilStarted
      try {
        const runningSandbox = await this.daytonaClient!.waitForSandboxStatus(
          sandbox.id,
          'running',
          180000, // 3 minutes timeout
          3000    // 3 second polling
        )

        // Update state
        sandboxState.status = runningSandbox.status
        sandboxState.lastUpdated = runningSandbox.updated
        this.sandboxes.set(sandbox.id, sandboxState)
        await this.saveSandboxState()

        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox successfully started via SDK', {
          sandboxId: sandbox.id,
          status: runningSandbox.status
        })

        return Response.json({
          success: true,
          data: runningSandbox,
          sandboxId: sandbox.id
        } as SandboxManagerResponse<DaytonaSandbox>)

      } catch (startupError) {
        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox startup timeout or error via SDK', {
          sandboxId: sandbox.id,
          error: (startupError as Error).message
        })

        return Response.json({
          success: false,
          error: `Sandbox created but failed to start: ${(startupError as Error).message}`,
          sandboxId: sandbox.id
        } as SandboxManagerResponse, {status: 500})
      }

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error creating sandbox', {
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Execute command in sandbox via SDK
   */
  private async handleExecuteCommand(request: Request): Promise<Response> {
    const executeRequest: ExecuteCommandDORequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Executing command in sandbox via SDK', {
      sandboxId: executeRequest.sandboxId,
      command: executeRequest.command.substring(0, 100)
    })

    try {
      const response = await this.daytonaClient!.executeCommand(
        executeRequest.sandboxId,
        {
          command: executeRequest.command,
          workingDirectory: executeRequest.workingDirectory,
          envVars: executeRequest.envVars
        }
      )

      logWithContext('SANDBOX_MANAGER_DO', 'Command executed successfully via SDK', {
        sandboxId: executeRequest.sandboxId,
        exitCode: response.exitCode,
        outputLength: response.stdout.length + response.stderr.length
      })

      return Response.json({
        success: true,
        data: response,
        sandboxId: executeRequest.sandboxId
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error executing command via SDK', {
        sandboxId: executeRequest.sandboxId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId: executeRequest.sandboxId
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Get sandbox information via SDK
   */
  private async handleGetSandbox(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const sandboxId = url.searchParams.get('sandboxId')

    if (!sandboxId) {
      return Response.json({
        success: false,
        error: 'sandboxId parameter required'
      } as SandboxManagerResponse, {status: 400})
    }

    logWithContext('SANDBOX_MANAGER_DO', 'Getting sandbox info via SDK', {sandboxId})

    try {
      const sandbox = await this.daytonaClient!.getSandbox(sandboxId)

      // Update our stored state
      const storedState = this.sandboxes.get(sandboxId)
      if (storedState) {
        storedState.status = sandbox.status
        storedState.lastUpdated = sandbox.updated
        this.sandboxes.set(sandboxId, storedState)
        await this.saveSandboxState()
      }

      logWithContext('SANDBOX_MANAGER_DO', 'Retrieved sandbox info successfully via SDK', {
        sandboxId,
        status: sandbox.status
      })

      return Response.json({
        success: true,
        data: sandbox,
        sandboxId
      } as SandboxManagerResponse<DaytonaSandbox>)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error getting sandbox info via SDK', {
        sandboxId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * List all sandboxes via SDK
   */
  private async handleListSandboxes(_request: Request): Promise<Response> {
    logWithContext('SANDBOX_MANAGER_DO', 'Listing sandboxes via SDK')

    try {
      const sandboxes = await this.daytonaClient!.listSandboxes()

      logWithContext('SANDBOX_MANAGER_DO', 'Listed sandboxes successfully via SDK', {
        count: sandboxes.length,
        storedCount: this.sandboxes.size
      })

      return Response.json({
        success: true,
        data: {
          sandboxes,
          stored: Array.from(this.sandboxes.values())
        }
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error listing sandboxes via SDK', {
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Cleanup old/unused sandboxes via SDK
   */
  private async handleCleanupSandboxes(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const maxAgeHours = parseInt(url.searchParams.get('maxAgeHours') || '24')

    logWithContext('SANDBOX_MANAGER_DO', 'Starting sandbox cleanup via SDK', {maxAgeHours})

    try {
      const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)
      const sandboxes = await this.daytonaClient!.listSandboxes()

      let cleaned = 0
      const errors: string[] = []

      for (const sandbox of sandboxes) {
        const createdDate = new Date(sandbox.created)

        if (createdDate < cutoffTime) {
          try {
            await this.daytonaClient!.deleteSandbox(sandbox.id)
            this.sandboxes.delete(sandbox.id)
            cleaned++

            logWithContext('SANDBOX_MANAGER_DO', 'Cleaned up old sandbox via SDK', {
              sandboxId: sandbox.id,
              created: sandbox.created
            })
          } catch (error) {
            const errorMsg = `Failed to cleanup sandbox ${sandbox.id}: ${(error as Error).message}`
            errors.push(errorMsg)
            logWithContext('SANDBOX_MANAGER_DO', 'Error cleaning sandbox via SDK', {
              sandboxId: sandbox.id,
              error: (error as Error).message
            })
          }
        }
      }

      await this.saveSandboxState()

      logWithContext('SANDBOX_MANAGER_DO', 'Sandbox cleanup completed via SDK', {
        cleaned,
        errors: errors.length,
        remaining: sandboxes.length - cleaned
      })

      return Response.json({
        success: true,
        data: {
          cleaned,
          errors,
          remaining: sandboxes.length - cleaned
        }
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error during sandbox cleanup via SDK', {
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Complete issue processing flow
   */
  private async handleProcessIssue(request: Request): Promise<Response> {
    const processRequest: ProcessIssueRequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Processing issue with complete flow', {
      issueNumber: processRequest.issue.number,
      repositoryName: processRequest.repository.full_name
    })

    try {
      const sandboxName = `claude-issue-${processRequest.issue.id}`
      const workspaceDir = '/workspace'

      // Step 1: Create sandbox
      const sandbox = await this.daytonaClient!.createSandbox({
        name: sandboxName,
        projectName: processRequest.repository.name,
        gitUrl: processRequest.repository.clone_url,
        image: 'claude-code-container',
        envVars: {
          ANTHROPIC_API_KEY: processRequest.claudeApiKey,
          GITHUB_TOKEN: processRequest.installationToken
        }
      })

      // Wait for sandbox to be ready
      await this.daytonaClient!.waitForSandboxStatus(sandbox.id, 'running', 180000, 3000)

      // Step 2: Clone repository
      await this.daytonaClient!.cloneRepository(
        sandbox.id,
        processRequest.repository.clone_url,
        workspaceDir,
        processRequest.installationToken
      )

      // Step 3: Build Claude prompt
      const prompt = `You are working on GitHub issue #${processRequest.issue.number}: "${processRequest.issue.title}"

Issue Description:
${processRequest.issue.body || 'No description provided'}

Labels: ${processRequest.issue.labels?.map((label: any) => label.name).join(', ') || 'None'}
Author: ${processRequest.issue.user.login}

The repository has been cloned to your current working directory. Please:
1. Explore the codebase to understand the structure and relevant files
2. Analyze the issue requirements thoroughly
3. Implement a solution that addresses the issue
4. Write appropriate tests if needed
5. Ensure code quality and consistency with existing patterns

**IMPORTANT: If you make any file changes, please create a file called '.claude-pr-summary.md' in the root directory with a concise summary (1-3 sentences) of what changes you made and why. This will be used for the pull request description.**

Work step by step and provide clear explanations of your approach.`

      // Step 4: Execute Claude CLI
      const claudeResult = await this.daytonaClient!.executeClaudeCommand(sandbox.id, prompt)

      // Step 5: Check for changes
      const gitStatus = await this.daytonaClient!.getGitStatus(sandbox.id, workspaceDir)
      const hasChanges = gitStatus.stdout.trim().length > 0

      let prSummary = 'Claude Code made changes to address the GitHub issue.'
      if (hasChanges) {
        try {
          prSummary = await this.daytonaClient!.readFile(sandbox.id, '/workspace/.claude-pr-summary.md')
        } catch {
          // Use default summary if file doesn't exist
        }
      }

      return Response.json({
        success: true,
        data: {
          sandboxId: sandbox.id,
          claudeResult,
          hasChanges,
          prSummary,
          gitStatus: gitStatus.stdout
        },
        sandboxId: sandbox.id
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error processing issue', {
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Clone repository and prepare workspace
   */
  private async handleCloneAndSetup(request: Request): Promise<Response> {
    const cloneRequest: CloneAndSetupRequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Cloning and setting up workspace', {
      sandboxId: cloneRequest.sandboxId,
      gitUrl: cloneRequest.gitUrl
    })

    try {
      const workspaceDir = cloneRequest.workspaceDir || '~/workspace'

      const result = await this.daytonaClient!.cloneRepository(
        cloneRequest.sandboxId,
        cloneRequest.gitUrl,
        workspaceDir,
        cloneRequest.installationToken
      )

      return Response.json({
        success: true,
        data: result,
        sandboxId: cloneRequest.sandboxId
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error cloning repository', {
        sandboxId: cloneRequest.sandboxId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId: cloneRequest.sandboxId
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Execute Claude CLI with proper command format
   */
  private async handleExecuteClaude(request: Request): Promise<Response> {
    const executeRequest: ExecuteClaudeRequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Executing Claude CLI', {
      sandboxId: executeRequest.sandboxId,
      promptLength: executeRequest.prompt.length
    })

    try {
      const result = await this.daytonaClient!.executeClaudeCommand(
        executeRequest.sandboxId,
        executeRequest.prompt
      )

      return Response.json({
        success: true,
        data: result,
        sandboxId: executeRequest.sandboxId
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error executing Claude CLI', {
        sandboxId: executeRequest.sandboxId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId: executeRequest.sandboxId
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Get git changes and PR summary
   */
  private async handleGetChanges(request: Request): Promise<Response> {
    const changesRequest: GetChangesRequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Getting git changes', {
      sandboxId: changesRequest.sandboxId
    })

    try {
      const workspaceDir = changesRequest.workspaceDir || '/workspace'

      const gitStatus = await this.daytonaClient!.getGitStatus(
        changesRequest.sandboxId,
        workspaceDir
      )

      const hasChanges = gitStatus.stdout.trim().length > 0

      let prSummary = 'Claude Code made changes to address the GitHub issue.'
      if (hasChanges) {
        try {
          prSummary = await this.daytonaClient!.readFile(
            changesRequest.sandboxId,
            `${workspaceDir}/.claude-pr-summary.md`
          )
        } catch {
          // Use default summary if file doesn't exist
        }
      }

      return Response.json({
        success: true,
        data: {
          hasChanges,
          gitStatus: gitStatus.stdout,
          prSummary
        },
        sandboxId: changesRequest.sandboxId
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error getting changes', {
        sandboxId: changesRequest.sandboxId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId: changesRequest.sandboxId
      } as SandboxManagerResponse, {status: 500})
    }
  }

  /**
   * Health check via SDK
   */
  private async handleHealthCheck(_request: Request): Promise<Response> {
    logWithContext('SANDBOX_MANAGER_DO', 'Performing health check via SDK')

    try {
      const isHealthy = await this.daytonaClient!.healthCheck()

      logWithContext('SANDBOX_MANAGER_DO', 'Health check completed via SDK', {
        isHealthy,
        storedSandboxes: this.sandboxes.size
      })

      return Response.json({
        success: isHealthy,
        data: {
          daytonaConnected: isHealthy,
          storedSandboxes: this.sandboxes.size,
          timestamp: new Date().toISOString(),
          sdkVersion: '@daytonaio/sdk v0.25.6'
        }
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error during health check via SDK', {
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, {status: 500})
    }
  }
}