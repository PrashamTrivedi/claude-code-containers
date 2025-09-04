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

        case '/find-by-issue-id':
          return this.handleFindByIssueId(request)

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
   * Find sandbox by issue ID from stored state and Daytona API with comprehensive state synchronization
   */
  private async findSandboxByIssueId(issueId: string): Promise<DaytonaSandbox | null> {
    logWithContext('SANDBOX_MANAGER_DO', 'Finding sandbox by issue ID with enhanced state sync', {issueId})

    try {
      let staleSandboxIds: string[] = []
      let foundSandbox: DaytonaSandbox | null = null
      
      // First, check our stored state for matching issueId and validate all references
      for (const [sandboxId, state] of this.sandboxes.entries()) {
        if (state.issueId === issueId) {
          logWithContext('SANDBOX_MANAGER_DO', 'Found sandbox candidate in stored state', {
            issueId,
            sandboxId,
            status: state.status
          })
          
          // Verify the sandbox still exists in Daytona and get current status
          try {
            const currentSandbox = await this.daytonaClient!.getSandbox(sandboxId)
            
            // Update our stored state with current status
            state.status = currentSandbox.status
            state.lastUpdated = currentSandbox.updated
            this.sandboxes.set(sandboxId, state)
            
            logWithContext('SANDBOX_MANAGER_DO', 'Verified sandbox exists and updated state', {
              issueId,
              sandboxId,
              currentStatus: currentSandbox.status
            })
            
            foundSandbox = currentSandbox
            break // Found valid sandbox, stop searching
            
          } catch (error) {
            const errorMessage = (error as Error).message
            logWithContext('SANDBOX_MANAGER_DO', 'Sandbox in stored state no longer exists in Daytona - marking for cleanup', {
              issueId,
              sandboxId,
              error: errorMessage
            })
            
            // Mark for cleanup but continue searching for other matches
            staleSandboxIds.push(sandboxId)
          }
        }
      }
      
      // Clean up all stale references found during validation
      if (staleSandboxIds.length > 0) {
        logWithContext('SANDBOX_MANAGER_DO', 'Cleaning up stale sandbox references', {
          staleSandboxIds,
          count: staleSandboxIds.length
        })
        
        for (const staleId of staleSandboxIds) {
          this.sandboxes.delete(staleId)
        }
        await this.saveSandboxState()
      }
      
      // If we found a valid sandbox in stored state, return it
      if (foundSandbox) {
        return foundSandbox
      }
      
      // If not found in stored state or all references were stale, search Daytona directly
      logWithContext('SANDBOX_MANAGER_DO', 'No valid sandbox in stored state - searching Daytona platform directly', {issueId})
      
      let daytonaSandbox: DaytonaSandbox | null = null
      try {
        daytonaSandbox = await this.daytonaClient!.findSandboxByIssueId(issueId)
      } catch (searchError) {
        logWithContext('SANDBOX_MANAGER_DO', 'Error searching Daytona platform directly', {
          issueId,
          error: (searchError as Error).message
        })
        // Continue execution - we'll return null if no sandbox found
      }
      
      if (daytonaSandbox) {
        logWithContext('SANDBOX_MANAGER_DO', 'Found sandbox in Daytona platform - updating stored state', {
          issueId,
          sandboxId: daytonaSandbox.id,
          status: daytonaSandbox.status
        })
        
        // Add to stored state for future reference
        const sandboxState: SandboxState = {
          sandboxId: daytonaSandbox.id,
          name: daytonaSandbox.name,
          status: daytonaSandbox.status,
          projectName: daytonaSandbox.projectName,
          gitUrl: daytonaSandbox.gitUrl || '',
          created: daytonaSandbox.created,
          lastUpdated: daytonaSandbox.updated,
          issueId: issueId,
          repositoryName: undefined // Will be set by caller if needed
        }
        
        this.sandboxes.set(daytonaSandbox.id, sandboxState)
        await this.saveSandboxState()
      }
      
      return daytonaSandbox
      
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error finding sandbox by issue ID with enhanced sync', {
        issueId,
        error: (error as Error).message
      })
      return null
    }
  }

  /**
   * Create a new sandbox or reuse existing one for issue
   */
  private async handleCreateSandbox(request: Request): Promise<Response> {
    const createRequest: CreateSandboxDORequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Processing sandbox creation request', {
      name: createRequest.name,
      projectName: createRequest.projectName,
      gitUrl: createRequest.gitUrl,
      issueId: createRequest.issueId
    })

    try {
      // Check for existing sandbox if issueId is provided
      if (createRequest.issueId) {
        logWithContext('SANDBOX_MANAGER_DO', 'Checking for existing sandbox for issue', {
          issueId: createRequest.issueId
        })
        
        const existingSandbox = await this.findSandboxByIssueId(createRequest.issueId)
        
        if (existingSandbox) {
          logWithContext('SANDBOX_MANAGER_DO', 'Found existing sandbox for issue', {
            issueId: createRequest.issueId,
            sandboxId: existingSandbox.id,
            status: existingSandbox.status
          })
          
          // Handle different sandbox states
          switch (existingSandbox.status) {
            case 'running':
              logWithContext('SANDBOX_MANAGER_DO', 'Existing sandbox is running, reusing it', {
                sandboxId: existingSandbox.id
              })
              
              // Update stored state with current info
              const runningState: SandboxState = {
                sandboxId: existingSandbox.id,
                name: existingSandbox.name,
                status: existingSandbox.status,
                projectName: existingSandbox.projectName,
                gitUrl: existingSandbox.gitUrl || createRequest.gitUrl,
                created: existingSandbox.created,
                lastUpdated: existingSandbox.updated,
                issueId: createRequest.issueId,
                repositoryName: createRequest.repositoryName
              }
              
              this.sandboxes.set(existingSandbox.id, runningState)
              await this.saveSandboxState()
              
              return Response.json({
                success: true,
                data: existingSandbox,
                sandboxId: existingSandbox.id
              } as SandboxManagerResponse<DaytonaSandbox>)
              
            case 'stopped':
              logWithContext('SANDBOX_MANAGER_DO', 'Existing sandbox is stopped, restarting it', {
                sandboxId: existingSandbox.id
              })
              
              try {
                // Restart the existing sandbox
                await this.daytonaClient!.startSandbox(existingSandbox.id)
                
                // Wait for it to be running
                const runningSandbox = await this.daytonaClient!.waitForSandboxStatus(
                  existingSandbox.id,
                  'running',
                  180000, // 3 minutes timeout
                  3000    // 3 second polling
                )
                
                // Update stored state
                const restartedState: SandboxState = {
                  sandboxId: runningSandbox.id,
                  name: runningSandbox.name,
                  status: runningSandbox.status,
                  projectName: runningSandbox.projectName,
                  gitUrl: runningSandbox.gitUrl || createRequest.gitUrl,
                  created: runningSandbox.created,
                  lastUpdated: runningSandbox.updated,
                  issueId: createRequest.issueId,
                  repositoryName: createRequest.repositoryName
                }
                
                this.sandboxes.set(runningSandbox.id, restartedState)
                await this.saveSandboxState()
                
                logWithContext('SANDBOX_MANAGER_DO', 'Sandbox restarted successfully', {
                  sandboxId: runningSandbox.id,
                  status: runningSandbox.status
                })
                
                return Response.json({
                  success: true,
                  data: runningSandbox,
                  sandboxId: runningSandbox.id
                } as SandboxManagerResponse<DaytonaSandbox>)
                
              } catch (restartError) {
                logWithContext('SANDBOX_MANAGER_DO', 'Failed to restart existing sandbox, will create new one', {
                  sandboxId: existingSandbox.id,
                  error: (restartError as Error).message
                })
                
                // Remove failed sandbox from state and fall through to create new one
                this.sandboxes.delete(existingSandbox.id)
                await this.saveSandboxState()
              }
              break
              
            case 'creating':
            case 'stopping':
              // Return existing sandbox immediately during transitions to avoid duplicates
              logWithContext('SANDBOX_MANAGER_DO', 'Sandbox in transition state, returning existing', {
                sandboxId: existingSandbox.id,
                status: existingSandbox.status
              })
              
              return Response.json({
                success: true,
                data: existingSandbox,
                sandboxId: existingSandbox.id
              } as SandboxManagerResponse<DaytonaSandbox>)
              
            case 'failed':
              logWithContext('SANDBOX_MANAGER_DO', 'Existing sandbox is in failed state, will create new one', {
                sandboxId: existingSandbox.id
              })
              
              // Clean up failed sandbox
              try {
                await this.daytonaClient!.deleteSandbox(existingSandbox.id)
              } catch (error) {
                logWithContext('SANDBOX_MANAGER_DO', 'Failed to cleanup failed sandbox', {
                  error: (error as Error).message
                })
              }
              
              this.sandboxes.delete(existingSandbox.id)
              await this.saveSandboxState()
              break
          }
        }
      }
      
      // Create new sandbox if no existing one found or existing one couldn't be reused
      logWithContext('SANDBOX_MANAGER_DO', 'Creating new sandbox with enhanced state validation', {
        name: createRequest.name,
        projectName: createRequest.projectName
      })
      
      let sandbox: any
      try {
        sandbox = await this.daytonaClient!.createSandbox({
          name: createRequest.name,
          projectName: createRequest.projectName,
          gitUrl: createRequest.gitUrl,
          image: 'claude-code-env', // Use our custom container image
          envVars: createRequest.envVars
        })
      } catch (createError) {
        logWithContext('SANDBOX_MANAGER_DO', 'Failed to create sandbox', {
          error: (createError as Error).message
        })
        
        return Response.json({
          success: false,
          error: `Failed to create sandbox: ${(createError as Error).message}`
        } as SandboxManagerResponse, {status: 500})
      }

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

      // Wait for sandbox to be running with comprehensive validation and recovery
      try {
        logWithContext('SANDBOX_MANAGER_DO', 'Waiting for sandbox to reach running state', {
          sandboxId: sandbox.id,
          initialStatus: sandbox.status
        })
        
        await this.daytonaClient!.waitForSandboxStatus(
          sandbox.id,
          'running',
          180000, // 3 minutes timeout
          3000    // 3 second polling
        )

        // Triple-check sandbox state after waiting - get fresh status from platform
        let finalStatus: any
        let statusVerificationAttempts = 0
        const maxStatusVerificationAttempts = 3
        
        while (statusVerificationAttempts < maxStatusVerificationAttempts) {
          statusVerificationAttempts++
          
          try {
            finalStatus = await this.daytonaClient!.getSandbox(sandbox.id)
            
            if (finalStatus.status === 'running') {
              logWithContext('SANDBOX_MANAGER_DO', 'Sandbox status verified as running', {
                sandboxId: sandbox.id,
                verificationAttempt: statusVerificationAttempts,
                finalStatus: finalStatus.status
              })
              break
            } else {
              logWithContext('SANDBOX_MANAGER_DO', 'Sandbox status not running - waiting before retry', {
                sandboxId: sandbox.id,
                currentStatus: finalStatus.status,
                verificationAttempt: statusVerificationAttempts
              })
              
              if (statusVerificationAttempts < maxStatusVerificationAttempts) {
                await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds
              }
            }
          } catch (statusError) {
            logWithContext('SANDBOX_MANAGER_DO', `Status verification attempt ${statusVerificationAttempts} failed`, {
              sandboxId: sandbox.id,
              error: (statusError as Error).message,
              verificationAttempt: statusVerificationAttempts
            })
            
            if (statusVerificationAttempts >= maxStatusVerificationAttempts) {
              throw new Error(`Sandbox created but disappeared from platform during startup verification: ${(statusError as Error).message}`)
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000)) // Wait before retry
          }
        }
        
        if (!finalStatus || finalStatus.status !== 'running') {
          throw new Error(`Sandbox reached status '${finalStatus?.status || 'unknown'}' instead of 'running' after ${statusVerificationAttempts} verification attempts`)
        }

        // Update state with validated running sandbox
        sandboxState.status = finalStatus.status
        sandboxState.lastUpdated = finalStatus.updated
        this.sandboxes.set(sandbox.id, sandboxState)
        await this.saveSandboxState()

        logWithContext('SANDBOX_MANAGER_DO', 'New sandbox successfully started and verified running', {
          sandboxId: sandbox.id,
          finalStatus: finalStatus.status,
          verificationAttempts: statusVerificationAttempts
        })

        return Response.json({
          success: true,
          data: finalStatus,
          sandboxId: sandbox.id
        } as SandboxManagerResponse<DaytonaSandbox>)

      } catch (startupError) {
        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox startup timeout or validation error - performing comprehensive cleanup', {
          sandboxId: sandbox.id,
          error: (startupError as Error).message
        })

        // Clean up failed sandbox from both platform and stored state
        try {
          // Try to get sandbox status first to see if it exists
          try {
            const failedSandbox = await this.daytonaClient!.getSandbox(sandbox.id)
            logWithContext('SANDBOX_MANAGER_DO', 'Failed sandbox still exists on platform - deleting', {
              sandboxId: sandbox.id,
              currentStatus: failedSandbox.status
            })
            
            await this.daytonaClient!.deleteSandbox(sandbox.id)
            logWithContext('SANDBOX_MANAGER_DO', 'Failed sandbox deleted from platform', {
              sandboxId: sandbox.id
            })
          } catch (getError) {
            logWithContext('SANDBOX_MANAGER_DO', 'Failed sandbox no longer exists on platform - cleanup not needed', {
              sandboxId: sandbox.id,
              error: (getError as Error).message
            })
          }
        } catch (cleanupError) {
          logWithContext('SANDBOX_MANAGER_DO', 'Failed to cleanup failed sandbox from platform', {
            sandboxId: sandbox.id,
            cleanupError: (cleanupError as Error).message
          })
        }
        
        this.sandboxes.delete(sandbox.id)
        await this.saveSandboxState()

        return Response.json({
          success: false,
          error: `Sandbox created but failed to start or validate: ${(startupError as Error).message}. The sandbox has been cleaned up automatically.`,
          sandboxId: sandbox.id
        } as SandboxManagerResponse, {status: 500})
      }

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error in sandbox creation process', {
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

      logWithContext("CLAUDE_CODE_RESPONSE", 'Got Claude Code response', claudeResult)
      // Step 5: Check for changes
      const gitStatus = await this.daytonaClient!.getGitStatus(sandbox.id, workspaceDir)
      const hasChanges = gitStatus.stdout.trim().length > 0
      logWithContext('GIT_STATUS', 'Checking git status', {gitStatus, hasChanges})
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
   * Clone repository and prepare workspace with comprehensive state validation and recovery
   */
  private async handleCloneAndSetup(request: Request): Promise<Response> {
    const cloneRequest: CloneAndSetupRequest = await request.json()

    logWithContext('SANDBOX_MANAGER_DO', 'Cloning and setting up workspace with comprehensive state validation', {
      sandboxId: cloneRequest.sandboxId,
      gitUrl: cloneRequest.gitUrl
    })

    try {
      const workspaceDir = cloneRequest.workspaceDir || '~/workspace'
      
      // First, validate that the sandbox exists and get its current state
      let sandbox: DaytonaSandbox
      try {
        sandbox = await this.daytonaClient!.getSandbox(cloneRequest.sandboxId)
        
        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox found on platform for clone operation', {
          sandboxId: cloneRequest.sandboxId,
          status: sandbox.status
        })
        
      } catch (sandboxError) {
        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox not found on Daytona platform during clone setup', {
          sandboxId: cloneRequest.sandboxId,
          error: (sandboxError as Error).message
        })
        
        // Clean up stale reference from stored state
        this.sandboxes.delete(cloneRequest.sandboxId)
        await this.saveSandboxState()
        
        throw new Error(`Sandbox ${cloneRequest.sandboxId} not found on Daytona platform. It may have been manually removed - please create a new sandbox.`)
      }
      
      // Check if sandbox is in running state and handle different states with enhanced recovery
      if (sandbox.status !== 'running') {
        logWithContext('SANDBOX_MANAGER_DO', 'Sandbox not running - attempting recovery with enhanced logic', {
          sandboxId: cloneRequest.sandboxId,
          currentStatus: sandbox.status
        })
        
        if (sandbox.status === 'stopped') {
          // Try to start the stopped sandbox with multiple attempts
          let startAttempts = 0
          const maxStartAttempts = 2
          let startSuccessful = false
          
          while (startAttempts < maxStartAttempts && !startSuccessful) {
            startAttempts++
            
            try {
              logWithContext('SANDBOX_MANAGER_DO', `Starting stopped sandbox for clone operation (attempt ${startAttempts}/${maxStartAttempts})`, {
                sandboxId: cloneRequest.sandboxId
              })
              
              await this.daytonaClient!.startSandbox(cloneRequest.sandboxId)
              
              // Wait for it to be running with proper error handling
              sandbox = await this.daytonaClient!.waitForSandboxStatus(
                cloneRequest.sandboxId,
                'running',
                120000, // 2 minutes timeout
                3000    // 3 second polling
              )
              
              // Verify the sandbox is truly running
              const verificationStatus = await this.daytonaClient!.getSandbox(cloneRequest.sandboxId)
              if (verificationStatus.status === 'running') {
                startSuccessful = true
                logWithContext('SANDBOX_MANAGER_DO', 'Sandbox started and verified running for clone operation', {
                  sandboxId: cloneRequest.sandboxId,
                  finalStatus: verificationStatus.status,
                  attempts: startAttempts
                })
                sandbox = verificationStatus
              } else {
                throw new Error(`Sandbox status verification failed - expected 'running', got '${verificationStatus.status}'`)
              }
              
            } catch (startError) {
              logWithContext('SANDBOX_MANAGER_DO', `Start attempt ${startAttempts} failed`, {
                sandboxId: cloneRequest.sandboxId,
                error: (startError as Error).message,
                attempts: startAttempts
              })
              
              if (startAttempts >= maxStartAttempts) {
                // Remove from stored state since it can't be started
                this.sandboxes.delete(cloneRequest.sandboxId)
                await this.saveSandboxState()
                
                throw new Error(`Sandbox is stopped and could not be started after ${maxStartAttempts} attempts: ${(startError as Error).message}. Please create a new sandbox.`)
              }
              
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 3000))
            }
          }
          
        } else if (sandbox.status === 'creating') {
          // Wait for sandbox creation to complete with enhanced monitoring
          try {
            logWithContext('SANDBOX_MANAGER_DO', 'Waiting for sandbox creation to complete with enhanced monitoring', {
              sandboxId: cloneRequest.sandboxId
            })
            
            sandbox = await this.daytonaClient!.waitForSandboxStatus(
              cloneRequest.sandboxId,
              'running',
              180000, // 3 minutes for creation
              3000
            )
            
            // Double-check the status
            const finalCheck = await this.daytonaClient!.getSandbox(cloneRequest.sandboxId)
            if (finalCheck.status !== 'running') {
              throw new Error(`Sandbox creation completed but status is '${finalCheck.status}' instead of 'running'`)
            }
            
            sandbox = finalCheck
            
            logWithContext('SANDBOX_MANAGER_DO', 'Sandbox creation completed and verified successfully', {
              sandboxId: cloneRequest.sandboxId,
              finalStatus: sandbox.status
            })
            
          } catch (creationError) {
            logWithContext('SANDBOX_MANAGER_DO', 'Sandbox creation failed or timed out', {
              sandboxId: cloneRequest.sandboxId,
              error: (creationError as Error).message
            })
            
            throw new Error(`Sandbox creation failed or timed out: ${(creationError as Error).message}`)
          }
          
        } else if (sandbox.status === 'failed') {
          logWithContext('SANDBOX_MANAGER_DO', 'Sandbox is in failed state - performing comprehensive cleanup', {
            sandboxId: cloneRequest.sandboxId
          })
          
          // Clean up failed sandbox
          try {
            await this.daytonaClient!.deleteSandbox(cloneRequest.sandboxId)
            logWithContext('SANDBOX_MANAGER_DO', 'Failed sandbox cleaned up from platform', {
              sandboxId: cloneRequest.sandboxId
            })
          } catch (cleanupError) {
            logWithContext('SANDBOX_MANAGER_DO', 'Failed to cleanup failed sandbox from platform', {
              sandboxId: cloneRequest.sandboxId,
              error: (cleanupError as Error).message
            })
          }
          
          this.sandboxes.delete(cloneRequest.sandboxId)
          await this.saveSandboxState()
          
          throw new Error(`Sandbox is in failed state and has been cleaned up. Please create a new sandbox.`)
          
        } else if (sandbox.status === 'stopping') {
          logWithContext('SANDBOX_MANAGER_DO', 'Sandbox is stopping - waiting for stop to complete then restarting', {
            sandboxId: cloneRequest.sandboxId
          })
          
          try {
            // Wait for stop to complete
            await this.daytonaClient!.waitForSandboxStatus(
              cloneRequest.sandboxId,
              'stopped',
              60000, // 1 minute timeout
              2000
            )
            
            // Now start it
            await this.daytonaClient!.startSandbox(cloneRequest.sandboxId)
            sandbox = await this.daytonaClient!.waitForSandboxStatus(
              cloneRequest.sandboxId,
              'running',
              120000,
              3000
            )
            
            logWithContext('SANDBOX_MANAGER_DO', 'Stopping sandbox restarted successfully', {
              sandboxId: cloneRequest.sandboxId,
              finalStatus: sandbox.status
            })
            
          } catch (restartError) {
            throw new Error(`Sandbox was stopping and could not be restarted: ${(restartError as Error).message}`)
          }
          
        } else {
          throw new Error(`Sandbox is in '${sandbox.status}' state and cannot be used for cloning. Please wait for it to reach running state or create a new sandbox.`)
        }
      }
      
      // Update stored state with current sandbox info
      const storedState = this.sandboxes.get(cloneRequest.sandboxId)
      if (storedState) {
        storedState.status = sandbox.status
        storedState.lastUpdated = sandbox.updated
        this.sandboxes.set(cloneRequest.sandboxId, storedState)
        await this.saveSandboxState()
      }
      
      // Final validation before proceeding with clone
      if (sandbox.status !== 'running') {
        throw new Error(`Sandbox status validation failed - expected 'running' but got '${sandbox.status}'`)
      }
      
      // Now proceed with cloning
      logWithContext('SANDBOX_MANAGER_DO', 'Sandbox fully validated and running - proceeding with clone', {
        sandboxId: cloneRequest.sandboxId,
        status: sandbox.status
      })

      const result = await this.daytonaClient!.cloneRepository(
        cloneRequest.sandboxId,
        cloneRequest.gitUrl,
        workspaceDir,
        cloneRequest.installationToken
      )

      logWithContext('SANDBOX_MANAGER_DO', 'Repository cloned successfully with comprehensive validation', {
        sandboxId: cloneRequest.sandboxId
      })

      return Response.json({
        success: true,
        data: result,
        sandboxId: cloneRequest.sandboxId
      } as SandboxManagerResponse)

    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error in clone and setup with comprehensive validation', {
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
   * Find sandbox by issue ID
   */
  private async handleFindByIssueId(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const issueId = url.searchParams.get('issueId')

    if (!issueId) {
      return Response.json({
        success: false,
        error: 'issueId parameter required'
      } as SandboxManagerResponse, {status: 400})
    }

    logWithContext('SANDBOX_MANAGER_DO', 'Finding sandbox by issue ID', {issueId})

    try {
      const sandbox = await this.findSandboxByIssueId(issueId)

      if (sandbox) {
        logWithContext('SANDBOX_MANAGER_DO', 'Found sandbox by issue ID', {
          issueId,
          sandboxId: sandbox.id,
          status: sandbox.status
        })
        
        return Response.json({
          success: true,
          data: sandbox,
          sandboxId: sandbox.id
        } as SandboxManagerResponse<DaytonaSandbox>)
      } else {
        logWithContext('SANDBOX_MANAGER_DO', 'No sandbox found for issue ID', {issueId})
        
        return Response.json({
          success: true,
          data: null
        } as SandboxManagerResponse<null>)
      }
      
    } catch (error) {
      logWithContext('SANDBOX_MANAGER_DO', 'Error finding sandbox by issue ID', {
        issueId,
        error: (error as Error).message
      })

      return Response.json({
        success: false,
        error: (error as Error).message
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