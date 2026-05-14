/**
 * Development mode script for Clawd Desktop Pet.
 *
 * Builds the project if needed, then launches Electron.
 * Provides a simple sequential workflow:
 *   1. Build Node.js sources (main process, agent, preload) via tsc
 *   2. Build renderer via Vite
 *   3. Launch Electron pointing to the built output
 *
 * For hot-reload during development, use the individual build commands
 * in separate terminals:
 *   - Terminal 1: `npm run build:node -- --watch` (or use tsc -w)
 *   - Terminal 2: `npm run build:renderer -- --watch` (or use vite build -w)
 *   - Terminal 3: `npm run dev:quick` (just launches electron with existing build)
 *
 * Usage: npm run dev
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');

/**
 * Run a command and return a promise that resolves on exit.
 * Exits the process with the same code if the command fails.
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: ROOT_DIR,
      ...options,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command "${command} ${args.join(' ')}" exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if the dist directory has a complete build.
 */
function isBuildPresent() {
  const requiredFiles = [
    'dist/main/main.js',
    'dist/agent/agent-process.js',
    'dist/preload/preload.js',
    'dist/preload/settings-preload.js',
    'dist/renderer/index.html',
    'dist/renderer/settings/index.html',
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT_DIR, file))) {
      return false;
    }
  }
  return true;
}

async function main() {
  console.log('[dev] Clawd Desktop Pet - Development Mode');
  console.log('[dev] ========================================\n');

  // Step 1: Build Node.js sources
  console.log('[dev] Step 1/3: Building Node.js sources (main, agent, preload)...');
  try {
    await run('npx', ['tsc', '-p', 'tsconfig.node.json']);
    console.log('[dev]   Node.js sources built successfully.\n');
  } catch (err) {
    console.error('[dev]   FAILED to build Node.js sources:', err.message);
    process.exit(1);
  }

  // Step 2: Build renderer
  console.log('[dev] Step 2/3: Building renderer (Vite)...');
  try {
    await run('npx', ['vite', 'build', '--config', 'vite.renderer.config.ts']);
    console.log('[dev]   Renderer built successfully.\n');
  } catch (err) {
    console.error('[dev]   FAILED to build renderer:', err.message);
    process.exit(1);
  }

  // Step 3: Launch Electron
  console.log('[dev] Step 3/3: Launching Electron...\n');
  try {
    await run('npx', ['electron', '.'], {
      env: {
        ...process.env,
        NODE_ENV: 'development',
      },
    });
  } catch (err) {
    // Electron exits with non-zero on normal quit sometimes, only error on real failures
    if (err.message && err.message.includes('exited with code')) {
      const match = err.message.match(/exited with code (\d+)/);
      const code = match ? parseInt(match[1], 10) : 1;
      if (code === 0) {
        console.log('\n[dev] Electron exited normally.');
        return;
      }
    }
    console.error('[dev] Electron error:', err.message);
    process.exit(1);
  }

  console.log('\n[dev] Electron exited.');
}

main().catch((err) => {
  console.error('[dev] Unhandled error:', err);
  process.exit(1);
});
