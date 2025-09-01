import { logWithContext } from "../log";
import { getClaudeApiKey } from "../kv_storage";

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

    logWithContext('CLAUDE_TEST', 'Making API call to Claude', {
      keyPrefix: apiKey.substring(0, 7) + '...'
    });

    // Make API call to Claude
    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        system: 'You are a star wars nerd, and the person who greets you, have been following star wars since they were kid',
        messages: [{
          role: 'user',
          content: 'hello there!'
        }]
      })
    });

    if (!claudeResponse.ok) {
      const errorText = await claudeResponse.text();
      logWithContext('CLAUDE_TEST', 'Claude API call failed', {
        status: claudeResponse.status,
        statusText: claudeResponse.statusText,
        error: errorText
      });

      return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Claude Test - API Error</title>
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
    <h1>❌ Claude API Error</h1>
    <div class="error">
        <strong>API Call Failed:</strong><br>
        Status: ${claudeResponse.status} ${claudeResponse.statusText}<br><br>
        <strong>Response:</strong>
        <pre>${errorText}</pre>
    </div>
    <a href="/claude-setup" class="btn">Check API Key Configuration</a>
    <a href="/" class="btn">Back to Home</a>
</body>
</html>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 500
      });
    }

    const claudeData = await claudeResponse.json();
    
    logWithContext('CLAUDE_TEST', 'Claude API call successful', {
      responseLength: claudeData.content?.[0]?.text?.length || 0
    });

    const claudeMessage = claudeData.content?.[0]?.text || 'No response from Claude';

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
    </style>
</head>
<body>
    <div class="success">
        <h1>✅ Claude Test Successful!</h1>
        <p>Claude API is working correctly and responded to your greeting!</p>
    </div>

    <div class="prompt-info">
        <strong>Test Details:</strong><br>
        <strong>Your message:</strong> "hello there!"<br>
        <strong>System prompt:</strong> "You are a star wars nerd, and the person who greets you, have been following star wars since they were kid"
    </div>

    <div class="response">
        <h3>Claude's Response:</h3>
        <p>${claudeMessage.replace(/\n/g, '<br>')}</p>
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