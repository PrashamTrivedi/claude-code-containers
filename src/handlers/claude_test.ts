import { logWithContext } from "../log";
import { getClaudeApiKey } from "../kv_storage";
import { getDaytonaCredentials } from "./daytona_setup";

export async function handleClaudeTest(request: Request, env?: any): Promise<Response> {
  logWithContext('CLAUDE_TEST', 'Handling Claude test request', {
    method: request.method
  });

  try {
    // Get Claude API key from KV storage
    const apiKey = await getClaudeApiKey(env);
    
    if (!apiKey) {
      const errorMsg = 'Claude API key not configured. Please set up your API key at /claude-setup first.';
      logWithContext('CLAUDE_TEST', 'API key not found');
      
      return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
            line-height: 1.6;
        }
        .error { 
            color: #dc3545; 
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 20px;
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
            margin: 10px;
        }
    </style>
</head>
<body>
    <h1>❌ Claude Test Failed</h1>
    <div class="error">
        <strong>Error:</strong> ${errorMsg}
    </div>
    <a href="/claude-setup" class="btn">Configure Claude API Key</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }

    logWithContext('CLAUDE_TEST', 'Routing Claude test to Daytona sandbox', {
      keyPrefix: apiKey.substring(0, 7) + '...'
    });

    // Get Daytona credentials
    const daytonaCredentials = await getDaytonaCredentials(env);
    if (!daytonaCredentials) {
      const errorMsg = 'Daytona credentials not configured. Please set up Daytona at /daytona-setup first.';
      logWithContext('CLAUDE_TEST', 'Daytona credentials not found');
      
      return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
            line-height: 1.6;
        }
        .error { 
            color: #dc3545; 
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 20px;
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
            margin: 10px;
        }
    </style>
</head>
<body>
    <h1>❌ Claude Test Failed</h1>
    <div class="error">
        <strong>Error:</strong> ${errorMsg}
    </div>
    <a href="/daytona-setup" class="btn">Configure Daytona</a>
    <a href="/claude-setup" class="btn">Configure Claude API Key</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 400
      });
    }

    // Prepare test prompt for Claude CLI
    const testPrompt = 'You are a star wars nerd, and the person who greets you, have been following star wars since they were kid. Respond to: hello there!';

    try {
      // Use Daytona sandbox for the test
      logWithContext('CLAUDE_TEST', 'Creating Daytona sandbox for Claude test');
      const sandboxManager = env.DAYTONA_SANDBOX_MANAGER.get(
        env.DAYTONA_SANDBOX_MANAGER.idFromName('claude-test-manager')
      );

      // Create a sandbox specifically for testing
      const createRequest = new Request('http://internal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `claude-test-${Date.now()}`,
          projectName: 'claude-test',
          gitUrl: 'https://github.com/test/test.git', // Dummy git URL for testing
          envVars: {
            ANTHROPIC_API_KEY: apiKey
          }
        })
      });

      logWithContext('CLAUDE_TEST', 'Creating sandbox for test');
      const createResponse = await sandboxManager.fetch(createRequest);
      const createResult = await createResponse.json();

      if (!createResult.success) {
        throw new Error(`Failed to create sandbox: ${createResult.error}`);
      }

      const sandboxId = createResult.sandboxId;
      logWithContext('CLAUDE_TEST', 'Sandbox created successfully', { sandboxId });

      // Execute Claude CLI with the test prompt
      const claudeRequest = new Request('http://internal/execute-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sandboxId,
          prompt: testPrompt
        })
      });

      logWithContext('CLAUDE_TEST', 'Executing Claude CLI in sandbox');
      const claudeResponse = await sandboxManager.fetch(claudeRequest);
      const claudeResult = await claudeResponse.json();

      logWithContext('CLAUDE_TEST', 'Claude CLI response received', {
        success: claudeResult.success,
        sandboxId,
        outputLength: claudeResult.data?.stdout?.length || 0
      });

      if (claudeResult.success && claudeResult.data) {
        const claudeOutput = claudeResult.data.stdout || claudeResult.data.stderr || 'No output received';

        // Format successful response
        return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Success!</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 700px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
        }
        .success { 
            color: #28a745; 
            background: #d4edda;
            border: 1px solid #c3e6cb;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
            text-align: center;
        }
        .response {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
            max-height: 400px;
            overflow-y: auto;
        }
        .btn {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 10px 5px;
        }
        .test-again {
            background: #28a745;
        }
        .footer {
            text-align: center;
            margin-top: 40px;
        }
        .sandbox-info {
            background: #e8f5e8;
            border-left: 4px solid #28a745;
            padding: 15px;
            margin: 20px 0;
        }
        pre {
            white-space: pre-wrap;
            word-wrap: break-word;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="success">
        <h1>✅ Claude Daytona Test Successful!</h1>
        <p>Claude CLI executed successfully in Daytona sandbox!</p>
    </div>

    <div class="sandbox-info">
        <strong>Daytona Sandbox Test Details:</strong><br>
        <strong>Method:</strong> Using Daytona Sandbox + Claude CLI<br>
        <strong>Sandbox ID:</strong> ${sandboxId}<br>
        <strong>Test Prompt:</strong> "${testPrompt}"<br>
        <strong>Exit Code:</strong> ${claudeResult.data.exitCode || 0}
    </div>

    <div class="response">
        <h3>Claude CLI Response:</h3>
        <pre>${claudeOutput}</pre>
    </div>

    <div class="footer">
        <a href="/test-claude" class="btn test-again">Test Again</a>
        <a href="/" class="btn">Back to Home</a>
        <a href="/gh-setup" class="btn">Setup GitHub Integration</a>
    </div>
</body>
</html>`, {
          headers: { 'Content-Type': 'text/html' }
        });
      } else {
        // Sandbox execution failed
        return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Sandbox Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
            line-height: 1.6;
        }
        .error { 
            color: #dc3545; 
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
            text-align: left;
        }
        .btn {
            display: inline-block;
            background: #0969da;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            margin: 10px;
        }
        pre {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            text-align: left;
        }
    </style>
</head>
<body>
    <h1>❌ Sandbox Test Failed</h1>
    <div class="error">
        <strong>Sandbox Error:</strong><br>
        ${claudeResult.error || 'Unknown error occurred'}<br><br>
        ${claudeResult.data?.stderr ? `<strong>Error Output:</strong><pre>${claudeResult.data.stderr}</pre>` : ''}
    </div>
    <a href="/daytona-setup" class="btn">Check Daytona Configuration</a>
    <a href="/claude-setup" class="btn">Check API Key Configuration</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
          headers: { 'Content-Type': 'text/html' },
          status: 500
        });
      }

    } catch (sandboxError) {
      logWithContext('CLAUDE_TEST', 'Error communicating with Daytona sandbox', {
        error: (sandboxError as Error).message,
        stack: (sandboxError as Error).stack
      });

      return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Sandbox Communication Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
            line-height: 1.6;
        }
        .error { 
            color: #dc3545; 
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 20px;
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
            margin: 10px;
        }
    </style>
</head>
<body>
    <h1>❌ Sandbox Communication Error</h1>
    <div class="error">
        <strong>Failed to communicate with Daytona sandbox:</strong> ${(sandboxError as Error).message}
    </div>
    <a href="/test-claude" class="btn">Try Again</a>
    <a href="/daytona-setup" class="btn">Check Daytona Setup</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 500
      });
    }

  } catch (error) {
    logWithContext('CLAUDE_TEST', 'Unexpected error during Claude test', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - System Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 40px auto;
            padding: 20px;
            text-align: center;
            line-height: 1.6;
        }
        .error { 
            color: #dc3545; 
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            border-radius: 6px;
            padding: 20px;
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
            margin: 10px;
        }
    </style>
</head>
<body>
    <h1>❌ System Error</h1>
    <div class="error">
        <strong>Unexpected Error:</strong> ${(error as Error).message}
    </div>
    <a href="/test-claude" class="btn">Try Again</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
      headers: { 'Content-Type': 'text/html' },
      status: 500
    });
  }
}