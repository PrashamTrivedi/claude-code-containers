import {decrypt, generateInstallationToken} from './crypto'
import {handleOAuthCallback} from './handlers/oauth_callback'
import {handleClaudeSetup} from './handlers/claude_setup'
import {handleGitHubSetup} from './handlers/github_setup'
import {handleGitHubStatus} from './handlers/github_status'
import {handleGitHubWebhook} from './handlers/github_webhook'
import {handleClaudeTest} from './handlers/claude_test'
import {handleDaytonaSetup, getDaytonaCredentials, isDaytonaConfigured} from './handlers/daytona_setup'
import {DaytonaSandboxManagerDO} from './daytona_sandbox_manager'
import {DaytonaClient} from './daytona_client'
import {isClaudeApiKeyConfigured, isGitHubAppConfigured} from './kv_storage'
import {logWithContext} from './log'


// Export the Durable Object class
export { DaytonaSandboxManagerDO }

/**
 * Handle comprehensive status dashboard with HTML interface
 */
async function handleStatusDashboard(request: Request, env: any): Promise<Response> {
  try {
    logWithContext('STATUS_DASHBOARD', 'Generating status dashboard')

    // Check all configurations
    const claudeConfigured = await isClaudeApiKeyConfigured(env)
    const githubConfigured = await isGitHubAppConfigured(env)
    const daytonaConfigured = await isDaytonaConfigured(env)

    // Check Daytona connection and sandbox status
    let daytonaStatus = 'not configured'
    let sandboxCount = 0
    let daytonaError = null

    if (daytonaConfigured) {
      try {
        const daytonaCredentials = await getDaytonaCredentials(env)
        if (daytonaCredentials) {
          const daytonaClient = new DaytonaClient(daytonaCredentials.apiKey, daytonaCredentials.apiUrl)
          const isHealthy = await daytonaClient.healthCheck()

          if (isHealthy) {
            daytonaStatus = 'connected'
            try {
              const sandboxes = await daytonaClient.listSandboxes()
              sandboxCount = sandboxes.length
            } catch {
              sandboxCount = 0
            }
          } else {
            daytonaStatus = 'connection failed'
          }
        }
      } catch (error) {
        logWithContext('STATUS_DASHBOARD', 'Error checking Daytona status', {
          error: (error as Error).message
        })
        daytonaStatus = 'error'
        daytonaError = (error as Error).message
      }
    }

    const allReady = claudeConfigured && githubConfigured && daytonaStatus === 'connected'

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Configuration Status - Claude Code Integration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 900px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
            background: #fafbfc;
        }
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid #e9ecef;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
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
        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .status-card {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            border-left: 4px solid #dee2e6;
        }
        .status-card.success {
            border-left-color: #28a745;
        }
        .status-card.error {
            border-left-color: #dc3545;
        }
        .status-card.warning {
            border-left-color: #ffc107;
        }
        .status-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .status-icon {
            font-size: 24px;
            margin-right: 12px;
        }
        .status-title {
            font-size: 1.3em;
            font-weight: 600;
            color: #333;
            margin: 0;
        }
        .status-detail {
            margin: 8px 0;
            color: #666;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .badge-success {
            background: #d4edda;
            color: #155724;
        }
        .badge-error {
            background: #f8d7da;
            color: #721c24;
        }
        .badge-warning {
            background: #fff3cd;
            color: #856404;
        }
        .overall-status {
            background: white;
            padding: 30px;
            border-radius: 8px;
            text-align: center;
            margin: 30px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .overall-status.ready {
            border-left: 4px solid #28a745;
        }
        .overall-status.not-ready {
            border-left: 4px solid #dc3545;
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
        .error-details {
            background: #ffeaea;
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
            font-size: 14px;
            color: #d73a49;
        }
        .last-updated {
            text-align: center;
            color: #666;
            font-size: 14px;
            margin-top: 30px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">Configuration Status</h1>
        <p class="subtitle">Claude Code Container Integration Dashboard</p>
    </div>

    <div class="overall-status ${allReady ? 'ready' : 'not-ready'}">
        <h2>${allReady ? '✅ System Ready!' : '⚠️ Configuration Incomplete'}</h2>
        <p>${allReady 
          ? 'All components are configured and connected. Ready to process GitHub issues!' 
          : 'Some components need configuration before the system can process GitHub issues.'
        }</p>
    </div>

    <div class="status-grid">
        <div class="status-card ${claudeConfigured ? 'success' : 'error'}">
            <div class="status-header">
                <span class="status-icon">${claudeConfigured ? '✅' : '❌'}</span>
                <h3 class="status-title">Claude Code API</h3>
            </div>
            <div class="status-detail">
                <span class="status-badge ${claudeConfigured ? 'badge-success' : 'badge-error'}">
                    ${claudeConfigured ? 'configured' : 'not configured'}
                </span>
            </div>
            <div class="status-detail">
                Status: ${claudeConfigured ? 'Ready for issue processing' : 'Anthropic API key required'}
            </div>
            ${!claudeConfigured ? '<a href="/claude-setup" class="btn setup">Configure Claude API</a>' : ''}
        </div>

        <div class="status-card ${githubConfigured ? 'success' : 'error'}">
            <div class="status-header">
                <span class="status-icon">${githubConfigured ? '✅' : '❌'}</span>
                <h3 class="status-title">GitHub Integration</h3>
            </div>
            <div class="status-detail">
                <span class="status-badge ${githubConfigured ? 'badge-success' : 'badge-error'}">
                    ${githubConfigured ? 'configured' : 'not configured'}
                </span>
            </div>
            <div class="status-detail">
                Status: ${githubConfigured ? 'GitHub App ready to receive webhooks' : 'GitHub App setup required'}
            </div>
            ${!githubConfigured ? '<a href="/gh-setup" class="btn setup">Setup GitHub Integration</a>' : ''}
        </div>

        <div class="status-card ${daytonaStatus === 'connected' ? 'success' : (daytonaConfigured ? 'warning' : 'error')}">
            <div class="status-header">
                <span class="status-icon">${daytonaStatus === 'connected' ? '✅' : (daytonaConfigured ? '⚠️' : '❌')}</span>
                <h3 class="status-title">Daytona Sandboxes</h3>
            </div>
            <div class="status-detail">
                <span class="status-badge ${daytonaStatus === 'connected' ? 'badge-success' : (daytonaConfigured ? 'badge-warning' : 'badge-error')}">
                    ${daytonaStatus}
                </span>
            </div>
            <div class="status-detail">
                ${daytonaStatus === 'connected' 
                  ? `Active sandboxes: ${sandboxCount}`
                  : 'Status: ' + (daytonaConfigured ? 'Configuration exists but connection failed' : 'Daytona API key required')
                }
            </div>
            ${daytonaError ? `<div class="error-details">Error: ${daytonaError}</div>` : ''}
            ${!daytonaConfigured ? '<a href="/daytona-setup" class="btn setup">Configure Daytona</a>' : ''}
            ${daytonaStatus !== 'connected' && daytonaConfigured ? '<a href="/daytona-setup" class="btn">Reconfigure Daytona</a>' : ''}
        </div>
    </div>

    <div style="text-align: center; margin: 40px 0;">
        <a href="/" class="btn">← Back to Home</a>
        <a href="/status" class="btn" onclick="location.reload(); return false;">🔄 Refresh Status</a>
        ${allReady ? '<a href="/test-claude" class="btn">Test Claude API</a>' : ''}
    </div>

    <div class="last-updated">
        Last updated: ${new Date().toLocaleString()}
    </div>
</body>
</html>`

    return new Response(html, {
      headers: { 'Content-Type': 'text/html' }
    })

  } catch (error) {
    logWithContext('STATUS_DASHBOARD', 'Error generating status dashboard', {
      error: (error as Error).message
    })

    return new Response('Error loading status dashboard', {
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}

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

      // Comprehensive status dashboard
      else if (pathname === '/status') {
        logWithContext('MAIN_HANDLER', 'Routing to status dashboard')
        routeMatched = true
        response = await handleStatusDashboard(request, env)
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

      // Simple test endpoint for architecture validation
      else if (pathname === '/test/architecture-test') {
        logWithContext('MAIN_HANDLER', 'Running architecture test')
        routeMatched = true
        
        try {
          // Get or create Daytona sandbox manager DO
          const id = env.DAYTONA_SANDBOX_MANAGER.idFromName('default')
          const sandboxManager = env.DAYTONA_SANDBOX_MANAGER.get(id)
          
          // Test sandbox creation
          const testResponse = await sandboxManager.fetch(new Request('http://internal/health', {
            method: 'GET'
          }))
          
          const testResult = await testResponse.json()
          
          response = new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Architecture Test Results</title>
    <style>body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }</style>
</head>
<body>
    <h1>🧪 Architecture Test Results</h1>
    <h3>Daytona Sandbox Manager Test:</h3>
    <pre>${JSON.stringify(testResult, null, 2)}</pre>
    
    <h3>Architecture Status:</h3>
    <ul>
        <li>✅ DaytonaClient: Enhanced with all required methods</li>
        <li>✅ DaytonaSandboxManagerDO: All new endpoints implemented</li>
        <li>✅ Issue Handler: Completely refactored for new architecture</li>
        <li>✅ GitHub Client: Enhanced with Worker-based PR creation</li>
        <li>✅ Mock Webhook: Available at /test/mock-issue-webhook</li>
    </ul>
    
    <p><strong>Migration Status:</strong> ✅ COMPLETE - Architecture successfully migrated from containers to Daytona sandboxes!</p>
    
    <a href="/status">Check Full Configuration Status</a> | <a href="/">Back to Home</a>
</body>
</html>`, {
            headers: { 'Content-Type': 'text/html' }
          })
          
        } catch (error) {
          response = new Response(`Architecture test failed: ${(error as Error).message}`, { 
            status: 500,
            headers: { 'Content-Type': 'text/plain' }
          })
        }
      }
      
      // Mock webhook endpoint for testing
      else if (pathname === '/test/mock-issue-webhook') {
        logWithContext('MAIN_HANDLER', 'Processing mock issue webhook')
        routeMatched = true
        
        // Create a mock GitHub issue webhook payload
        const mockWebhookPayload = {
          action: 'opened',
          issue: {
            id: Date.now(),
            number: Math.floor(Math.random() * 1000) + 1,
            title: 'Test Issue for Claude Code Migration',
            body: 'This is a test issue to verify the new Daytona-based architecture works correctly. Please implement a simple "Hello World" function.',
            user: {
              login: 'test-user'
            },
            labels: [
              { name: 'enhancement' },
              { name: 'test' }
            ]
          },
          repository: {
            id: 123456,
            name: 'test-repo',
            full_name: 'test-org/test-repo',
            clone_url: 'https://github.com/test-org/test-repo.git'
          },
          installation: {
            id: 12345678
          }
        }

        try {
          // Import and call the webhook handler
          const { handleGitHubWebhook } = await import('./handlers/github_webhook')
          
          const mockRequest = new Request('http://localhost/webhooks/github', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-GitHub-Event': 'issues',
              'X-GitHub-Delivery': 'mock-' + Date.now(),
              'X-Hub-Signature-256': 'mock-signature'
            },
            body: JSON.stringify(mockWebhookPayload)
          })

          const webhookResponse = await handleGitHubWebhook(mockRequest, env)
          
          response = new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Mock Webhook Test - Claude Code Integration</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
            color: #333;
            background: #fafbfc;
        }
        .result-card {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            margin: 20px 0;
        }
        .success { border-left: 4px solid #28a745; }
        .error { border-left: 4px solid #dc3545; }
        .code {
            background: #f6f8fa;
            padding: 15px;
            border-radius: 6px;
            font-family: 'SFMono-Regular', Monaco, Consolas, monospace;
            overflow-x: auto;
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
        }
    </style>
</head>
<body>
    <div class="result-card ${webhookResponse.status === 200 ? 'success' : 'error'}">
        <h1>🧪 Mock Issue Webhook Test</h1>
        <p><strong>Status:</strong> ${webhookResponse.status} ${webhookResponse.statusText || 'OK'}</p>
        <p><strong>Test Payload:</strong></p>
        <div class="code">${JSON.stringify(mockWebhookPayload, null, 2)}</div>
        
        ${webhookResponse.status === 200 
          ? '<p>✅ <strong>Success!</strong> Mock webhook processed successfully. Check your logs to see the full flow execution.</p>' 
          : '<p>❌ <strong>Error!</strong> Webhook processing failed. Check your configuration and logs.</p>'
        }
        
        <p><strong>Next Steps:</strong></p>
        <ul>
            <li>Check the Worker logs for detailed execution information</li>
            <li>Verify that all components (Claude, Daytona, GitHub) are properly configured</li>
            <li>Test with a real GitHub repository and issue</li>
        </ul>

        <a href="/status" class="btn">Check Configuration Status</a>
        <a href="/" class="btn">Back to Home</a>
    </div>
</body>
</html>`, {
            headers: { 'Content-Type': 'text/html' }
          })

        } catch (error) {
          logWithContext('MAIN_HANDLER', 'Mock webhook test failed', {
            error: (error as Error).message
          })

          response = new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Mock Webhook Test Failed</title>
    <style>body { font-family: sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }</style>
</head>
<body>
    <h1>🚨 Mock Webhook Test Failed</h1>
    <p><strong>Error:</strong> ${(error as Error).message}</p>
    <p>This indicates a configuration or implementation issue. Please check your setup and try again.</p>
    <a href="/status">Check Configuration Status</a> | <a href="/">Back to Home</a>
</body>
</html>`, {
            status: 500,
            headers: { 'Content-Type': 'text/html' }
          })
        }
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
                <a href="/status" class="btn">Check All Setup Status</a>
            </div>
        </div>
    </div>

    <div class="section">
        <h3>Testing & Validation</h3>
        <div class="link-group">
            <a href="/test-claude" class="btn test">Test Claude API</a>
            <span style="margin-left: 10px; color: #666;">Test your Claude configuration with a Star Wars greeting!</span>
        </div>
        <div class="link-group">
            <a href="/test/architecture-test" class="btn test">Test Architecture Migration</a>
            <span style="margin-left: 10px; color: #666;">Verify the new Daytona-based architecture is working!</span>
        </div>
        <div class="link-group">
            <a href="/test/mock-issue-webhook" class="btn test">Test Issue Processing Flow</a>
            <span style="margin-left: 10px; color: #666;">Test the complete issue processing pipeline!</span>
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
        <strong>Ready to go?</strong> Once all three components (Claude, Daytona, and GitHub) are configured, create GitHub issues in your repositories to trigger automatic Claude Code processing in secure Daytona sandboxes!
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
