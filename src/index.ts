import { Container, loadBalance, getContainer } from '@cloudflare/containers';
import { decrypt, generateInstallationToken } from './crypto';
import { containerFetch, getRouteFromRequest } from './fetch';
import { handleOAuthCallback } from './handlers/oauth_callback';
import { handleClaudeSetup } from './handlers/claude_setup';
import { handleGitHubSetup } from './handlers/github_setup';
import { handleGitHubStatus } from './handlers/github_status';
import { handleGitHubWebhook } from './handlers/github_webhook';
import { handleClaudeTest } from './handlers/claude_test';
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

      // Claude test endpoint
      else if (pathname === '/test-claude') {
        logWithContext('MAIN_HANDLER', 'Routing to Claude test');
        routeMatched = true;
        response = await handleClaudeTest(request, env);
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
        <h1 class="title">🤖 Claude Code Container Integration</h1>
        <p class="subtitle">AI-powered GitHub issue processing with Claude Code</p>
    </div>

    <div class="section">
        <h3>🚀 Setup Instructions</h3>
        <div class="step">
            <span class="step-number">1</span>
            <strong>Configure Claude Code:</strong> Set up your Anthropic API key for Claude integration
            <div class="link-group">
                <a href="/claude-setup" class="btn setup">Configure Claude API Key</a>
            </div>
        </div>
        <div class="step">
            <span class="step-number">2</span>
            <strong>Setup GitHub Integration:</strong> Create and configure your GitHub App
            <div class="link-group">
                <a href="/gh-setup" class="btn setup">Setup GitHub Integration</a>
                <a href="/gh-status" class="btn">Check Setup Status</a>
            </div>
        </div>
    </div>

    <div class="section">
        <h3>🧪 Testing & Validation</h3>
        <div class="link-group">
            <a href="/test-claude" class="btn test">Test Claude API</a>
            <span style="margin-left: 10px; color: #666;">Test your Claude configuration with a Star Wars greeting!</span>
        </div>
    </div>

    <div class="section">
        <h3>🔧 Container Testing Routes</h3>
        <p>These routes are for testing the container infrastructure:</p>
        <div class="link-group">
            <a href="/container" class="btn container">Basic Container</a>
            <a href="/lb" class="btn container">Load Balancing</a>
            <a href="/error" class="btn container">Error Handling</a>
            <a href="/singleton" class="btn container">Singleton Instance</a>
        </div>
    </div>

    <div class="success-note">
        <strong>🎉 Ready to go?</strong> Once both setups are complete, create GitHub issues in your repositories to trigger automatic Claude Code processing!
    </div>

    <div style="text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #e9ecef;">
        <p style="color: #666; font-size: 0.9em;">
            Powered by <strong>Cloudflare Workers</strong> + <strong>Claude Code</strong> + <strong>GitHub Apps</strong>
        </p>
    </div>
</body>
</html>`, {
          headers: { 'Content-Type': 'text/html' }
        });
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
