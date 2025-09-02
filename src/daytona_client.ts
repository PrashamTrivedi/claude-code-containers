import { logWithContext } from './log'

// Daytona API interfaces
export interface DaytonaSandbox {
  id: string
  name: string
  status: 'running' | 'stopped' | 'creating' | 'stopping' | 'failed'
  workspaceId: string
  projectName: string
  gitUrl?: string
  created: string
  updated: string
}

export interface CreateSandboxRequest {
  name: string
  workspaceId?: string
  projectName: string
  gitUrl: string
  image?: string
  envVars?: Record<string, string>
}

export interface ExecuteCommandRequest {
  command: string
  workingDirectory?: string
  envVars?: Record<string, string>
}

export interface ExecuteCommandResponse {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

export interface DaytonaApiError {
  error: string
  message: string
  status: number
}

/**
 * Daytona API client for managing sandboxes
 */
export class DaytonaClient {
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl: string = 'https://api.daytona.io') {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/$/, '') // Remove trailing slash
  }

  /**
   * Make authenticated request to Daytona API
   */
  private async makeRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    
    logWithContext('DAYTONA_CLIENT', 'Making API request', {
      method: options.method || 'GET',
      endpoint,
      hasBody: !!options.body
    })

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const responseText = await response.text()
    
    logWithContext('DAYTONA_CLIENT', 'API response received', {
      status: response.status,
      statusText: response.statusText,
      responseLength: responseText.length
    })

    if (!response.ok) {
      let errorData: DaytonaApiError
      try {
        errorData = JSON.parse(responseText)
      } catch {
        errorData = {
          error: 'Unknown error',
          message: responseText || response.statusText,
          status: response.status
        }
      }

      logWithContext('DAYTONA_CLIENT', 'API error response', {
        status: response.status,
        error: errorData.error,
        message: errorData.message
      })

      throw new Error(`Daytona API Error (${response.status}): ${errorData.message || errorData.error}`)
    }

    if (!responseText) {
      return {} as T
    }

    try {
      return JSON.parse(responseText)
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error parsing JSON response', {
        error: (error as Error).message,
        responseText: responseText.substring(0, 200)
      })
      throw new Error('Invalid JSON response from Daytona API')
    }
  }

  /**
   * Create a new sandbox
   */
  async createSandbox(request: CreateSandboxRequest): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Creating sandbox', {
      name: request.name,
      projectName: request.projectName,
      gitUrl: request.gitUrl,
      hasEnvVars: !!request.envVars && Object.keys(request.envVars).length > 0
    })

    const sandbox = await this.makeRequest<DaytonaSandbox>('/v1/sandboxes', {
      method: 'POST',
      body: JSON.stringify({
        name: request.name,
        workspace_id: request.workspaceId,
        project_name: request.projectName,
        git_url: request.gitUrl,
        image: request.image || 'claude-code-container',
        env_vars: request.envVars || {}
      })
    })

    logWithContext('DAYTONA_CLIENT', 'Sandbox created successfully', {
      sandboxId: sandbox.id,
      status: sandbox.status
    })

    return sandbox
  }

  /**
   * Get sandbox by ID
   */
  async getSandbox(sandboxId: string): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Getting sandbox', { sandboxId })
    
    return this.makeRequest<DaytonaSandbox>(`/v1/sandboxes/${sandboxId}`)
  }

  /**
   * List all sandboxes
   */
  async listSandboxes(workspaceId?: string): Promise<DaytonaSandbox[]> {
    logWithContext('DAYTONA_CLIENT', 'Listing sandboxes', { workspaceId })
    
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : ''
    return this.makeRequest<DaytonaSandbox[]>(`/v1/sandboxes${query}`)
  }

  /**
   * Start a sandbox
   */
  async startSandbox(sandboxId: string): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Starting sandbox', { sandboxId })
    
    return this.makeRequest<DaytonaSandbox>(`/v1/sandboxes/${sandboxId}/start`, {
      method: 'POST'
    })
  }

  /**
   * Stop a sandbox
   */
  async stopSandbox(sandboxId: string): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Stopping sandbox', { sandboxId })
    
    return this.makeRequest<DaytonaSandbox>(`/v1/sandboxes/${sandboxId}/stop`, {
      method: 'POST'
    })
  }

  /**
   * Delete a sandbox
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    logWithContext('DAYTONA_CLIENT', 'Deleting sandbox', { sandboxId })
    
    await this.makeRequest<void>(`/v1/sandboxes/${sandboxId}`, {
      method: 'DELETE'
    })

    logWithContext('DAYTONA_CLIENT', 'Sandbox deleted successfully', { sandboxId })
  }

  /**
   * Execute a command in a sandbox
   */
  async executeCommand(
    sandboxId: string,
    request: ExecuteCommandRequest
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Executing command in sandbox', {
      sandboxId,
      command: request.command.substring(0, 100),
      workingDirectory: request.workingDirectory,
      hasEnvVars: !!request.envVars && Object.keys(request.envVars).length > 0
    })

    const startTime = Date.now()
    
    const response = await this.makeRequest<ExecuteCommandResponse>(
      `/v1/sandboxes/${sandboxId}/exec`,
      {
        method: 'POST',
        body: JSON.stringify({
          command: request.command,
          working_directory: request.workingDirectory || '/workspace',
          env_vars: request.envVars || {}
        })
      }
    )

    const actualDuration = Date.now() - startTime

    logWithContext('DAYTONA_CLIENT', 'Command execution completed', {
      sandboxId,
      exitCode: response.exitCode,
      stdoutLength: response.stdout.length,
      stderrLength: response.stderr.length,
      reportedDuration: response.duration,
      actualDuration
    })

    return response
  }

  /**
   * Wait for sandbox to reach desired status
   */
  async waitForSandboxStatus(
    sandboxId: string,
    targetStatus: DaytonaSandbox['status'],
    timeoutMs: number = 120000, // 2 minutes default
    pollIntervalMs: number = 2000 // 2 seconds default
  ): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Waiting for sandbox status', {
      sandboxId,
      targetStatus,
      timeoutMs,
      pollIntervalMs
    })

    const startTime = Date.now()
    
    while (Date.now() - startTime < timeoutMs) {
      const sandbox = await this.getSandbox(sandboxId)
      
      if (sandbox.status === targetStatus) {
        logWithContext('DAYTONA_CLIENT', 'Sandbox reached target status', {
          sandboxId,
          status: sandbox.status,
          elapsedMs: Date.now() - startTime
        })
        return sandbox
      }

      if (sandbox.status === 'failed') {
        throw new Error(`Sandbox ${sandboxId} failed to reach status ${targetStatus}`)
      }

      logWithContext('DAYTONA_CLIENT', 'Sandbox status check', {
        sandboxId,
        currentStatus: sandbox.status,
        targetStatus,
        elapsedMs: Date.now() - startTime
      })

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error(`Timeout waiting for sandbox ${sandboxId} to reach status ${targetStatus}`)
  }

  /**
   * Health check - verify API connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      logWithContext('DAYTONA_CLIENT', 'Performing health check')
      
      // Try to list sandboxes as a simple connectivity test
      await this.listSandboxes()
      
      logWithContext('DAYTONA_CLIENT', 'Health check passed')
      return true
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Health check failed', {
        error: (error as Error).message
      })
      return false
    }
  }
}