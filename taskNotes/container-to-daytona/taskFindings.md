# Purpose

Migrate current Cloudflare container setup to Daytona cloud development environment platform

## Original Ask
Move current cloudflare container setup to Daytona. We need to use the same container as we have but try with slim version. The internals of container doesn't change, but it changes with how cloudflare workers are setup with and interact with Daytona.

## Complexity and the reason behind it
Complexity score: 4 out of 5

This is a complex architectural migration that requires:
- Deep understanding of both Cloudflare Workers and Daytona ecosystems
- Rearchitecting the container orchestration from Cloudflare's native containers to Daytona sandboxes
- Maintaining existing functionality while changing the underlying infrastructure
- Integration of Daytona SDK/API calls replacing Cloudflare container bindings
- Handling authentication and API key management across platforms

## Architectural changes required

**Major Infrastructure Migration:**
1. **Container Platform Shift**: Replace `@cloudflare/containers` with Daytona SDK for sandbox management
2. **Worker-to-Sandbox Communication**: Replace direct container fetch calls with Daytona API calls
3. **Environment Variable Management**: Migrate from Cloudflare's env var injection to Daytona's configuration system
4. **Authentication Flow**: Integrate Daytona API keys alongside existing GitHub/Claude credentials
5. **Container Lifecycle**: Adapt from Cloudflare's Durable Object-based containers to Daytona's sandbox lifecycle
6. **Network Architecture**: Replace internal container-to-worker communication with external API calls to Daytona

**Key Architectural Components:**
- Cloudflare Worker becomes an orchestrator that creates/manages Daytona sandboxes
- Current `MyContainer` class logic moves into Daytona sandbox initialization scripts
- GitHub webhook processing remains in Worker but delegates execution to Daytona sandboxes
- Slim container image optimization for faster Daytona deployment

## Backend changes required

**Cloudflare Worker Changes:**
1. **Remove Container Dependencies**: Remove `@cloudflare/containers` imports and replace with Daytona SDK
2. **Sandbox Management**: Implement Daytona sandbox creation, lifecycle management, and cleanup
3. **API Integration**: Replace container fetch calls with HTTP requests to Daytona sandbox endpoints
4. **Environment Configuration**: Adapt environment variable passing to work with Daytona's configuration system
5. **Error Handling**: Update error handling for network-based communication instead of local container calls

**Container Optimization:**
1. **Dockerfile Slimming**: Optimize current Dockerfile for minimal size while maintaining functionality
2. **Snapshot Creation**: Implement Daytona snapshot creation for faster sandbox initialization
3. **Port Configuration**: Ensure container exposes correct ports for Daytona's networking requirements
4. **Health Checks**: Implement robust health checking for external accessibility

**New Components:**
1. **Daytona Client**: Wrapper class for Daytona API operations
2. **Sandbox State Management**: Track active sandboxes and their lifecycle
3. **Resource Cleanup**: Implement automatic cleanup of idle/failed sandboxes

## Frontend changes required

**Minimal frontend changes required:**
1. **Status Reporting**: Update status endpoints to reflect Daytona sandbox states
2. **Error Messages**: Update error handling to account for Daytona-specific failure modes
3. **Setup Flow**: Add Daytona API key configuration to existing setup process

## Acceptance Criteria

1. **Functional Equivalence**: All existing GitHub issue processing functionality works identically
2. **Performance**: Container startup time should be faster with slim image and Daytona snapshots
3. **Reliability**: No degradation in error handling or recovery mechanisms
4. **Security**: Maintain same security posture with proper API key management
5. **Scalability**: Support multiple concurrent issue processing with Daytona's elastic infrastructure
6. **Cost Efficiency**: Leverage Daytona's auto-stop/archive features for cost optimization

## Validation

**Integration Testing:**
1. **End-to-End GitHub Flow**: Test complete webhook → issue processing → PR creation pipeline
2. **Container Functionality**: Verify Claude Code CLI execution works identically in Daytona environment
3. **Error Handling**: Test failure scenarios and recovery mechanisms
4. **Load Testing**: Validate concurrent issue processing capabilities

**API Testing:**
- Daytona sandbox creation/deletion/management
- File system operations in Daytona sandboxes
- Git operations and repository cloning
- Preview URL accessibility and functionality

**Commands to Run:**
```bash
# Development testing
npm run dev
curl -X POST http://localhost:8787/test-claude -d '{"CLAUDE_TEST_MODE": "true"}'

# Deployment testing  
npm run deploy
# Test production webhook endpoints

# Container testing
docker build -t claude-code-slim -f Dockerfile.slim .
docker run -p 8080:8080 claude-code-slim
```

**Frontend Validation:**
- Setup flow includes Daytona API key configuration
- Status page shows Daytona sandbox information
- Error messages properly reflect Daytona-specific issues
- All existing functionality accessible and working