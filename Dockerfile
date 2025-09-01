# syntax=docker/dockerfile:1

FROM node:22 AS base



EXPOSE 4005

# Update package lists and install dependencies first
RUN apt-get update && \
    apt-get install -y \
        python3 \
        python3-pip \
        git \
        build-essential \
        python3-dev \
        ca-certificates \
        curl

# Install Claude Code CLI binary using native installation
RUN curl -fsSL https://claude.ai/install.sh | bash


# Set destination for COPY
WORKDIR /app

# Copy package files first for better caching
COPY container_src/package*.json ./

# Install npm dependencies
RUN npm install

# Copy TypeScript configuration
COPY container_src/tsconfig.json ./

# Copy source code
COPY container_src/src/ ./src/

# Build TypeScript
RUN npm run build

# Run the compiled JavaScript
CMD ["node", "dist/main.js"]