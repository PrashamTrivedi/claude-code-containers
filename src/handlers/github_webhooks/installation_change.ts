import { logWithContext } from "../../log";

// Handle repository changes (repos added/removed from installation)
export async function handleInstallationRepositoriesEvent(data: any, env: any): Promise<Response> {
  const action = data.action;

  logWithContext('INSTALLATION_REPOSITORIES', 'Processing repository changes', {
    action,
    addedCount: data.repositories_added?.length || 0,
    removedCount: data.repositories_removed?.length || 0
  });

  if (action === 'added') {
    const addedRepos = data.repositories_added || [];
    logWithContext('INSTALLATION_REPOSITORIES', 'Repositories added to installation', {
      count: addedRepos.length,
      repositories: addedRepos.map((r: any) => r.full_name)
    });
  } else if (action === 'removed') {
    const removedRepos = data.repositories_removed || [];
    logWithContext('INSTALLATION_REPOSITORIES', 'Repositories removed from installation', {
      count: removedRepos.length,
      repositories: removedRepos.map((r: any) => r.full_name)
    });
  }

  // Note: For KV storage simplification, we're not tracking individual repository changes
  // The installation configuration is updated when the app is installed/uninstalled
  
  return new Response('Repository changes processed', { status: 200 });
}