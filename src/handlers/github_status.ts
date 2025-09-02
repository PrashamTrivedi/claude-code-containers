import { getDecryptedGitHubCredentials, isGitHubAppConfigured, getGitHubConfigFromKV, isClaudeApiKeyConfigured } from "../kv_storage";
import { isDaytonaConfigured, getDaytonaCredentials } from "../handlers/daytona_setup";
import { DaytonaClient } from "../daytona_client";
import { logWithContext } from "../log";

export async function handleGitHubStatus(_request: Request, env: any): Promise<Response> {
  try {
    logWithContext('GITHUB_STATUS', 'Checking GitHub app status');
    
    const isConfigured = await isGitHubAppConfigured(env);
    if (!isConfigured) {
      logWithContext('GITHUB_STATUS', 'No GitHub app configuration found');
      return new Response(JSON.stringify({ 
        configured: false,
        error: 'No GitHub app configuration found' 
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 404
      });
    }

    const credentials = await getDecryptedGitHubCredentials(env);
    
    if (!credentials) {
      logWithContext('GITHUB_STATUS', 'Could not retrieve GitHub configuration');
      return new Response(JSON.stringify({ 
        configured: false,
        error: 'Could not retrieve configuration details' 
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 500
      });
    }

    // Check Claude API key configuration
    const claudeConfigured = await isClaudeApiKeyConfigured(env);

    // Check Daytona configuration and connection
    const daytonaConfigured = await isDaytonaConfigured(env);
    let daytonaStatus = 'not configured';
    let sandboxCount = 0;
    
    if (daytonaConfigured) {
      try {
        const daytonaCredentials = await getDaytonaCredentials(env);
        if (daytonaCredentials) {
          const daytonaClient = new DaytonaClient(daytonaCredentials.apiKey, daytonaCredentials.apiUrl);
          const isHealthy = await daytonaClient.healthCheck();
          
          if (isHealthy) {
            daytonaStatus = 'connected';
            try {
              const sandboxes = await daytonaClient.listSandboxes();
              sandboxCount = sandboxes.length;
            } catch {
              // If we can't list sandboxes, we're still connected but can't get count
              sandboxCount = 0;
            }
          } else {
            daytonaStatus = 'connection failed';
          }
        }
      } catch (error) {
        logWithContext('GITHUB_STATUS', 'Error checking Daytona status', {
          error: (error as Error).message
        });
        const errorMessage = (error as Error).message;
        if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
          daytonaStatus = 'invalid credentials';
        } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
          daytonaStatus = 'access denied';
        } else if (errorMessage.includes('429') || errorMessage.includes('quota')) {
          daytonaStatus = 'quota exceeded';
        } else {
          daytonaStatus = 'connection error';
        }
      }
    }

    const allConfigured = claudeConfigured && daytonaConfigured;

    const status = {
      configured: true,
      appId: credentials.appId,
      storage: 'KV',
      hasPrivateKey: !!credentials.privateKey,
      hasWebhookSecret: !!credentials.webhookSecret,
      credentialFormat: 'KV Storage (app_id, private_key, webhook_secret)',
      claudeApiKey: {
        configured: claudeConfigured,
        status: claudeConfigured ? 'ready' : 'not configured'
      },
      daytona: {
        configured: daytonaConfigured,
        status: daytonaStatus,
        activeSandboxes: sandboxCount
      },
      lastChecked: new Date().toISOString(),
      ready: allConfigured && daytonaStatus === 'connected'
    };

    logWithContext('GITHUB_STATUS', 'GitHub app status retrieved successfully', {
      appId: credentials.appId,
      storage: 'KV'
    });

    return new Response(JSON.stringify(status, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    logWithContext('GITHUB_STATUS', 'Error fetching GitHub status', {
      error: error instanceof Error ? error.message : String(error)
    });
    return new Response(JSON.stringify({ 
      configured: false,
      error: 'Internal server error' 
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    });
  }
}