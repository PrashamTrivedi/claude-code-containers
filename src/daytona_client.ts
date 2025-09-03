import {Daytona, Image} from '@daytonaio/sdk'
import {logWithContext} from './log'

// Daytona SDK interfaces (aligned with SDK types)
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
 * Daytona SDK client wrapper for managing sandboxes
 */
export class DaytonaClient {
  private daytona: Daytona
  private apiUrl: string

  constructor(apiKey: string, apiUrl: string = 'https://api.daytona.io') {
    this.apiUrl = apiUrl.replace(/\/$/, '') // Remove trailing slash
    this.daytona = new Daytona({
      apiKey,
      apiUrl: this.apiUrl
    })

    logWithContext('DAYTONA_CLIENT', 'SDK client initialized', {
      apiUrl: this.apiUrl
    })
  }


  /**
   * Create a new sandbox
   */
  async createSandbox(request: CreateSandboxRequest): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Creating sandbox via SDK', {
      name: request.name,
      projectName: request.projectName,
      gitUrl: request.gitUrl,
      hasEnvVars: !!request.envVars && Object.keys(request.envVars).length > 0
    })

    try {
      const sandbox = await this.daytona.create({
        snapshot: 'claude-code-env',
        user: 'claude',
        envVars: request.envVars || {},
        labels: {
          projectName: request.projectName,
          gitUrl: request.gitUrl,
          name: request.name
        }
      })

      logWithContext('DAYTONA_CLIENT', 'Sandbox created successfully via SDK', {
        sandboxId: sandbox.id,
        state: sandbox.state
      })

      // Transform SDK response to our interface
      return {
        id: sandbox.id,
        name: sandbox.labels?.name || request.name,
        status: this.mapSandboxState(sandbox.state),
        workspaceId: sandbox.organizationId || '',
        projectName: request.projectName,
        gitUrl: request.gitUrl,
        created: sandbox.createdAt || new Date().toISOString(),
        updated: sandbox.updatedAt || new Date().toISOString()
      }
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error creating sandbox via SDK', {
        error: (error as Error).message
      })
      throw new Error(`Failed to create sandbox: ${(error as Error).message}`)
    }
  }

  /**
   * Get sandbox by ID
   */
  async getSandbox(sandboxId: string): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Getting sandbox via SDK', {sandboxId})

    try {
      const sandbox = await this.daytona.findOne({id: sandboxId})

      return {
        id: sandbox.id,
        name: sandbox.labels?.name || sandbox.id,
        status: this.mapSandboxState(sandbox.state),
        workspaceId: sandbox.organizationId || '',
        projectName: sandbox.labels?.projectName || sandbox.id,
        gitUrl: sandbox.labels?.gitUrl,
        created: sandbox.createdAt || new Date().toISOString(),
        updated: sandbox.updatedAt || new Date().toISOString()
      }
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error getting sandbox via SDK', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to get sandbox: ${(error as Error).message}`)
    }
  }

  /**
   * List all sandboxes
   */
  async listSandboxes(workspaceId?: string): Promise<DaytonaSandbox[]> {
    logWithContext('DAYTONA_CLIENT', 'Listing sandboxes via SDK', {workspaceId})

    try {
      const sandboxes = await this.daytona.list()

      return sandboxes
        .filter(sandbox => !workspaceId || sandbox.organizationId === workspaceId)
        .map(sandbox => ({
          id: sandbox.id,
          name: sandbox.labels?.name || sandbox.id,
          status: this.mapSandboxState(sandbox.state),
          workspaceId: sandbox.organizationId || '',
          projectName: sandbox.labels?.projectName || sandbox.id,
          gitUrl: sandbox.labels?.gitUrl,
          created: sandbox.createdAt || new Date().toISOString(),
          updated: sandbox.updatedAt || new Date().toISOString()
        }))
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error listing sandboxes via SDK', {
        error: (error as Error).message
      })
      throw new Error(`Failed to list sandboxes: ${(error as Error).message}`)
    }
  }

  /**
   * Start a sandbox
   */
  async startSandbox(sandboxId: string): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Starting sandbox via SDK', {sandboxId})

    try {
      const sandbox = await this.daytona.findOne({id: sandboxId})
      await sandbox.start()

      return {
        id: sandbox.id,
        name: sandbox.labels?.name || sandbox.id,
        status: this.mapSandboxState(sandbox.state),
        workspaceId: sandbox.organizationId || '',
        projectName: sandbox.labels?.projectName || sandbox.id,
        gitUrl: sandbox.labels?.gitUrl,
        created: sandbox.createdAt || new Date().toISOString(),
        updated: sandbox.updatedAt || new Date().toISOString()
      }
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error starting sandbox via SDK', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to start sandbox: ${(error as Error).message}`)
    }
  }

  /**
   * Stop a sandbox
   */
  async stopSandbox(sandboxId: string): Promise<DaytonaSandbox> {
    logWithContext('DAYTONA_CLIENT', 'Stopping sandbox via SDK', {sandboxId})

    try {
      const sandbox = await this.daytona.findOne({id: sandboxId})
      await sandbox.stop()

      return {
        id: sandbox.id,
        name: sandbox.labels?.name || sandbox.id,
        status: this.mapSandboxState(sandbox.state),
        workspaceId: sandbox.organizationId || '',
        projectName: sandbox.labels?.projectName || sandbox.id,
        gitUrl: sandbox.labels?.gitUrl,
        created: sandbox.createdAt || new Date().toISOString(),
        updated: sandbox.updatedAt || new Date().toISOString()
      }
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error stopping sandbox via SDK', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to stop sandbox: ${(error as Error).message}`)
    }
  }

  /**
   * Delete a sandbox
   */
  async deleteSandbox(sandboxId: string): Promise<void> {
    logWithContext('DAYTONA_CLIENT', 'Deleting sandbox via SDK', {sandboxId})

    try {
      const sandbox = await this.daytona.findOne({id: sandboxId})
      await sandbox.delete()

      logWithContext('DAYTONA_CLIENT', 'Sandbox deleted successfully via SDK', {sandboxId})
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error deleting sandbox via SDK', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to delete sandbox: ${(error as Error).message}`)
    }
  }

  /**
   * Execute a command in a sandbox
   */
  async executeCommand(
    sandboxId: string,
    request: ExecuteCommandRequest
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Executing command in sandbox via SDK', {
      sandboxId,
      command: request.command.substring(0, 100),
      workingDirectory: request.workingDirectory,
      hasEnvVars: !!request.envVars && Object.keys(request.envVars).length > 0
    })

    const startTime = Date.now()

    try {
      const sandbox = await this.daytona.findOne({id: sandboxId})
      const result = await sandbox.process.executeCommand(
        request.command
      )

      const actualDuration = Date.now() - startTime

      const response: ExecuteCommandResponse = {
        exitCode: result.exitCode || 0,
        stdout: result.artifacts?.stdout || result.result || '',
        stderr: result.artifacts?.stderr || '', // Check for separate stderr
        duration: actualDuration
      }

      logWithContext('DAYTONA_CLIENT', 'Command execution completed via SDK', {
        sandboxId,
        exitCode: response.exitCode,
        stdoutLength: response.stdout.length,
        stderrLength: response.stderr.length,
        duration: response.duration
      })

      return response
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error executing command via SDK', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to execute command: ${(error as Error).message}`)
    }
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
    logWithContext('DAYTONA_CLIENT', 'Waiting for sandbox status via SDK', {
      sandboxId,
      targetStatus,
      timeoutMs,
      pollIntervalMs
    })

    try {
      const sandbox = await this.daytona.findOne({id: sandboxId})
      const timeoutSeconds = Math.floor(timeoutMs / 1000)

      if (targetStatus === 'running') {
        await sandbox.waitUntilStarted(timeoutSeconds)
      } else if (targetStatus === 'stopped') {
        await sandbox.waitUntilStopped(timeoutSeconds)
      } else {
        // Fallback to polling for other statuses
        const startTime = Date.now()

        while (Date.now() - startTime < timeoutMs) {
          const currentSandbox = await this.getSandbox(sandboxId)

          if (currentSandbox.status === targetStatus) {
            logWithContext('DAYTONA_CLIENT', 'Sandbox reached target status via SDK', {
              sandboxId,
              status: currentSandbox.status,
              elapsedMs: Date.now() - startTime
            })
            return currentSandbox
          }

          if (currentSandbox.status === 'failed') {
            throw new Error(`Sandbox ${sandboxId} failed to reach status ${targetStatus}`)
          }

          await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
        }

        throw new Error(`Timeout waiting for sandbox ${sandboxId} to reach status ${targetStatus}`)
      }

      // Return updated sandbox info
      return await this.getSandbox(sandboxId)
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error waiting for sandbox status via SDK', {
        sandboxId,
        targetStatus,
        error: (error as Error).message
      })
      throw new Error(`Failed to wait for sandbox status: ${(error as Error).message}`)
    }
  }

  /**
   * Map SDK SandboxState to our DaytonaSandbox status
   */
  private mapSandboxState(state?: any): DaytonaSandbox['status'] {
    if (!state) return 'creating'

    // Map SDK states to our interface states
    switch (state) {
      case 'STARTED':
        return 'running'
      case 'STOPPED':
        return 'stopped'
      case 'STARTING':
        return 'creating'
      case 'STOPPING':
        return 'stopping'
      case 'ERROR':
        return 'failed'
      default:
        return 'creating'
    }
  }

  /**
   * Clone repository using git operations
   */
  async cloneRepository(
    sandboxId: string,
    gitUrl: string,
    workspaceDir: string,
    authToken: string
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Cloning repository via SDK', {
      sandboxId,
      gitUrl,
      workspaceDir
    })

    // Create the workspace directory and clone the repo
    const cloneCommand = `mkdir -p ${workspaceDir} && cd ${workspaceDir} && git clone https://x-access-token:${authToken}@${gitUrl.replace('https://', '')} .`

    try {
      const response = await this.executeCommand(sandboxId, {
        command: cloneCommand,
        workingDirectory: '/'
      })

      logWithContext('DAYTONA_CLIENT', 'Repository cloned successfully', {
        sandboxId,
        exitCode: response.exitCode,
        stdoutLength: response.stdout.length
      })

      return response
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error cloning repository', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to clone repository: ${(error as Error).message}`)
    }
  }

  /**
   * Execute Claude CLI with specific command format
   */
  async executeClaudeCommand(
    sandboxId: string,
    prompt: string
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Executing Claude CLI command', {
      sandboxId,
      promptLength: prompt.length,
      prompt
    })

    // Base64 encode the prompt using modern Web API
    const messageBase64 = btoa(prompt)

    // Execute Claude CLI with the exact required format
    const claudeCommand = `claude --dangerously-skip-permissions -p \"${prompt}\" --output-format json`

    try {
      const response = await this.executeCommand(sandboxId, {
        command: claudeCommand,
        workingDirectory: '~/workspace'
      })

      logWithContext('DAYTONA_CLIENT', 'Claude CLI executed successfully', {
        sandboxId,
        exitCode: response.exitCode,
        stdoutLength: response.stdout.length,
        stderrLength: response.stderr.length
      })

      return response
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error executing Claude CLI', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to execute Claude CLI: ${(error as Error).message}`)
    }
  }

  /**
   * Get git status to check for file changes
   */
  async getGitStatus(
    sandboxId: string,
    workspaceDir: string = '/workspace'
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Getting git status', {
      sandboxId,
      workspaceDir
    })

    try {
      const response = await this.executeCommand(sandboxId, {
        command: 'git status --porcelain',
        workingDirectory: workspaceDir
      })

      logWithContext('DAYTONA_CLIENT', 'Git status retrieved', {
        sandboxId,
        exitCode: response.exitCode,
        hasChanges: response.stdout.trim().length > 0
      })

      return response
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error getting git status', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to get git status: ${(error as Error).message}`)
    }
  }

  /**
   * Create commit and push changes
   */
  async createCommitAndPush(
    sandboxId: string,
    workspaceDir: string,
    message: string,
    branchName: string
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Creating commit and pushing', {
      sandboxId,
      workspaceDir,
      branchName,
      message
    })

    // Multi-step git operations: create branch, add files, commit, and push
    const gitCommands = `
cd ${workspaceDir} && \
git checkout -b ${branchName} && \
git add . && \
git commit -m "${message}" && \
git push origin ${branchName}
    `.trim()

    try {
      const response = await this.executeCommand(sandboxId, {
        command: gitCommands,
        workingDirectory: workspaceDir
      })

      logWithContext('DAYTONA_CLIENT', 'Commit and push completed', {
        sandboxId,
        branchName,
        exitCode: response.exitCode,
        stdoutLength: response.stdout.length
      })

      return response
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error creating commit and pushing', {
        sandboxId,
        error: (error as Error).message
      })
      throw new Error(`Failed to create commit and push: ${(error as Error).message}`)
    }
  }

  /**
   * Read file from sandbox
   */
  async readFile(
    sandboxId: string,
    filePath: string
  ): Promise<string> {
    logWithContext('DAYTONA_CLIENT', 'Reading file from sandbox', {
      sandboxId,
      filePath
    })

    try {
      const response = await this.executeCommand(sandboxId, {
        command: `cat "${filePath}"`,
        workingDirectory: '/'
      })

      if (response.exitCode !== 0) {
        throw new Error(`File not found or read error: ${response.stderr}`)
      }

      logWithContext('DAYTONA_CLIENT', 'File read successfully', {
        sandboxId,
        filePath,
        contentLength: response.stdout.length
      })

      return response.stdout
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error reading file', {
        sandboxId,
        filePath,
        error: (error as Error).message
      })
      throw new Error(`Failed to read file: ${(error as Error).message}`)
    }
  }

  /**
   * Write file to sandbox
   */
  async writeFile(
    sandboxId: string,
    filePath: string,
    content: string
  ): Promise<ExecuteCommandResponse> {
    logWithContext('DAYTONA_CLIENT', 'Writing file to sandbox', {
      sandboxId,
      filePath,
      contentLength: content.length
    })

    // Escape content for shell safety
    const escapedContent = content.replace(/'/g, "'\"'\"'")

    try {
      const response = await this.executeCommand(sandboxId, {
        command: `echo '${escapedContent}' > "${filePath}"`,
        workingDirectory: '/'
      })

      logWithContext('DAYTONA_CLIENT', 'File written successfully', {
        sandboxId,
        filePath,
        exitCode: response.exitCode
      })

      return response
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Error writing file', {
        sandboxId,
        filePath,
        error: (error as Error).message
      })
      throw new Error(`Failed to write file: ${(error as Error).message}`)
    }
  }

  /**
   * Health check - verify SDK connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      logWithContext('DAYTONA_CLIENT', 'Performing health check via SDK')

      // Try to list sandboxes as a simple connectivity test
      await this.listSandboxes()

      logWithContext('DAYTONA_CLIENT', 'Health check passed via SDK')
      return true
    } catch (error) {
      logWithContext('DAYTONA_CLIENT', 'Health check failed via SDK', {
        error: (error as Error).message
      })
      return false
    }
  }
}