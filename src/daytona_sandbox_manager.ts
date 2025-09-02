import { DurableObject } from 'cloudflare:workers'
import { DaytonaClient, type DaytonaSandbox, type CreateSandboxRequest } from './daytona_client'
import { logWithContext } from './log'

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
   * Initialize Daytona client with credentials from KV storage
   */
  private async initializeDaytonaClient(): Promise<void> {
    if (this.daytonaClient) {
      return // Already initialized
    }

    try {
      const { getDaytonaCredentials } = await import('./handlers/daytona_setup')
      const credentials = await getDaytonaCredentials((this as any).env)
      
      if (!credentials) {
        throw new Error('Daytona credentials not configured. Please visit /daytona-setup first.')
      }

      this.daytonaClient = new DaytonaClient(credentials.apiKey, credentials.apiUrl)
      
      logWithContext('SANDBOX_MANAGER_DO', 'Daytona client initialized', {
        apiUrl: credentials.apiUrl
      })
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Failed to initialize Daytona client', {
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
      // Initialize Daytona client if not already done
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
        
        default:
          return Response.json({
            success: false,
            error: 'Unknown endpoint'
          } as SandboxManagerResponse, { status: 404 })
      }
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error handling request', {
        pathname,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, { status: 500 })
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
        image: 'claude-code-container', // Use our custom container image
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

      // Wait for sandbox to be running (with timeout)
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

        return Response.json({
          success: true,
          data: runningSandbox,
          sandboxId: sandbox.id
        } as SandboxManagerResponse<DaytonaSandbox>)

      } catch (startupError) {
        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox startup timeout or error', {
          sandboxId: sandbox.id,
          error: (startupError as Error).message
        })

        return Response.json({
          success: false,
          error: `Sandbox created but failed to start: ${(startupError as Error).message}`,
          sandboxId: sandbox.id
        } as SandboxManagerResponse, { status: 500 })
      }

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error creating sandbox', {
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, { status: 500 })
    }
  }

  /**
   * Execute command in sandbox
   */
  private async handleExecuteCommand(request: Request): Promise<Response> {
    const executeRequest: ExecuteCommandDORequest = await request.json()
    
    logWithContext('SANDBOX_MANAGER_DO', 'Executing command in sandbox', {
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

      return Response.json({
        success: true,
        data: response,
        sandboxId: executeRequest.sandboxId
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error executing command', {
        sandboxId: executeRequest.sandboxId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId: executeRequest.sandboxId
      } as SandboxManagerResponse, { status: 500 })
    }
  }

  /**
   * Get sandbox information
   */
  private async handleGetSandbox(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const sandboxId = url.searchParams.get('sandboxId')

    if (!sandboxId) {
      return Response.json({
        success: false,
        error: 'sandboxId parameter required'
      } as SandboxManagerResponse, { status: 400 })
    }

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

      return Response.json({
        success: true,
        data: sandbox,
        sandboxId
      } as SandboxManagerResponse<DaytonaSandbox>)

    } catch (error) {
      return Response.json({
        success: false,
        error: (error as Error).message,
        sandboxId
      } as SandboxManagerResponse, { status: 500 })
    }
  }

  /**
   * List all sandboxes
   */
  private async handleListSandboxes(_request: Request): Promise<Response> {
    try {
      const sandboxes = await this.daytonaClient!.listSandboxes()
      
      return Response.json({
        success: true,
        data: {
          sandboxes,
          stored: Array.from(this.sandboxes.values())
        }
      } as SandboxManagerResponse)

    } catch (error) {
      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, { status: 500 })
    }
  }

  /**
   * Cleanup old/unused sandboxes
   */
  private async handleCleanupSandboxes(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const maxAgeHours = parseInt(url.searchParams.get('maxAgeHours') || '24')
    
    logWithContext('SANDBOX_MANAGER_DO', 'Starting sandbox cleanup', { maxAgeHours })

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
            
            logWithContext('SANDBOX_MANAGER_DO', 'Cleaned up old sandbox', {
              sandboxId: sandbox.id,
              created: sandbox.created
            })
          } catch (error) {
            const errorMsg = `Failed to cleanup sandbox ${sandbox.id}: ${(error as Error).message}`
            errors.push(errorMsg)
            logWithContext('SANDBOX_MANAGER_DO', 'Error cleaning sandbox', {
              sandboxId: sandbox.id,
              error: (error as Error).message
            })
          }
        }
      }

      await this.saveSandboxState()

      return Response.json({
        success: true,
        data: {
          cleaned,
          errors,
          remaining: sandboxes.length - cleaned
        }
      } as SandboxManagerResponse)

    } catch (error) {
      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, { status: 500 })
    }
  }

  /**
   * Health check
   */
  private async handleHealthCheck(_request: Request): Promise<Response> {
    try {
      const isHealthy = await this.daytonaClient!.healthCheck()
      
      return Response.json({
        success: isHealthy,
        data: {
          daytonaConnected: isHealthy,
          storedSandboxes: this.sandboxes.size,
          timestamp: new Date().toISOString()
        }
      } as SandboxManagerResponse)

    } catch (error) {
      return Response.json({
        success: false,
        error: (error as Error).message
      } as SandboxManagerResponse, { status: 500 })
    }
  }
}