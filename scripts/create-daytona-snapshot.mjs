#!/usr/bin/env node

import { Daytona, Image } from '@daytonaio/sdk';
import { readFileSync } from 'fs';

// Generate unique snapshot name with timestamp  
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const CLAUDE_SNAPSHOT_NAME = `claude-code-env-1`;
const DOCKERFILE_PATH = "Dockerfile.slim";

async function createSnapshot() {
  try {
    // Check if .dev.vars exists and has DAYTONA_API_KEY
    let daytonaApiKey;
    try {
      const envVars = readFileSync('.dev.vars', 'utf8');
      const match = envVars.match(/DAYTONA_API_KEY=(.+)/);
      daytonaApiKey = match?.[1];
    } catch (error) {
      console.error('Error reading .dev.vars file:', error.message);
      process.exit(1);
    }

    if (!daytonaApiKey) {
      console.error('❌ DAYTONA_API_KEY not found in .dev.vars');
      console.error('💡 Add your Daytona API key to .dev.vars:');
      console.error('   DAYTONA_API_KEY=your_api_key_here');
      process.exit(1);
    }

    console.log('🚀 Initializing Daytona client...');
    const daytona = new Daytona({ apiKey: daytonaApiKey });

    console.log(`📦 Creating Claude Code snapshot from ${DOCKERFILE_PATH}...`);
    
    // Try specifying the build context more explicitly
    const claudeImage = Image.fromDockerfile(DOCKERFILE_PATH);

    await daytona.snapshot.create({
      name: CLAUDE_SNAPSHOT_NAME,
      image: claudeImage,
    }, {
      onLogs: (chunk) => {
        // Clean up log output for better readability
        const cleanChunk = chunk.toString().trim();
        if (cleanChunk) {
          console.log(`   ${cleanChunk}`);
        }
      },
    });

    console.log(`✅ Snapshot "${CLAUDE_SNAPSHOT_NAME}" created successfully!`);
    console.log('');
    console.log('📋 Next steps:');
    console.log('1. Update your Worker environment variables:');
    console.log(`   DAYTONA_SNAPSHOT_ID=${CLAUDE_SNAPSHOT_NAME}`);
    console.log('2. Deploy your Worker with the new snapshot configuration');
    console.log('3. Test GitHub integration with the Daytona-powered containers');

  } catch (error) {
    console.error('❌ Failed to create snapshot:', error.message);
    console.error('');
    console.error('💡 Troubleshooting steps:');
    console.error('   1. Verify DAYTONA_API_KEY is correct in .dev.vars');
    console.error('   2. Ensure Docker image was built successfully');
    console.error('   3. Check Daytona account limits and permissions');
    console.error('   4. Verify network connectivity to Daytona API');
    process.exit(1);
  }
}

createSnapshot();