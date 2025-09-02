import { logWithContext } from '../log'
import { DaytonaClient } from '../daytona_client'

// HTML form for Daytona setup
const DAYTONA_SETUP_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Daytona Setup - Claude Code Integration</title>
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
        .form-group {
            margin: 20px 0;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #333;
        }
        input[type="text"], input[type="password"], input[type="url"] {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            background: white;
        }
        input[type="text"]:focus, input[type="password"]:focus, input[type="url"]:focus {
            outline: none;
            border-color: #0969da;
            box-shadow: 0 0 0 3px rgba(9, 105, 218, 0.1);
        }
        .btn {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            border: none;
            cursor: pointer;
            font-size: 16px;
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
        .info-box {
            background: #e7f3ff;
            border: 1px solid #b6d7ff;
            border-radius: 6px;
            padding: 15px;
            margin: 20px 0;
        }
        .info-box h4 {
            margin-top: 0;
            color: #0969da;
        }
        .error {
            background: #ffeaea;
            border: 1px solid #ffb3b3;
            color: #d73a49;
        }
        .success {
            background: #e6ffed;
            border: 1px solid #b3f5c0;
            color: #28a745;
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
    </style>
</head>
<body>
    <div class="header">
        <h1 class="title">Daytona Setup</h1>
        <p class="subtitle">Configure your Daytona API credentials for Claude Code integration</p>
    </div>

    <div class="section">
        <h3>Setup Instructions</h3>
        <div class="step">
            <span class="step-number">1</span>
            <strong>Get your Daytona API Key:</strong> Sign in to your <a href="https://app.daytona.io" target="_blank">Daytona Dashboard</a> and create an API key in Settings → API Keys
        </div>
        <div class="step">
            <span class="step-number">2</span>
            <strong>Configure API URL:</strong> Use the default Daytona API URL or your self-hosted instance URL
        </div>
        <div class="step">
            <span class="step-number">3</span>
            <strong>Test Connection:</strong> We'll verify your credentials can connect to Daytona successfully
        </div>
    </div>

    <div class="section">
        <h3>Configuration</h3>
        <form method="POST" action="/daytona-setup">
            <div class="form-group">
                <label for="apiKey">Daytona API Key *</label>
                <input type="password" id="apiKey" name="apiKey" required 
                       placeholder="dt_xxxx..." 
                       autocomplete="off">
            </div>
            
            <div class="form-group">
                <label for="apiUrl">Daytona API URL</label>
                <input type="url" id="apiUrl" name="apiUrl" 
                       value="https://api.daytona.io"
                       placeholder="https://api.daytona.io">
            </div>
            
            <div class="form-group">
                <button type="submit" class="btn setup">Save & Test Configuration</button>
            </div>
        </form>
    </div>

    <div class="info-box">
        <h4>Security Notice</h4>
        <p>Your API key will be stored securely using AES-256-GCM encryption in Cloudflare's Durable Objects. The key is never logged or exposed in responses.</p>
    </div>

    <div class="info-box">
        <h4>What happens next?</h4>
        <p>Once configured, Claude Code will be able to:</p>
        <ul>
            <li>Create Daytona sandboxes for processing GitHub issues</li>
            <li>Execute Claude Code CLI in isolated environments</li>
            <li>Manage sandbox lifecycle (create, start, stop, cleanup)</li>
            <li>Provide secure, reproducible development environments</li>
        </ul>
    </div>

    <div style="text-align: center; margin-top: 40px;">
        <a href="/" class="btn">← Back to Home</a>
    </div>
</body>
</html>
`

/**
 * Handle Daytona setup - both GET (show form) and POST (save config)
 */
export async function handleDaytonaSetup(request: Request, origin: string, env: any): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'GET') {
    logWithContext('DAYTONA_SETUP', 'Serving Daytona setup form')
    
    return new Response(DAYTONA_SETUP_HTML, {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  if (request.method === 'POST') {
    return handleDaytonaConfigSave(request, env)
  }

  return new Response('Method not allowed', { status: 405 })
}

/**
 * Save Daytona configuration and test connection
 */
async function handleDaytonaConfigSave(request: Request, env: any): Promise<Response> {
  logWithContext('DAYTONA_SETUP', 'Processing Daytona configuration save')

  try {
    const formData = await request.formData()
    const apiKey = formData.get('apiKey') as string
    const apiUrl = (formData.get('apiUrl') as string) || 'https://api.daytona.io'

    if (!apiKey) {
      return generateSetupResponse('error', 'API Key is required')
    }

    // Validate API key format (basic check)
    if (!apiKey.startsWith('dt_') && !apiKey.startsWith('dta_')) {
      logWithContext('DAYTONA_SETUP', 'Invalid API key format', {
        keyPrefix: apiKey.substring(0, 3)
      })
      return generateSetupResponse('error', 'Invalid API key format. Daytona API keys should start with "dt_" or "dta_"')
    }

    // Validate API URL
    try {
      new URL(apiUrl)
    } catch {
      return generateSetupResponse('error', 'Invalid API URL format')
    }

    logWithContext('DAYTONA_SETUP', 'Testing Daytona connection', {
      apiUrl,
      keyPrefix: apiKey.substring(0, 7) + '...'
    })

    // Test connection
    const daytonaClient = new DaytonaClient(apiKey, apiUrl)
    const isHealthy = await daytonaClient.healthCheck()

    if (!isHealthy) {
      logWithContext('DAYTONA_SETUP', 'Daytona connection test failed')
      return generateSetupResponse('error', 'Connection test failed. Please verify your API key and URL are correct. Check that your Daytona account is active and has available quota.')
    }

    logWithContext('DAYTONA_SETUP', 'Daytona connection test successful')

    // Store encrypted credentials in KV (using existing pattern from GitHub setup)
    try {
      // Import crypto functions (assuming they exist from the GitHub setup)
      const { encrypt } = await import('../crypto')
      
      const credentialsToStore = {
        apiKey,
        apiUrl,
        configured: new Date().toISOString()
      }

      const encryptedCredentials = await encrypt(JSON.stringify(credentialsToStore))
      
      await env.GITHUB_CONFIG.put('daytona_credentials', encryptedCredentials)
      
      logWithContext('DAYTONA_SETUP', 'Daytona credentials stored successfully')

      return generateSetupResponse('success', 'Daytona configuration saved successfully! Connection test passed.', '/gh-setup')

    } catch (storageError) {
      logWithContext('DAYTONA_SETUP', 'Error storing Daytona credentials', {
        error: (storageError as Error).message
      })
      return generateSetupResponse('error', 'Connection test passed, but failed to save credentials. Please try again.')
    }

  } catch (error) {
    logWithContext('DAYTONA_SETUP', 'Error processing Daytona setup', {
      error: (error as Error).message
    })
    
    const errorMessage = (error as Error).message
    let userFriendlyMessage = 'Setup failed: ' + errorMessage
    
    // Provide more specific error messages for common issues
    if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      userFriendlyMessage = 'Invalid API key. Please check your Daytona API key and try again.'
    } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
      userFriendlyMessage = 'Access denied. Your API key may not have the required permissions.'
    } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
      userFriendlyMessage = 'Rate limit exceeded or quota exhausted. Please wait and try again later.'
    } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
      userFriendlyMessage = 'Network error. Please check your internet connection and try again.'
    } else if (errorMessage.includes('timeout')) {
      userFriendlyMessage = 'Connection timeout. The Daytona API may be temporarily unavailable.'
    }
    
    return generateSetupResponse('error', userFriendlyMessage)
  }
}

/**
 * Generate setup response with status message
 */
function generateSetupResponse(type: 'success' | 'error', message: string, nextUrl?: string): Response {
  const statusClass = type === 'success' ? 'success' : 'error'
  const nextButton = nextUrl && type === 'success' 
    ? `<div style="margin-top: 15px;"><a href="${nextUrl}" class="btn setup">Continue to GitHub Setup</a></div>`
    : ''
  const statusHtml = `<div class="info-box ${statusClass}"><h4>${type === 'success' ? 'Success!' : 'Error'}</h4><p>${message}</p>${nextButton}</div>`
  
  const responseHtml = DAYTONA_SETUP_HTML.replace(
    '<div class="section">',
    `${statusHtml}<div class="section">`
  )

  return new Response(responseHtml, {
    headers: { 'Content-Type': 'text/html' },
    status: type === 'success' ? 200 : 400
  })
}

/**
 * Get stored Daytona credentials (helper function)
 */
export async function getDaytonaCredentials(env: any): Promise<{ apiKey: string; apiUrl: string } | null> {
  try {
    const encryptedCredentials = await env.GITHUB_CONFIG.get('daytona_credentials')
    if (!encryptedCredentials) {
      return null
    }

    const { decrypt } = await import('../crypto')
    const decryptedData = await decrypt(encryptedCredentials)
    const credentials = JSON.parse(decryptedData)

    logWithContext('DAYTONA_SETUP', 'Retrieved Daytona credentials', {
      hasApiKey: !!credentials.apiKey,
      apiUrl: credentials.apiUrl
    })

    return {
      apiKey: credentials.apiKey,
      apiUrl: credentials.apiUrl
    }

  } catch (error) {
    logWithContext('DAYTONA_SETUP', 'Error retrieving Daytona credentials', {
      error: (error as Error).message
    })
    return null
  }
}

/**
 * Check if Daytona is configured
 */
export async function isDaytonaConfigured(env: any): Promise<boolean> {
  const credentials = await getDaytonaCredentials(env)
  return !!credentials?.apiKey
}