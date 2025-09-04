import {logWithContext} from "../log"
import {handleInstallationEvent, handleInstallationRepositoriesEvent, handleIssuesEvent} from "./github_webhooks"
import {getDecryptedGitHubCredentials, isGitHubAppConfigured} from "../kv_storage"

// Route webhook events to specific handlers
async function routeWebhookEvent(event: string, data: any, env: any): Promise<Response> {
  const routingStartTime = Date.now()

  logWithContext('EVENT_ROUTER', 'Starting webhook event routing', {
    event,
    action: data.action,
    repository: data.repository?.full_name,
    installationId: data.installation?.id,
    senderId: data.sender?.id
  })

  try {
    let response: Response

    switch (event) {
      case 'installation':
        logWithContext('EVENT_ROUTER', 'Routing to installation handler')
        response = await handleInstallationEvent(data, env)
        break

      case 'installation_repositories':
        logWithContext('EVENT_ROUTER', 'Routing to installation_repositories handler')
        response = await handleInstallationRepositoriesEvent(data, env)
        break

      case 'issues':
        logWithContext('EVENT_ROUTER', 'Routing to issues handler')
        response = await handleIssuesEvent(data, env)
        break

      default:
        logWithContext('EVENT_ROUTER', 'Unhandled webhook event - acknowledging', {
          event,
          availableEvents: ['installation', 'installation_repositories', 'issues']
        })
        response = new Response('Event acknowledged', {status: 200})
    }

    const routingTime = Date.now() - routingStartTime
    logWithContext('EVENT_ROUTER', 'Event routing completed', {
      event,
      routingTimeMs: routingTime,
      responseStatus: response.status,
      responseStatusText: response.statusText
    })

    return response
  } catch (error) {
    const routingTime = Date.now() - routingStartTime
    logWithContext('EVENT_ROUTER', 'ERROR: Event routing failed', {
      event,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      routingTimeMs: routingTime
    })
    return new Response('Event handler error', {status: 500})
  }
}

