const { spawn } = require('child_process')
const net = require('net')
const path = require('path')
const fs = require('fs')

const repoRoot = __dirname
const backendDir = path.join(repoRoot, 'backend')
const frontendDir = path.join(repoRoot, 'frontend')
const backendPy = path.join(backendDir, 'main.py')
const electronMain = path.join(frontendDir, 'electron', 'main.cjs')
const viteCmd = process.platform === 'win32'
  ? path.join(frontendDir, 'node_modules', '.bin', 'vite.cmd')
  : path.join(frontendDir, 'node_modules', '.bin', 'vite')
const python = process.platform === 'win32' ? 'python' : 'python3'
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function findFreePort(startPort) {
  return new Promise(resolve => {
    const server = net.createServer()
    server.unref()
    server.on('error', () => resolve(findFreePort(startPort + 1)))
    server.listen({ host: '127.0.0.1', port: startPort }, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

async function waitForHttp(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await wait(500)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    shell: options.shell || false,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', chunk => process.stdout.write(chunk))
  child.stderr.on('data', chunk => process.stderr.write(chunk))
  return child
}

async function main() {
  const backendPort = await findFreePort(8000)
  const frontendPort = await findFreePort(5173)
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const frontendUrl = `http://127.0.0.1:${frontendPort}`

  if (!fs.existsSync(backendPy)) {
    throw new Error(`Missing backend entrypoint: ${backendPy}`)
  }

  const backend = spawnLogged(python, [backendPy], {
    cwd: backendDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(backendPort) }
  })

  backend.on('exit', code => {
    if (code !== 0) process.exitCode = code || 1
  })

  await waitForHttp(`${backendUrl}/api/health`)
  console.log(`Backend hosting link: ${backendUrl}/api/health`)

  if (!fs.existsSync(viteCmd)) {
    throw new Error(`Missing frontend Vite binary: ${viteCmd}. Run npm install in the frontend folder.`)
  }

  console.log(`Starting frontend on http://127.0.0.1:${frontendPort}`)
  const frontend = spawnLogged(process.platform === 'win32' ? 'cmd.exe' : viteCmd, process.platform === 'win32'
    ? ['/c', viteCmd, '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort']
    : ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
    cwd: frontendDir,
    env: { ...process.env, VITE_API_BASE_URL: '/api', BACKEND_PORT: String(backendPort), VITE_BACKEND_PORT: String(backendPort) }
  })

  frontend.on('exit', code => {
    if (code !== 0) process.exitCode = code || 1
  })

  console.log(`Frontend hosting link: ${frontendUrl}`)
  await waitForHttp(frontendUrl)

  const electronBin = process.platform === 'win32'
    ? path.join(frontendDir, 'node_modules', '.bin', 'electron.cmd')
    : path.join(frontendDir, 'node_modules', '.bin', 'electron')
  if (!fs.existsSync(electronBin)) {
    throw new Error(`Missing Electron binary: ${electronBin}. Run npm install in the frontend folder.`)
  }

  const electron = spawnLogged(process.platform === 'win32' ? 'cmd.exe' : electronBin, process.platform === 'win32'
    ? ['/c', electronBin, electronMain]
    : [electronMain], {
    cwd: frontendDir,
    env: { ...process.env, FRONTEND_URL: frontendUrl }
  })

  electron.on('exit', code => {
    if (code !== 0) process.exitCode = code || 1
  })

  const stop = () => {
    backend.kill()
    frontend.kill()
    electron.kill()
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main().catch(err => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exit(1)
})
