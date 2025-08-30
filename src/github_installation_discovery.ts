import { generateAppJWT } from './crypto';
import { getDecryptedGitHubCredentials, getInstallationIdForRepository, storeInstallationIdForRepository } from './kv_storage';
import { logWithContext } from './log';

export interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    id: number;
    type: "User" | "Organization";
  };
  permissions: Record<string, string>;
  events: string[];
  created_at: string;
  updated_at: string;
  single_file_name?: string;
  has_multiple_single_files?: boolean;
  single_file_paths?: string[];
  app_id: number;
  target_id: number;
  target_type: "User" | "Organization";
  suspended_by?: any;
  suspended_at?: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  owner: {
    login: string;
    id: number;
    type: "User" | "Organization";
  };
  private: boolean;
  permissions: {
    admin: boolean;
    maintain: boolean;
    push: boolean;
    triage: boolean;
    pull: boolean;
  };
}

/**
 * Lists all GitHub App installations using JWT authentication
 */
export async function listAllInstallations(env: any): Promise<GitHubInstallation[]> {
  logWithContext('INSTALLATION_DISCOVERY', 'Starting installation discovery');

  try {
    // Get GitHub App credentials from KV
    const credentials = await getDecryptedGitHubCredentials(env);
    if (!credentials) {
      logWithContext('INSTALLATION_DISCOVERY', 'No GitHub credentials found in KV');
      return [];
    }

    // Generate App JWT token
    const appJWT = await generateAppJWT(credentials.appId, credentials.privateKey);
    
    logWithContext('INSTALLATION_DISCOVERY', 'Generated App JWT, fetching installations', {
      appId: credentials.appId
    });

    // Call GitHub API to list installations
    const response = await fetch('https://api.github.com/app/installations', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${appJWT}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Worker-GitHub-Integration'
      }
    });

    logWithContext('INSTALLATION_DISCOVERY', 'GitHub installations API response', {
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text();
      logWithContext('INSTALLATION_DISCOVERY', 'Failed to fetch installations', {
        status: response.status,
        error: errorText
      });
      return [];
    }

    const installations = await response.json() as GitHubInstallation[];
    
    logWithContext('INSTALLATION_DISCOVERY', 'Installations retrieved successfully', {
      count: installations.length,
      installations: installations.map(inst => ({
        id: inst.id,
        account: inst.account.login,
        type: inst.account.type
      }))
    });

    return installations;
  } catch (error) {
    logWithContext('INSTALLATION_DISCOVERY', 'Error listing installations', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return [];
  }
}

/**
 * Get repositories accessible to a specific installation
 */
async function getInstallationRepositories(env: any, installationId: string): Promise<GitHubRepository[]> {
  logWithContext('INSTALLATION_DISCOVERY', 'Fetching repositories for installation', {
    installationId
  });

  try {
    // Get GitHub App credentials from KV
    const credentials = await getDecryptedGitHubCredentials(env);
    if (!credentials) {
      logWithContext('INSTALLATION_DISCOVERY', 'No GitHub credentials found in KV');
      return [];
    }

    // Generate App JWT token
    const appJWT = await generateAppJWT(credentials.appId, credentials.privateKey);

    // Call GitHub API to list installation repositories
    const response = await fetch(`https://api.github.com/app/installations/${installationId}/repositories`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${appJWT}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Worker-GitHub-Integration'
      }
    });

    logWithContext('INSTALLATION_DISCOVERY', 'Installation repositories API response', {
      installationId,
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text();
      logWithContext('INSTALLATION_DISCOVERY', 'Failed to fetch installation repositories', {
        installationId,
        status: response.status,
        error: errorText
      });
      return [];
    }

    const data = await response.json() as { repositories: GitHubRepository[] };
    const repositories = data.repositories || [];

    logWithContext('INSTALLATION_DISCOVERY', 'Installation repositories retrieved', {
      installationId,
      count: repositories.length,
      repositories: repositories.map(repo => ({
        name: repo.full_name,
        private: repo.private
      }))
    });

    return repositories;
  } catch (error) {
    logWithContext('INSTALLATION_DISCOVERY', 'Error fetching installation repositories', {
      installationId,
      error: error instanceof Error ? error.message : String(error)
    });
    return [];
  }
}

/**
 * Find installation ID for a specific repository through API discovery
 */
