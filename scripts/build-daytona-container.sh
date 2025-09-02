#!/bin/bash

# Script to build and prepare slim container for Daytona deployment
set -e

echo "🐳 Building slim Docker container for Daytona..."

# Build slim container
docker build -f Dockerfile.slim -t claude-code-daytona:slim \
  --build-arg BUILDKIT_INLINE_CACHE=1 \
  --progress=plain \
  .

echo "📊 Container size analysis:"
docker images | grep claude-code

echo "🔍 Testing container health..."
# Test run container locally
CONTAINER_ID=$(docker run -d -p 8081:8080 claude-code-daytona:slim)

# Wait for container to start
sleep 5

# Health check
if curl -s http://localhost:8081/ > /dev/null; then
  echo "✅ Container health check passed"
else
  echo "❌ Container health check failed"
  docker logs $CONTAINER_ID
  exit 1
fi

# Cleanup test container
docker stop $CONTAINER_ID
docker rm $CONTAINER_ID

echo "🎉 Slim container ready for Daytona deployment!"
echo ""
echo "📋 Next steps:"
echo "1. Tag container: docker tag claude-code-daytona:slim your-registry/claude-code-daytona:latest"
echo "2. Push to registry: docker push your-registry/claude-code-daytona:latest"
echo "3. Create Daytona snapshot using this image"
echo "4. Configure Worker with DAYTONA_API_KEY and snapshot ID"