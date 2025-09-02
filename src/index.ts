import {decrypt, generateInstallationToken} from './crypto'
import {handleOAuthCallback} from './handlers/oauth_callback'
import {handleClaudeSetup} from './handlers/claude_setup'
import {handleGitHubSetup} from './handlers/github_setup'
import {handleGitHubStatus} from './handlers/github_status'
import {handleGitHubWebhook} from './handlers/github_webhook'
import {handleClaudeTest} from './handlers/claude_test'
import {handleDaytonaSetup, getDaytonaCredentials} from './handlers/daytona_setup'
import {DaytonaSandboxManagerDO} from './daytona_sandbox_manager'
import {logWithContext} from './log'


// Export the Durable Object class
export { DaytonaSandboxManagerDO }

export default {
  async fetch(
    request: Request,
    env: {
      DAYTONA_SANDBOX_MANAGER: DurableObjectNamespace
      GITHUB_CONFIG: KVNamespace
      DAYTONA_API_KEY?: string
      DAYTONA_API_URL?: string
    }
  ): Promise<Response> {
    const startTime = Date.now()
    const url = new URL(request.url)
    const pathname = url.pathname

    // Log all incoming requests
    logWithContext('MAIN_HANDLER', 'Incoming request', {
      method: request.method,
      pathname,
      origin: url.origin,
      userAgent: request.headers.get('user-agent'),
      contentType: request.headers.get('content-type'),
      referer: request.headers.get('referer'),
      cfRay: request.headers.get('cf-ray'),
      cfCountry: request.headers.get('cf-ipcountry')
    })

    let response: Response
    let routeMatched = false

    try {
      // Claude Code Setup Route
      if (pathname === '/claude-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to Claude setup')
        routeMatched = true
        response = await handleClaudeSetup(request, url.origin, env)
      }

      // Daytona sandbox setup route
      else if (pathname === '/daytona-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to Daytona setup')
        routeMatched = true
        response = await handleDaytonaSetup(request, url.origin, env)
      }

      // GitHub App Setup Routes
      else if (pathname === '/gh-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub setup')
        routeMatched = true
        response = await handleGitHubSetup(request, url.origin, env)
      }

      else if (pathname === '/gh-setup/callback') {
        logWithContext('MAIN_HANDLER', 'Routing to OAuth callback')
        routeMatched = true
        response = await handleOAuthCallback(request, url, env)
      }

      // Status endpoint to check stored configurations
      else if (pathname === '/gh-status') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub status')
        routeMatched = true
        response = await handleGitHubStatus(request, env)
      }

      // Claude test endpoint
      else if (pathname === '/test-claude') {
        logWithContext('MAIN_HANDLER', 'Routing to Claude test')
        routeMatched = true
        response = await handleClaudeTest(request, env)
      }

      // GitHub webhook endpoint
      else if (pathname === '/webhooks/github') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub webhook handler')
        routeMatched = true
        response = await handleGitHubWebhook(request, env)
      }

      // Daytona sandbox routes
      else if (pathname.startsWith('/sandbox')) {
        logWithContext('MAIN_HANDLER', 'Routing to Daytona sandbox manager')
        routeMatched = true
        
        // Get or create Daytona sandbox manager DO
        const id = env.DAYTONA_SANDBOX_MANAGER.idFromName('default')
        const sandboxManager = env.DAYTONA_SANDBOX_MANAGER.get(id)
        
        // Forward request to sandbox manager
        const sandboxPath = pathname.replace('/sandbox', '')
        const sandboxUrl = new URL(request.url)
        sandboxUrl.pathname = sandboxPath || '/health'
        
        const sandboxRequest = new Request(sandboxUrl.toString(), {
          method: request.method,
          headers: request.headers,
          body: request.method !== 'GET' ? request.body : undefined
        })
        
        response = await sandboxManager.fetch(sandboxRequest)
      }

      // Default home page
      else {
        logWithContext('MAIN_HANDLER', 'Serving home page')
        routeMatched = true
        response = new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Code Container Integration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e9ecef;
        }
        .title {
            font-size: 2.5em;
            margin-bottom: 10px;
            color: #0969da;
        }
        .subtitle {
            font-size: 1.2em;
            color: #666;
            margin-bottom: 0;
        }
        .section {
            margin: 30px 0;
            padding: 25px;
            background: #f8f9fa;
            border-radius: 8px;
            border-left: 4px solid #0969da;
        }
        .section h3 {
            margin-top: 0;
            color: #0969da;
            font-size: 1.4em;
        }
        .link-group {
            margin: 20px 0;
        }
        .btn {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 8px 8px 8px 0;
            transition: background-color 0.2s;
        }
        .btn:hover {
            background: #0550ae;
        }
        .btn.setup {
            background: #28a745;
        }
        .btn.setup:hover {
            background: #218838;
        }
        .btn.test {
            background: #fd7e14;
        }
        .btn.test:hover {
            background: #e8650e;
        }
        .btn.container {
            background: #6f42c1;
        }
        .btn.container:hover {
            background: #5a359a;
        }
        .step {
            margin: 15px 0;
            padding: 15px;
            background: white;
            border-radius: 6px;
            border: 1px solid #dee2e6;
        }
        .step-number {
            display: inline-block;
            background: #0969da;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            text-align: center;
            line-height: 24px;
            font-weight: bold;
            margin-right: 10px;
        }
        .success-note {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
            padding: 15px;
            border-radius: 6px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">Claude Code Container Integration</h1>
        <p class="subtitle">AI-powered GitHub issue processing with Claude Code</p>
    </div>

    <div class="section">
        <h3>Setup Instructions</h3>
        <div class="step">
            <span class="step-number">1</span>
            <strong>Configure Claude Code:</strong> Set up your Anthropic API key for Claude integration
            <div class="link-group">
                <a href="/claude-setup" class="btn setup">Configure Claude API Key</a>
            </div>
        </div>
        <div class="step">
            <span class="step-number">2</span>
            <strong>Setup Daytona Integration:</strong> Configure your Daytona API credentials
            <div class="link-group">
                <a href="/daytona-setup" class="btn setup">Setup Daytona Integration</a>
            </div>
        </div>
        <div class="step">
            <span class="step-number">3</span>
            <strong>Setup GitHub Integration:</strong> Create and configure your GitHub App
            <div class="link-group">
                <a href="/gh-setup" class="btn setup">Setup GitHub Integration</a>
                <a href="/gh-status" class="btn">Check Setup Status</a>
            </div>
        </div>
    </div>

    <div class="section">
        <h3>Testing & Validation</h3>
        <div class="link-group">
            <a href="/test-claude" class="btn test">Test Claude API</a>
            <span style="margin-left: 10px; color: #666;">Test your Claude configuration with a Star Wars greeting!</span>
        </div>
    </div>

    <div class="section">
        <h3>Daytona Sandbox Testing Routes</h3>
        <p>These routes are for testing the Daytona sandbox infrastructure:</p>
        <div class="link-group">
            <a href="/sandbox/health" class="btn container">Sandbox Health Check</a>
            <a href="/sandbox/list" class="btn container">List Sandboxes</a>
            <a href="/sandbox/cleanup" class="btn container">Cleanup Old Sandboxes</a>
        </div>
    </div>

    <div class="success-note">
        <strong>Ready to go?</strong> Once both setups are complete, create GitHub issues in your repositories to trigger automatic Claude Code processing!
    </div>

    <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e9ecef;">
        <p style="color: #666; font-size: 0.9em;">
            Powered by <strong>Cloudflare Workers</strong> + <strong>Daytona Sandboxes</strong> + <strong>Claude Code</strong> + <strong>GitHub Apps</strong>
        </p>
    </div>
</body>
</html>`, {
          headers: {'Content-Type': 'text/html'}
        })
      }

      const processingTime = Date.now() - startTime

      logWithContext('MAIN_HANDLER', 'Request completed successfully', {
        pathname,
        method: request.method,
        status: response.status,
        statusText: response.statusText,
        processingTimeMs: processingTime,
        routeMatched
      })

      return response

    } catch (error) {
      const processingTime = Date.now() - startTime

      logWithContext('MAIN_HANDLER', 'Request failed with error', {
        pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: processingTime,
        routeMatched
      })

      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: {'Content-Type': 'application/json'}
      })
    }
  },
}
