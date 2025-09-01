import { logWithContext } from "../log";
import { getClaudeApiKey } from "../kv_storage";
import { containerFetch } from "../fetch";
import { loadBalance } from '@cloudflare/containers';

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

    logWithContext('CLAUDE_TEST', 'Routing Claude test to container', {
      keyPrefix: apiKey.substring(0, 7) + '...'
    });

    // Prepare test data for container - simulating a simple test issue
    const testData = {
      ANTHROPIC_API_KEY: apiKey,
      ISSUE_ID: 'claude-test-123',
      ISSUE_NUMBER: '0',
      ISSUE_TITLE: 'Claude Code Test',
      ISSUE_BODY: 'hello there!',
      ISSUE_LABELS: '[]',
      REPOSITORY_URL: 'https://github.com/test/test.git',
      REPOSITORY_NAME: 'test/test',
      ISSUE_AUTHOR: 'testuser',
      CLAUDE_TEST_MODE: 'true', // Flag to indicate this is a test
      CLAUDE_TEST_PROMPT: 'You are a star wars nerd, and the person who greets you, have been following star wars since they were kid. Respond to: hello there!'
    };

    try {
      // Use load balanced container for the test
      logWithContext('CLAUDE_TEST', 'Creating container for Claude test');
      const container = await loadBalance(env.MY_CONTAINER, 3);

      // Make request to container
      const containerRequest = new Request('http://internal/test-claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testData)
      });

      logWithContext('CLAUDE_TEST', 'Sending request to container');
      const containerResponse = await containerFetch(container, containerRequest, {
        containerName: 'claude-test',
        route: '/test-claude'
      });

      const responseText = await containerResponse.text();
      logWithContext('CLAUDE_TEST', 'Container response received', {
        status: containerResponse.status,
        statusText: containerResponse.statusText,
        responseLength: responseText.length
      });

      if (containerResponse.ok) {
        let containerResult;
        try {
          containerResult = JSON.parse(responseText);
        } catch {
          containerResult = { message: responseText };
        }

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
        .prompt-info {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
            padding: 15px;
            margin: 20px 0;
        }
        .container-info {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="success">
        <h1>✅ Claude Container Test Successful!</h1>
        <p>Claude Code container processed the request successfully!</p>
    </div>

    <div class="container-info">
        <strong>Container Test Details:</strong><br>
        <strong>Method:</strong> Using Claude Code Container (not direct API)<br>
        <strong>Test Message:</strong> "hello there!"<br>
        <strong>System Prompt:</strong> "You are a star wars nerd..."
    </div>

    <div class="response">
        <h3>Container Response:</h3>
        <p>${containerResult.message || JSON.stringify(containerResult)}</p>
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
        // Container failed
        return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Container Error</title>
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
    <h1>❌ Container Test Failed</h1>
    <div class="error">
        <strong>Container Error:</strong><br>
        Status: ${containerResponse.status} ${containerResponse.statusText}<br><br>
        <strong>Response:</strong>
        <pre>${responseText}</pre>
    </div>
    <a href="/claude-setup" class="btn">Check API Key Configuration</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
          headers: { 'Content-Type': 'text/html' },
          status: 500
        });
      }

    } catch (containerError) {
      logWithContext('CLAUDE_TEST', 'Error communicating with container', {
        error: (containerError as Error).message,
        stack: (containerError as Error).stack
      });

      return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - Container Communication Error</title>
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
    <h1>❌ Container Communication Error</h1>
    <div class="error">
        <strong>Failed to communicate with container:</strong> ${(containerError as Error).message}
    </div>
    <a href="/test-claude" class="btn">Try Again</a>
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