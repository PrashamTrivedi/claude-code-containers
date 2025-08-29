import { logWithContext } from "./log";
import { decrypt, encrypt } from "./crypto";

export interface KVGitHubConfig {
  app_id: string;
  private_key: string;
  webhook_secret: string;
  installation_id?: string;
  name?: string;
  html_url?: string;
  owner?: {
    login: string;
    type: "User" | "Organization";
    id: number;
  };
}

export interface DecryptedGitHubCredentials {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  installationId?: string;
  name?: string;
  htmlUrl?: string;
  owner?: {
    login: string;
    type: "User" | "Organization";
    id: number;
  };
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
      hasWebhookSecret: !!config.webhook_secret,
      hasInstallationId: !!config.installation_id
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
    logWithContext('KV_STORAGE', 'Decrypting GitHub credentials from KV');

    const privateKey = await decrypt(config.private_key);
    const webhookSecret = await decrypt(config.webhook_secret);

    const credentials: DecryptedGitHubCredentials = {
      appId: config.app_id,
      privateKey,
      webhookSecret,
      installationId: config.installation_id,
      name: config.name,
      htmlUrl: config.html_url,
      owner: config.owner
    };

    logWithContext('KV_STORAGE', 'GitHub credentials decrypted successfully');
    return credentials;
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error decrypting GitHub credentials from KV', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Store encrypted GitHub app credentials in KV storage
 */
export async function storeEncryptedGitHubCredentials(
  env: any, 
  appId: string, 
  privateKey: string, 
  webhookSecret: string,
  additionalData?: {
    installationId?: string;
    name?: string;
    htmlUrl?: string;
    owner?: {
      login: string;
      type: "User" | "Organization";
      id: number;
    };
  }
): Promise<boolean> {
  try {
    logWithContext('KV_STORAGE', 'Encrypting and storing GitHub credentials');

    const encryptedPrivateKey = await encrypt(privateKey);
    const encryptedWebhookSecret = await encrypt(webhookSecret);

    const config: KVGitHubConfig = {
      app_id: appId,
      private_key: encryptedPrivateKey,
      webhook_secret: encryptedWebhookSecret,
      ...additionalData
    };

    return await storeGitHubConfigInKV(env, config);
  } catch (error) {
    logWithContext('KV_STORAGE', 'Error encrypting and storing GitHub credentials', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

/**
 * Update installation information in KV storage
 */
export async function updateInstallationInKV(
  env: any, 
  installationId: string,
  owner?: {
    login: string;
    type: "User" | "Organization";
    id: number;
  }
): Promise<boolean> {
  const config = await getGitHubConfigFromKV(env);
  
  if (!config) {
    logWithContext('KV_STORAGE', 'Cannot update installation - no config found in KV');
    return false;
  }

  config.installation_id = installationId;
  if (owner) {
    config.owner = owner;
  }

  return await storeGitHubConfigInKV(env, config);
}

/**
 * Check if GitHub app is configured in KV storage
 */
export async function isGitHubAppConfigured(env: any): Promise<boolean> {
  const config = await getGitHubConfigFromKV(env);
  return config !== null && !!config.app_id && !!config.private_key && !!config.webhook_secret;
}