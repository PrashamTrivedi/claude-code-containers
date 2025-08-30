import { logWithContext } from "./log";
import { generateInstallationToken as generateInstallationTokenFromJWT } from './crypto';

export interface KVGitHubConfig {
  app_id: string;
  private_key: string;
  webhook_secret: string;
}

export interface DecryptedGitHubCredentials {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

/**
 * Get GitHub app configuration from KV storage
 */
export async function getGitHubConfigFromKV(env: any): Promise<KVGitHubConfig | null> {
  try {
    logWithContext('KV_STORAGE', 'Retrieving GitHub config from KV');
    
    const configJson = await env.GITHUB_CONFIG.get('github_config');
    
    if (!configJson) {
      logWithContext('KV_STORAGE', 'No GitHub config found in KV');
      return null;
    }

    const config = JSON.parse(configJson) as KVGitHubConfig;
    
    logWithContext('KV_STORAGE', 'GitHub config retrieved from KV', {
      appId: config.app_id,
      hasPrivateKey: !!config.private_key,
      hasWebhookSecret: !!config.webhook_secret
    });

    return config;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error retrieving GitHub config from KV', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Store GitHub app configuration in KV storage
 */
export async function storeGitHubConfigInKV(env: any, config: KVGitHubConfig): Promise<boolean> {
  try {
    logWithContext('KV_STORAGE', 'Storing GitHub config in KV', {
      appId: config.app_id,
      hasPrivateKey: !!config.private_key,
      hasWebhookSecret: !!config.webhook_secret
    });

    await env.GITHUB_CONFIG.put('github_config', JSON.stringify(config));
    
    logWithContext('KV_STORAGE', 'GitHub config stored successfully in KV');
    return true;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error storing GitHub config in KV', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Get decrypted GitHub credentials from KV storage
 */
export async function getDecryptedGitHubCredentials(env: any): Promise<DecryptedGitHubCredentials | null> {
  const config = await getGitHubConfigFromKV(env);
  
  if (!config) {
    return null;
  }

  try {
    logWithContext('KV_STORAGE', 'Reading GitHub credentials from KV (stored as plain text)');

    // Keys are stored as plain text, not encrypted
    const credentials: DecryptedGitHubCredentials = {
      appId: config.app_id,
      privateKey: config.private_key,
      webhookSecret: config.webhook_secret
    };

    logWithContext('KV_STORAGE', 'GitHub credentials retrieved successfully');
    return credentials;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error reading GitHub credentials from KV', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Store GitHub app credentials in KV storage (as plain text to match existing format)
 */
export async function storeEncryptedGitHubCredentials(
  env: any, 
  appId: string, 
  privateKey: string, 
  webhookSecret: string
): Promise<boolean> {
  try {
    logWithContext('KV_STORAGE', 'Storing GitHub credentials in KV (plain text format)');

    const config: KVGitHubConfig = {
      app_id: appId,
      private_key: privateKey,
      webhook_secret: webhookSecret
    };

    return await storeGitHubConfigInKV(env, config);
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error storing GitHub credentials', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Update installation information in KV storage
 * Note: Since KV only stores core app credentials, installation info is managed separately
 */
export async function updateInstallationInKV(
  _env: any, 
  installationId: string,
  owner?: {
    login: string;
    type: "User" | "Organization";
    id: number;
  }
): Promise<boolean> {
  logWithContext('KV_STORAGE', 'Installation update not implemented for simple KV storage', {
    installationId,
    owner: owner?.login
  });
  // For now, just acknowledge the installation update
  // In a full implementation, this might be stored in a separate KV key
  return true;
}

/**
 * Check if GitHub app is configured in KV storage
 */
export async function isGitHubAppConfigured(env: any): Promise<boolean> {
  const config = await getGitHubConfigFromKV(env);
  return config !== null && !!config.app_id && !!config.private_key && !!config.webhook_secret;
}

/**
 * Get cached installation ID for a repository
 */
export async function getInstallationIdForRepository(env: any, owner: string, repo: string): Promise<string | null> {
  try {
    const key = `installation:${owner}/${repo}`;
    logWithContext('KV_STORAGE', 'Retrieving cached installation ID', { owner, repo, key });
    
    const cachedId = await env.GITHUB_CONFIG.get(key);
    
    if (cachedId) {
      logWithContext('KV_STORAGE', 'Installation ID found in cache', { owner, repo, installationId: cachedId });
      return cachedId;
    }
    
    logWithContext('KV_STORAGE', 'No cached installation ID found', { owner, repo });
    return null;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error retrieving cached installation ID', {
      owner,
      repo,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Cache installation ID for a repository with 7-day TTL
 */
export async function storeInstallationIdForRepository(
  env: any, 
  owner: string, 
  repo: string, 
  installationId: string
): Promise<boolean> {
  try {
    const key = `installation:${owner}/${repo}`;
    const ttlSeconds = 7 * 24 * 60 * 60; // 7 days
    
    logWithContext('KV_STORAGE', 'Storing installation ID in cache', {
      owner,
      repo,
      installationId,
      key,
      ttlDays: 7
    });
    
    await env.GITHUB_CONFIG.put(key, installationId, { expirationTtl: ttlSeconds });
    
    logWithContext('KV_STORAGE', 'Installation ID cached successfully', { owner, repo, installationId });
    return true;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error storing installation ID in cache', {
      owner,
      repo,
      installationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Generate GitHub installation token using app credentials from KV
 */
export async function generateInstallationToken(env: any, installationId: string): Promise<string | null> {
  const credentials = await getDecryptedGitHubCredentials(env);
  if (!credentials) {
    logWithContext('KV_STORAGE', 'Cannot generate installation token - no credentials found');
    return null;
  }

  try {
    logWithContext('KV_STORAGE', 'Generating JWT for GitHub App', {
      appId: credentials.appId,
      installationId
    });

    const tokenData = await generateInstallationTokenFromJWT(
      credentials.appId,
      credentials.privateKey,
      installationId
    );

    if (tokenData && tokenData.token) {
      logWithContext('KV_STORAGE', 'Installation token generated successfully', {
        expiresAt: tokenData.expires_at
      });
      return tokenData.token;
    }

    logWithContext('KV_STORAGE', 'Failed to generate installation token');
    return null;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error generating installation token', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}