// HMAC-SHA256 signature verification for GitHub webhooks
async function verifyGitHubSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  logWithContext('SIGNATURE_VERIFY', 'Starting signature verification', {
    hasSignature: !!signature,
    signatureFormat: signature ? (signature.startsWith('sha256=') ? 'valid_format' : 'invalid_format') : 'missing',
    hasSecret: !!secret,
    secretLength: secret ? secret.length : 0,
    payloadLength: payload.length,
    // Debug secret encoding issues
    secretHasWhitespace: secret ? /\s/.test(secret) : false,
    secretHasNewlines: secret ? secret.includes('\n') || secret.includes('\r') : false,
    secretFirstChar: secret ? secret.charCodeAt(0) : null,
    secretLastChar: secret ? secret.charCodeAt(secret.length - 1) : null
  })

  if (!signature || !signature.startsWith('sha256=')) {
    logWithContext('SIGNATURE_VERIFY', 'Invalid signature format or missing signature', {
      signature: signature ? signature.substring(0, 20) + '...' : 'null',
      hasSecret: !!secret
    })
    return false
  }

  const sigHex = signature.replace('sha256=', '')
  logWithContext('SIGNATURE_VERIFY', 'Extracted signature hex', {
    sigHexLength: sigHex.length,
    sigHexPrefix: sigHex.substring(0, 8) + '...'
  })

  try {
    // Clean the secret - remove any whitespace/newlines that might cause issues
    const cleanSecret = secret.trim()

    logWithContext('SIGNATURE_VERIFY', 'Secret cleaning analysis', {
      originalLength: secret.length,
      cleanedLength: cleanSecret.length,
      wasModified: secret !== cleanSecret,
      originalFirstChar: secret.charCodeAt(0),
      cleanedFirstChar: cleanSecret.charCodeAt(0),
      originalLastChar: secret.charCodeAt(secret.length - 1),
      cleanedLastChar: cleanSecret.charCodeAt(cleanSecret.length - 1)
    })

    // Create HMAC-SHA256 hash using cleaned secret
    logWithContext('SIGNATURE_VERIFY', 'Creating HMAC key with cleaned secret')
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(cleanSecret),
      {name: 'HMAC', hash: 'SHA-256'},
      false,
      ['sign']
    )

    logWithContext('SIGNATURE_VERIFY', 'Computing HMAC signature')
    const messageBuffer = new TextEncoder().encode(payload)
    const hashBuffer = await crypto.subtle.sign('HMAC', key, messageBuffer)
    const hashArray = new Uint8Array(hashBuffer)
    const computedHex = Array.from(hashArray)
      .map(byte => byte.toString(16).padStart(2, '0'))
      .join('')

    logWithContext('SIGNATURE_VERIFY', 'Computed signature', {
      computedHexLength: computedHex.length,
      computedHexPrefix: computedHex.substring(0, 8) + '...',
      expectedHexPrefix: sigHex.substring(0, 8) + '...',
      signaturesMatch: sigHex === computedHex
    })

    // Constant-time comparison
    const isValid = sigHex === computedHex

    if (!isValid) {
      logWithContext('SIGNATURE_VERIFY', 'SIGNATURE MISMATCH - WEBHOOK AUTHENTICATION FAILED', {
        expectedSignature: sigHex.substring(0, 16) + '...',
        computedSignature: computedHex.substring(0, 16) + '...',
        secretUsed: cleanSecret.substring(0, 8) + '...',
        payloadPreview: payload.substring(0, 100) + '...',
        // Additional debugging info
        fullExpectedSig: sigHex,
        fullComputedSig: computedHex,
        originalSecretUsed: secret === cleanSecret ? 'same_as_cleaned' : 'different_from_cleaned',
        payloadHashForDebug: await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)).then(buf =>
          Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16)
        )
      })
    }

    return isValid
  } catch (error) {
    logWithContext('SIGNATURE_VERIFY', 'Error during signature verification', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return false
  }
}

