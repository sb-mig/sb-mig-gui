/**
 * sb-mig Service
 *
 * Provides functionality to execute sb-mig CLI commands with real-time output streaming.
 * Handles credential injection via environment variables.
 */

import { spawn, exec, ChildProcess } from 'child_process'
import { promisify } from 'util'
import { readdir, stat, readFile } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { WebContents } from 'electron'

const execAsync = promisify(exec)

/**
 * Get extended PATH with common node/npm binary locations
 * This is needed because production Electron apps don't inherit shell PATH
 */
function getExtendedPath(): string {
  const home = homedir()
  const existingPath = process.env.PATH || ''

  // Common paths where npm global binaries might be installed
  const additionalPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin', // Homebrew on Apple Silicon
    '/usr/local/opt/node/bin', // Homebrew node on Intel
    `${home}/.npm-global/bin`, // npm configured global
    `${home}/.volta/bin`, // Volta
    `${home}/.asdf/shims`, // asdf
    `${home}/.local/bin`, // pip/pipx style installs
  ]

  // Try to find nvm node versions
  const nvmDir = `${home}/.nvm/versions/node`
  try {
    if (existsSync(nvmDir)) {
      const versions = readdirSync(nvmDir)
      for (const version of versions) {
        additionalPaths.push(`${nvmDir}/${version}/bin`)
      }
    }
  } catch {
    // Ignore if nvm dir doesn't exist
  }

  // Try to find fnm node versions (macOS location)
  const fnmDirMac = `${home}/Library/Application Support/fnm/node-versions`
  try {
    if (existsSync(fnmDirMac)) {
      const versions = readdirSync(fnmDirMac).filter((v) => v.startsWith('v'))

      // First, find which version has sb-mig installed and add it FIRST
      let sbmigVersionPath: string | null = null
      for (const version of versions) {
        const binPath = `${fnmDirMac}/${version}/installation/bin`
        const sbmigPath = `${binPath}/sb-mig`
        if (existsSync(sbmigPath)) {
          sbmigVersionPath = binPath
          additionalPaths.unshift(binPath)
        }
      }

      // Then add other versions
      for (const version of versions) {
        const binPath = `${fnmDirMac}/${version}/installation/bin`
        if (binPath !== sbmigVersionPath && existsSync(binPath)) {
          additionalPaths.push(binPath)
        }
      }
    }
  } catch {
    // Ignore
  }

  // Try to find fnm node versions (Linux location)
  const fnmDirLinux = `${home}/.local/share/fnm/node-versions`
  try {
    if (existsSync(fnmDirLinux)) {
      const versions = readdirSync(fnmDirLinux).filter((v) => v.startsWith('v'))

      let sbmigVersionPath: string | null = null
      for (const version of versions) {
        const binPath = `${fnmDirLinux}/${version}/installation/bin`
        const sbmigPath = `${binPath}/sb-mig`
        if (existsSync(sbmigPath)) {
          sbmigVersionPath = binPath
          additionalPaths.unshift(binPath)
        }
      }

      for (const version of versions) {
        const binPath = `${fnmDirLinux}/${version}/installation/bin`
        if (binPath !== sbmigVersionPath && existsSync(binPath)) {
          additionalPaths.push(binPath)
        }
      }
    }
  } catch {
    // Ignore
  }

  // Also check FNM_DIR env var if set
  const fnmDirEnv = process.env.FNM_DIR
  if (fnmDirEnv) {
    try {
      const nodeVersionsDir = `${fnmDirEnv}/node-versions`
      if (existsSync(nodeVersionsDir)) {
        const versions = readdirSync(nodeVersionsDir).filter((v) => v.startsWith('v'))

        let sbmigVersionPath: string | null = null
        for (const version of versions) {
          const binPath = `${nodeVersionsDir}/${version}/installation/bin`
          const sbmigPath = `${binPath}/sb-mig`
          if (existsSync(sbmigPath)) {
            sbmigVersionPath = binPath
            additionalPaths.unshift(binPath)
          }
        }

        for (const version of versions) {
          const binPath = `${nodeVersionsDir}/${version}/installation/bin`
          if (binPath !== sbmigVersionPath && existsSync(binPath)) {
            additionalPaths.push(binPath)
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  // Combine paths, filtering out duplicates
  const allPaths = [...additionalPaths, ...existingPath.split(':')]
  const uniquePaths = [...new Set(allPaths.filter(Boolean))]

  return uniquePaths.join(':')
}

/**
 * Get environment with extended PATH
 */
function getExtendedEnv(additionalEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: getExtendedPath(),
    ...additionalEnv,
  }
}

/**
 * Discovered component info
 */
export interface DiscoveredComponent {
  name: string
  filePath: string
  type: 'local' | 'external'
}

/**
 * Environment variables for sb-mig
 */
export interface SbmigEnvironment {
  oauthToken?: string
  spaceId?: string
  accessToken?: string
}

/**
 * Result of command execution
 */
export interface CommandResult {
  success: boolean
  exitCode: number | null
  error?: string
}

/**
 * Output event sent to renderer
 */
export interface OutputEvent {
  type: 'stdout' | 'stderr' | 'info' | 'error' | 'complete'
  data: string
  timestamp: number
}

/**
 * Debug/validation result
 */
export interface ValidationResult {
  success: boolean
  version?: string
  config?: Record<string, unknown>
  error?: string
}

class SbMigService {
  private webContents: WebContents | null = null
  private currentProcess: ChildProcess | null = null

  /**
   * Set the webContents to send output events to
   */
  setWebContents(webContents: WebContents): void {
    this.webContents = webContents
  }

  /**
   * Send output event to renderer
   */
  private sendOutput(event: OutputEvent): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('sbmig:output', event)
    }
  }

  /**
   * Build environment variables for sb-mig command
   */
  private buildEnv(env: SbmigEnvironment): NodeJS.ProcessEnv {
    const additionalEnv: Record<string, string> = {}

    if (env.oauthToken) {
      additionalEnv.STORYBLOK_OAUTH_TOKEN = env.oauthToken
    }
    if (env.spaceId) {
      additionalEnv.STORYBLOK_SPACE_ID = env.spaceId
    }
    if (env.accessToken) {
      additionalEnv.STORYBLOK_ACCESS_TOKEN = env.accessToken
    }

    return getExtendedEnv(additionalEnv)
  }

  /**
   * Check if a command is currently running
   */
  isRunning(): boolean {
    return this.currentProcess !== null && !this.currentProcess.killed
  }

  /**
   * Kill the current running process
   */
  killCurrentProcess(): boolean {
    if (this.currentProcess && !this.currentProcess.killed) {
      this.currentProcess.kill('SIGTERM')
      this.sendOutput({
        type: 'info',
        data: 'Process terminated by user',
        timestamp: Date.now(),
      })
      this.currentProcess = null
      return true
    }
    return false
  }

  /**
   * Execute an sb-mig command with real-time output streaming
   */
  async executeCommand(
    command: string,
    args: string[],
    workingDir: string,
    env: SbmigEnvironment
  ): Promise<CommandResult> {
    // Kill any existing process
    if (this.isRunning()) {
      this.killCurrentProcess()
    }

    return new Promise((resolve) => {
      try {
        const fullArgs = command ? [command, ...args] : args

        this.sendOutput({
          type: 'info',
          data: `$ sb-mig ${fullArgs.join(' ')}`,
          timestamp: Date.now(),
        })

        this.currentProcess = spawn('sb-mig', fullArgs, {
          cwd: workingDir,
          env: this.buildEnv(env),
          shell: true,
        })

        this.currentProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          this.sendOutput({
            type: 'stdout',
            data: text,
            timestamp: Date.now(),
          })
        })

        this.currentProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString()
          this.sendOutput({
            type: 'stderr',
            data: text,
            timestamp: Date.now(),
          })
        })

        this.currentProcess.on('error', (error) => {
          this.sendOutput({
            type: 'error',
            data: `Error: ${error.message}`,
            timestamp: Date.now(),
          })
          this.currentProcess = null
          resolve({
            success: false,
            exitCode: null,
            error: error.message,
          })
        })

        this.currentProcess.on('close', (code) => {
          this.sendOutput({
            type: 'complete',
            data: `Process exited with code ${code}`,
            timestamp: Date.now(),
          })
          this.currentProcess = null
          resolve({
            success: code === 0,
            exitCode: code,
          })
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        this.sendOutput({
          type: 'error',
          data: `Error: ${errorMessage}`,
          timestamp: Date.now(),
        })
        this.currentProcess = null
        resolve({
          success: false,
          exitCode: null,
          error: errorMessage,
        })
      }
    })
  }

  /**
   * Validate connection by running sb-mig debug
   */
  async validate(workingDir: string, env: SbmigEnvironment): Promise<ValidationResult> {
    try {
      const envVars = this.buildEnv(env)

      const { stdout, stderr } = await execAsync('sb-mig debug', {
        cwd: workingDir,
        env: envVars,
      })

      const output = stdout + stderr

      return {
        success: true,
        config: {
          raw: output,
          workingDir,
          hasOAuthToken: !!env.oauthToken,
          hasSpaceId: !!env.spaceId,
          hasAccessToken: !!env.accessToken,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get the installed sb-mig version
   */
  async getVersion(): Promise<string | null> {
    const extendedEnv = getExtendedEnv()
    const cwd = homedir()

    try {
      const { stdout: whichOutput } = await execAsync('which sb-mig', {
        env: extendedEnv,
        cwd,
      })
      const sbmigPath = whichOutput.trim()

      if (!sbmigPath) {
        return null
      }

      try {
        const { stdout } = await execAsync('sb-mig --version', {
          env: extendedEnv,
          cwd,
        })
        const lines = stdout.trim().split('\n')
        const version = lines[lines.length - 1].trim()
        return version || 'installed'
      } catch {
        return 'installed'
      }
    } catch {
      return null
    }
  }

  /**
   * Check if sb-mig is installed and accessible
   */
  async isInstalled(): Promise<boolean> {
    const version = await this.getVersion()
    return version !== null
  }

  /**
   * Get debug info about PATH and sb-mig detection
   */
  async getDebugInfo(): Promise<{
    home: string
    fnmDirMac: string
    fnmDirMacExists: boolean
    fnmVersions: string[]
    extendedPath: string
    sbmigFound: boolean
    sbmigVersion: string | null
    error: string | null
  }> {
    const home = homedir()
    const fnmDirMac = `${home}/Library/Application Support/fnm/node-versions`
    const fnmDirMacExists = existsSync(fnmDirMac)
    let fnmVersions: string[] = []

    if (fnmDirMacExists) {
      try {
        fnmVersions = readdirSync(fnmDirMac).filter((v) => v.startsWith('v'))
      } catch {
        // ignore
      }
    }

    const extendedPath = getExtendedPath()
    let sbmigVersion: string | null = null
    let error: string | null = null

    try {
      const { stdout: whichOutput } = await execAsync('which sb-mig', {
        env: getExtendedEnv(),
        cwd: home,
      })
      const sbmigPath = whichOutput.trim()
      if (sbmigPath) {
        try {
          const { stdout } = await execAsync('sb-mig --version', {
            env: getExtendedEnv(),
            cwd: home,
          })
          const lines = stdout.trim().split('\n')
          sbmigVersion = lines[lines.length - 1].trim()
        } catch {
          sbmigVersion = `installed (at ${sbmigPath})`
          error = 'Version check failed - sb-mig requires package.json in working directory'
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    return {
      home,
      fnmDirMac,
      fnmDirMacExists,
      fnmVersions,
      extendedPath,
      sbmigFound: sbmigVersion !== null,
      sbmigVersion,
      error,
    }
  }

  /**
   * Discover local components in the working directory
   */
  async discoverComponents(workingDir: string): Promise<DiscoveredComponent[]> {
    const components: DiscoveredComponent[] = []
    const extensions = ['.sb.js', '.sb.cjs', '.sb.ts']

    let componentDirs = ['src', 'components', 'storyblok']

    try {
      const configFiles = ['storyblok.config.js', 'storyblok.config.cjs', 'storyblok.config.mjs']
      for (const configFile of configFiles) {
        try {
          const configPath = join(workingDir, configFile)
          const configContent = await readFile(configPath, 'utf-8')

          const match = configContent.match(/componentsDirectories\s*:\s*\[([\s\S]*?)\]/)
          if (match) {
            const dirsMatch = match[1].match(/['"]([^'"]+)['"]/g)
            if (dirsMatch) {
              componentDirs = dirsMatch.map((d) => d.replace(/['"]/g, ''))
            }
          }
          break
        } catch {
          // Config file doesn't exist, continue
        }
      }
    } catch {
      // Use default directories
    }

    const scanDir = async (dir: string, isExternal: boolean): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = join(dir, entry.name)

          if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === '.next' || entry.name === 'dist') {
              continue
            }
            const isNowExternal = isExternal || entry.name === 'node_modules'
            await scanDir(fullPath, isNowExternal)
          } else if (entry.isFile()) {
            for (const ext of extensions) {
              if (entry.name.endsWith(ext) && !entry.name.startsWith('_')) {
                const componentName = entry.name.replace(ext, '')
                components.push({
                  name: componentName,
                  filePath: fullPath,
                  type: isExternal ? 'external' : 'local',
                })
                break
              }
            }
          }
        }
      } catch {
        // Directory doesn't exist or can't be read
      }
    }

    for (const dir of componentDirs) {
      const fullDir = join(workingDir, dir)
      try {
        const dirStat = await stat(fullDir)
        if (dirStat.isDirectory()) {
          await scanDir(fullDir, dir.includes('node_modules'))
        }
      } catch {
        // Directory doesn't exist
      }
    }

    // Also scan root
    try {
      const rootEntries = await readdir(workingDir, { withFileTypes: true })
      for (const entry of rootEntries) {
        if (entry.isFile()) {
          for (const ext of extensions) {
            if (entry.name.endsWith(ext) && !entry.name.startsWith('_')) {
              const componentName = entry.name.replace(ext, '')
              if (!components.find((c) => c.name === componentName)) {
                components.push({
                  name: componentName,
                  filePath: join(workingDir, entry.name),
                  type: 'local',
                })
              }
              break
            }
          }
        }
      }
    } catch {
      // Ignore
    }

    // Sort: local first, then by name
    components.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'local' ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })

    return components
  }

  /**
   * Discover datasources in the working directory
   */
  async discoverDatasources(workingDir: string): Promise<DiscoveredComponent[]> {
    const datasources: DiscoveredComponent[] = []
    const extensions = [
      '.datasource.js',
      '.datasource.cjs',
      '.sb.datasource.js',
      '.sb.datasource.cjs',
    ]

    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = join(dir, entry.name)

          if (entry.isDirectory()) {
            if (
              entry.name === '.git' ||
              entry.name === '.next' ||
              entry.name === 'dist' ||
              entry.name === 'node_modules'
            ) {
              continue
            }
            await scanDir(fullPath)
          } else if (entry.isFile()) {
            for (const ext of extensions) {
              if (entry.name.endsWith(ext) && !entry.name.startsWith('_')) {
                const name = entry.name.replace(ext, '').replace('.sb', '')
                datasources.push({
                  name,
                  filePath: fullPath,
                  type: 'local',
                })
                break
              }
            }
          }
        }
      } catch {
        // Skip
      }
    }

    await scanDir(workingDir)
    datasources.sort((a, b) => a.name.localeCompare(b.name))
    return datasources
  }

  /**
   * Discover roles in the working directory
   */
  async discoverRoles(workingDir: string): Promise<DiscoveredComponent[]> {
    const roles: DiscoveredComponent[] = []
    const extensions = ['.sb.roles.js', '.sb.roles.cjs', '.sb.roles.ts']

    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = join(dir, entry.name)

          if (entry.isDirectory()) {
            if (
              entry.name === '.git' ||
              entry.name === '.next' ||
              entry.name === 'dist' ||
              entry.name === 'node_modules'
            ) {
              continue
            }
            await scanDir(fullPath)
          } else if (entry.isFile()) {
            for (const ext of extensions) {
              if (entry.name.endsWith(ext) && !entry.name.startsWith('_')) {
                const name = entry.name.replace(ext, '')
                roles.push({
                  name,
                  filePath: fullPath,
                  type: 'local',
                })
                break
              }
            }
          }
        }
      } catch {
        // Skip
      }
    }

    await scanDir(workingDir)
    roles.sort((a, b) => a.name.localeCompare(b.name))
    return roles
  }
}

// Export singleton instance
export const sbmigService = new SbMigService()

