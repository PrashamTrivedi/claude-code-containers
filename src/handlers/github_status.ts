import { getDecryptedGitHubCredentials, isGitHubAppConfigured, getGitHubConfigFromKV, isClaudeApiKeyConfigured } from "../kv_storage";
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
      lastChecked: new Date().toISOString(),
      ready: true && claudeConfigured
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