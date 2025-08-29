import { Container, loadBalance, getContainer } from '@cloudflare/containers';
import { decrypt, generateInstallationToken } from './crypto';
import { containerFetch, getRouteFromRequest } from './fetch';
import { handleOAuthCallback } from './handlers/oauth_callback';
import { handleClaudeSetup } from './handlers/claude_setup';
import { handleGitHubSetup } from './handlers/github_setup';
import { handleGitHubStatus } from './handlers/github_status';
import { handleGitHubWebhook } from './handlers/github_webhook';
import { logWithContext } from './log';


export class MyContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = '45s'; // Extended timeout for Claude Code processing
  envVars: Record<string, string> = {
    MESSAGE: 'I was passed in via the container class!',
  };

  // Override fetch to handle environment variable setting for specific requests
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    logWithContext('CONTAINER', 'Container request received', {
      method: request.method,
      pathname: url.pathname,
      headers: Object.fromEntries(request.headers.entries())
    });

    // Handle process-issue requests by setting environment variables
    if (url.pathname === '/process-issue' && request.method === 'POST') {
      logWithContext('CONTAINER', 'Processing issue request');

      try {
        const issueContext = await request.json() as Record<string, any>;

        logWithContext('CONTAINER', 'Issue context received', {
          issueId: issueContext.ISSUE_ID,
          repository: issueContext.REPOSITORY_NAME,
          envVarCount: Object.keys(issueContext).length
        });

        // Set environment variables for this container instance
        let envVarsSet = 0;
        Object.entries(issueContext).forEach(([key, value]) => {
          if (typeof value === 'string') {
            this.envVars[key] = value;
            envVarsSet++;
          }
        });

        logWithContext('CONTAINER', 'Environment variables set', {
          envVarsSet,
          totalEnvVars: Object.keys(issueContext).length
        });

        logWithContext('CONTAINER', 'Forwarding request to container');

        // Create a new request with the JSON data to avoid ReadableStream being disturbed
        const newRequest = new Request(request.url, {
          method: request.method,
          headers: request.headers,
          body: JSON.stringify(issueContext)
        });

        const response = await super.fetch(newRequest);

        logWithContext('CONTAINER', 'Container response received', {
          status: response.status,
          statusText: response.statusText
        });

        return response;
      } catch (error) {
        logWithContext('CONTAINER', 'Error processing issue request', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        });

        return new Response(JSON.stringify({
          error: 'Failed to process issue context',
          message: (error as Error).message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // For all other requests, use default behavior
    logWithContext('CONTAINER', 'Using default container behavior');
    return super.fetch(request);
  }

  override onStart() {
    logWithContext('CONTAINER_LIFECYCLE', 'Container started successfully', {
      port: this.defaultPort,
      sleepAfter: this.sleepAfter
    });
  }

  override onStop() {
    logWithContext('CONTAINER_LIFECYCLE', 'Container shut down successfully');
  }

  override onError(error: unknown) {
    logWithContext('CONTAINER_LIFECYCLE', 'Container error occurred', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

export default {
  async fetch(
    request: Request,
    env: { 
      MY_CONTAINER: DurableObjectNamespace<Container<unknown>>;
      GITHUB_CONFIG: KVNamespace;
    }
  ): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;

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
    });

    let response: Response;
    let routeMatched = false;

    try {
      // Claude Code Setup Route
      if (pathname === '/claude-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to Claude setup');
        routeMatched = true;
        response = await handleClaudeSetup(request, url.origin, env);
      }

      // GitHub App Setup Routes
      else if (pathname === '/gh-setup') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub setup');
        routeMatched = true;
        response = await handleGitHubSetup(request, url.origin, env);
      }

      else if (pathname === '/gh-setup/callback') {
        logWithContext('MAIN_HANDLER', 'Routing to OAuth callback');
        routeMatched = true;
        response = await handleOAuthCallback(request, url, env);
      }

      // Status endpoint to check stored configurations
      else if (pathname === '/gh-status') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub status');
        routeMatched = true;
        response = await handleGitHubStatus(request, env);
      }

      // GitHub webhook endpoint
      else if (pathname === '/webhooks/github') {
        logWithContext('MAIN_HANDLER', 'Routing to GitHub webhook handler');
        routeMatched = true;
        response = await handleGitHubWebhook(request, env);
      }

      // Container routes
      else if (pathname.startsWith('/container')) {
        logWithContext('MAIN_HANDLER', 'Routing to basic container');
        routeMatched = true;
        let id = env.MY_CONTAINER.idFromName('container');
        let container = env.MY_CONTAINER.get(id);
        response = await containerFetch(container, request, {
          containerName: 'container',
          route: getRouteFromRequest(request)
        });
      }

      else if (pathname.startsWith('/error')) {
        logWithContext('MAIN_HANDLER', 'Routing to error test container');
        routeMatched = true;
        let id = env.MY_CONTAINER.idFromName('error-test');
        let container = env.MY_CONTAINER.get(id);
        response = await containerFetch(container, request, {
          containerName: 'error-test',
          route: getRouteFromRequest(request)
        });
      }

      else if (pathname.startsWith('/lb')) {
        logWithContext('MAIN_HANDLER', 'Routing to load balanced containers');
        routeMatched = true;
        let container = await loadBalance(env.MY_CONTAINER, 3);
        response = await containerFetch(container, request, {
          containerName: 'load-balanced',
          route: getRouteFromRequest(request)
        });
      }

      else if (pathname.startsWith('/singleton')) {
        logWithContext('MAIN_HANDLER', 'Routing to singleton container');
        routeMatched = true;
        const container: DurableObjectStub<Container<unknown>> = getContainer(env.MY_CONTAINER);
        response = await containerFetch(container, request, {
          containerName: 'singleton',
          route: getRouteFromRequest(request)
        });
      }

      // Default home page
      else {
        logWithContext('MAIN_HANDLER', 'Serving home page');
        routeMatched = true;
        response = new Response(`
🤖 Claude Code Container Integration

Setup Instructions:
1. Configure Claude Code: /claude-setup
2. Setup GitHub Integration: /gh-setup

Container Testing Routes:
- /container - Basic container health check
- /lb - Load balancing over multiple containers
- /error - Test error handling
- /singleton - Single container instance

Once both setups are complete, create GitHub issues to trigger automatic Claude Code processing!
        `);
      }

      const processingTime = Date.now() - startTime;

      logWithContext('MAIN_HANDLER', 'Request completed successfully', {
        pathname,
        method: request.method,
        status: response.status,
        statusText: response.statusText,
        processingTimeMs: processingTime,
        routeMatched
      });

      return response;

    } catch (error) {
      const processingTime = Date.now() - startTime;

      logWithContext('MAIN_HANDLER', 'Request failed with error', {
        pathname,
        method: request.method,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        processingTimeMs: processingTime,
        routeMatched
      });

      return new Response(JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
};