// Main webhook processing handler
export async function handleGitHubWebhook(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
  const startTime = Date.now()

  try {
    // Get webhook payload and headers
    const payload = await request.text()
    const signature = request.headers.get('x-hub-signature-256')
    const event = request.headers.get('x-github-event')
    const delivery = request.headers.get('x-github-delivery')

    logWithContext('WEBHOOK', 'Received GitHub webhook', {
      event,
      delivery,
      hasSignature: !!signature,
      payloadSize: payload.length,
      headers: {
        userAgent: request.headers.get('user-agent'),
        contentType: request.headers.get('content-type')
      },
      request
    })

    if (!signature || !event || !delivery) {
      logWithContext('WEBHOOK', 'Missing required webhook headers', {
        hasSignature: !!signature,
        hasEvent: !!event,
        hasDelivery: !!delivery
      })
      return new Response('Missing required headers', {status: 400})
    }

    // Parse the payload to get app/installation info
    let webhookData
    try {
      webhookData = JSON.parse(payload)
      logWithContext('WEBHOOK', 'Webhook payload parsed successfully', {
        hasInstallation: !!webhookData.installation,
        hasRepository: !!webhookData.repository,
        action: webhookData.action
      })
    } catch (error) {
      logWithContext('WEBHOOK', 'Invalid JSON payload', {
        error: error instanceof Error ? error.message : String(error),
        payloadPreview: payload.substring(0, 200)
      })
      return new Response('Invalid JSON payload', {status: 400})
    }

    // Handle ping webhooks early - they don't need installation info or signature verification
    if (event === 'ping') {
      logWithContext('WEBHOOK', 'Received ping webhook', {
        zen: webhookData.zen,
        hookId: webhookData.hook_id
      })
      return new Response(JSON.stringify({
        message: 'Webhook endpoint is active',
        zen: webhookData.zen
      }), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
      })
    }

    // Check if GitHub app is configured in KV
    logWithContext('WEBHOOK', 'Step 1: Checking GitHub app configuration in KV')

    const isConfigured = await isGitHubAppConfigured(env)
    if (!isConfigured) {
      logWithContext('WEBHOOK', 'CRITICAL ERROR: No GitHub app configuration found in KV - Setup required')
      return new Response('App not configured', {status: 404})
    }
    logWithContext('WEBHOOK', 'Step 1 COMPLETE: GitHub app is configured in KV')

    // Get app configuration and decrypt webhook secret from KV
    logWithContext('WEBHOOK', 'Step 2: Retrieving app configuration from KV')

    const credentials = await getDecryptedGitHubCredentials(env)

    if (!credentials || !credentials.webhookSecret) {
      logWithContext('WEBHOOK', 'CRITICAL ERROR: No app credentials or webhook secret found', {
        hasCredentials: !!credentials,
        hasWebhookSecret: !!(credentials?.webhookSecret),
        credentialsKeys: credentials ? Object.keys(credentials) : []
      })
      return new Response('App not configured', {status: 404})
    }

    logWithContext('WEBHOOK', 'Step 2 COMPLETE: App credentials retrieved from KV', {
      appId: credentials.appId,
      hasWebhookSecret: !!credentials.webhookSecret,
      webhookSecretLength: credentials.webhookSecret.length,
      webhookSecretPrefix: credentials.webhookSecret.substring(0, 8) + '...'
    })

    // Verify the webhook signature
    logWithContext('WEBHOOK', 'Step 3: Starting webhook signature verification')

    const isValid = await verifyGitHubSignature(payload, signature, credentials.webhookSecret)

    if (!isValid) {
      logWithContext('WEBHOOK', 'AUTHENTICATION FAILURE: Invalid webhook signature - IMMEDIATE REJECTION', {
        signatureReceived: signature.substring(0, 25) + '...',
        delivery,
        appId: credentials.appId,
        secretUsed: credentials.webhookSecret.substring(0, 8) + '...',
        processingTimeMs: Date.now() - startTime
      })
      return new Response('Invalid signature', {status: 401})
    }

    logWithContext('WEBHOOK', 'Step 3 COMPLETE: Webhook signature verified successfully')

    // Route to appropriate event handler
    logWithContext('WEBHOOK', 'Step 4: Starting event routing', {
      event,
      action: webhookData.action,
      repository: webhookData.repository?.full_name,
      processingTimeMs: Date.now() - startTime
    })

    // Use ctx.waitUntil() to process webhook asynchronously to avoid timeout
    const processingPromise = routeWebhookEvent(event, webhookData, env)
      .then((eventResponse) => {
        const processingTime = Date.now() - startTime
        logWithContext('WEBHOOK', 'Step 4 COMPLETE: Webhook processing completed successfully', {
          event,
          delivery,
          processingTimeMs: processingTime,
          responseStatus: eventResponse.status,
          responseStatusText: eventResponse.statusText
        })
        return eventResponse
      })
      .catch((error) => {
        const processingTime = Date.now() - startTime
        logWithContext('WEBHOOK', 'ASYNC ERROR: Webhook processing failed in background', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          event,
          delivery,
          processingTimeMs: processingTime
        })
      })

    // Let the processing continue in the background
    ctx.waitUntil(processingPromise)

    // Return immediate acknowledgment to GitHub
    logWithContext('WEBHOOK', 'Webhook acknowledged - processing continues in background', {
      event,
      delivery,
      acknowledgmentTimeMs: Date.now() - startTime
    })

    return new Response('Webhook received and processing started', { 
      status: 202,  // 202 Accepted
      headers: {
        'Content-Type': 'text/plain'
      }
    })

  } catch (error) {
    const processingTime = Date.now() - startTime
    logWithContext('WEBHOOK', 'CRITICAL ERROR: Webhook processing failed with exception', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs: processingTime,
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      timestamp: new Date().toISOString()
    })
    return new Response('Internal server error', {status: 500})
  }
}