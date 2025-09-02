/**
 * Script to create optimized Daytona snapshot for Claude Code container
 * This pre-builds the environment for faster sandbox initialization
 */
const { execSync } = require('child_process');

async function createDaytonaSnapshot() {
  console.log('🚀 Creating Daytona snapshot for Claude Code...');
  
  const snapshotConfig = {
    name: 'claude-code-optimized',
    description: 'Pre-built Claude Code environment with CLI and dependencies',
    base: {
      image: 'claude-code-daytona:slim'
    },
    resources: {
      cpu: 2,
      memory: '2GB',
      disk: '10GB'
    },
    environment: {
      NODE_ENV: 'production',
      PORT: '8080'
    },
    // Pre-warm commands to optimize startup
    setup: [
      'claude --version',
      'git --version',
      'node --version',
      'npm --version',
      // Pre-create workspace directory
      'mkdir -p /tmp/workspace',
      // Verify Claude CLI works
      'echo "Verifying Claude Code CLI installation..."'
    ],
    networking: {
      ports: [8080],
      public: true
    },
    lifecycle: {
      autoStop: '30m',     // Auto-stop after 30 minutes of inactivity
      autoArchive: '2h',   // Archive after 2 hours
      autoDelete: '24h'    // Delete after 24 hours
    }
  };

  // Create snapshot using Daytona CLI
  const command = `daytona snapshot create ${snapshotConfig.name} \\
    --from-image ${snapshotConfig.base.image} \\
    --cpu ${snapshotConfig.resources.cpu} \\
    --memory ${snapshotConfig.resources.memory} \\
    --disk ${snapshotConfig.resources.disk} \\
    --description "${snapshotConfig.description}"`;

  try {
    console.log('📝 Creating snapshot with command:');
    console.log(command);
    
    const output = execSync(command, { encoding: 'utf-8', stdio: 'pipe' });
    console.log('✅ Snapshot created successfully!');
    console.log(output);
    
    // Parse snapshot ID from output
    const snapshotIdMatch = output.match(/Snapshot ID: ([a-zA-Z0-9-]+)/);
    if (snapshotIdMatch) {
      const snapshotId = snapshotIdMatch[1];
      console.log(`🎯 Snapshot ID: ${snapshotId}`);
      console.log(`📋 Add this to your Worker environment variables:`);
      console.log(`   DAYTONA_SNAPSHOT_ID=${snapshotId}`);
    }
    
  } catch (error) {
    console.error('❌ Failed to create snapshot:', error.message);
    console.error('💡 Make sure you have:');
    console.error('   1. Daytona CLI installed and authenticated');
    console.error('   2. Docker image built and available');
    console.error('   3. Sufficient Daytona account limits');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  createDaytonaSnapshot().catch(console.error);
}

module.exports = { createDaytonaSnapshot };