export async function findInstallationForRepository(env: any, owner: string, repo: string): Promise<string | null> {
  logWithContext('INSTALLATION_DISCOVERY', 'Starting repository installation discovery', {
    owner,
    repo,
    fullName: `${owner}/${repo}`
  });

  try {
    // Get all installations
    const installations = await listAllInstallations(env);
    
    if (installations.length === 0) {
      logWithContext('INSTALLATION_DISCOVERY', 'No installations found');
      return null;
    }

    // Search through each installation for the repository
    let foundInstallationId: string | null = null;
    let organizationInstallationId: string | null = null;

    for (const installation of installations) {
      logWithContext('INSTALLATION_DISCOVERY', 'Checking installation for repository', {
        installationId: installation.id,
        account: installation.account.login,
        accountType: installation.account.type,
        targetRepo: `${owner}/${repo}`
      });

      // Get repositories for this installation
      const repositories = await getInstallationRepositories(env, installation.id.toString());
      
      // Check if our target repository is in this installation
      const targetRepo = repositories.find(r => r.full_name === `${owner}/${repo}`);
      
      if (targetRepo) {
        foundInstallationId = installation.id.toString();
        
        logWithContext('INSTALLATION_DISCOVERY', 'Found repository in installation', {
          installationId: installation.id,
          account: installation.account.login,
          accountType: installation.account.type,
          repository: targetRepo.full_name
        });

        // Prefer organization installations over user installations
        if (installation.account.type === "Organization") {
          organizationInstallationId = installation.id.toString();
          logWithContext('INSTALLATION_DISCOVERY', 'Found organization installation, using it as preferred', {
            installationId: installation.id,
            organization: installation.account.login
          });
          break; // Use organization installation immediately
        }
      }
    }

    // Return organization installation if found, otherwise return any found installation
    const finalInstallationId = organizationInstallationId || foundInstallationId;
    
    if (finalInstallationId) {
      logWithContext('INSTALLATION_DISCOVERY', 'Repository installation discovery successful', {
        owner,
        repo,
        installationId: finalInstallationId,
        preferredOrganization: !!organizationInstallationId
      });
      
      // Cache the result for future use
      await storeInstallationIdForRepository(env, owner, repo, finalInstallationId);
    } else {
      logWithContext('INSTALLATION_DISCOVERY', 'Repository not found in any installation', {
        owner,
        repo,
        installationsChecked: installations.length
      });
    }

    return finalInstallationId;
  } catch (error) {
    logWithContext('INSTALLATION_DISCOVERY', 'Error during repository installation discovery', {
      owner,
      repo,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return null;
  }
}

/**
 * Main entry point: Get or discover installation ID for a repository
 * Checks webhook payload → KV cache → API discovery
 */
export async function getOrDiscoverInstallationId(
  env: any,
  owner: string,
  repo: string,
  webhookInstallationId?: string
): Promise<string | null> {
  logWithContext('INSTALLATION_DISCOVERY', 'Starting installation ID resolution', {
    owner,
    repo,
    webhookInstallationId,
    hasWebhookId: !!webhookInstallationId
  });

  // Step 1: Try webhook payload first
  if (webhookInstallationId) {
    logWithContext('INSTALLATION_DISCOVERY', 'Using installation ID from webhook payload', {
      installationId: webhookInstallationId
    });
    
    // Cache the webhook installation ID for future use
    await storeInstallationIdForRepository(env, owner, repo, webhookInstallationId);
    return webhookInstallationId;
  }

  // Step 2: Check KV cache
  logWithContext('INSTALLATION_DISCOVERY', 'Checking KV cache for installation ID');
  const cachedInstallationId = await getInstallationIdForRepository(env, owner, repo);
  
  if (cachedInstallationId) {
    logWithContext('INSTALLATION_DISCOVERY', 'Found installation ID in cache', {
      installationId: cachedInstallationId
    });
    return cachedInstallationId;
  }

  // Step 3: API discovery as last resort
  logWithContext('INSTALLATION_DISCOVERY', 'No cached installation ID found, starting API discovery');
  const discoveredInstallationId = await findInstallationForRepository(env, owner, repo);

  if (discoveredInstallationId) {
    logWithContext('INSTALLATION_DISCOVERY', 'Installation ID discovered via API', {
      installationId: discoveredInstallationId
    });
  } else {
    logWithContext('INSTALLATION_DISCOVERY', 'No installation ID found for repository', {
      owner,
      repo,
      checkedWebhook: !!webhookInstallationId,
      checkedCache: true,
      checkedAPI: true
    });
  }

  return discoveredInstallationId;
}