const { tmpdir } = require('os')
const { dirname, join, resolve } = require('path')

const { exec } = require('child-process-promise')
const { move, mkdir, mkdtemp, readFile, remove, stat } = require('fs-extra')
const yaml = require('js-yaml')
const Git = require('nodegit')
const Rsync = require('rsync')

const { restoreCache, saveCache } = require('./cache')
const { destinations, workingDirectory } = require('../config')
const status = require('../status/status')
const logger = require('../utils/logger')('build')
const { gitFetchOpts } = require('../utils/misc')
const Queue = require('../utils/queue')

const reposDirectory = resolve(workingDirectory, 'repos')

class CancelBuild extends Error {}
class BuildWarning extends Error {
  constructor(originalError) {
    super(originalError.message)
    this.originalError = originalError
  }
}

class Build {
  constructor(buildId, payload, repoConfig) {
    this.buildId = buildId

    this.sha = payload.head_commit.id

    this.repoName = repoConfig.name
    this.repoURL = repoConfig.url
    this.branch = repoConfig.branch

    this.repoPath = resolve(reposDirectory, this.repoName)
  }

  debug(msg) {
    logger.debug(msg, { module: `build/${this.buildId}` })
  }

  info(msg) {
    logger.info(msg, { module: `build/${this.buildId}` })
  }

  warn(msg) {
    logger.warn(msg, { module: `build/${this.buildId}` })
  }

  error(msg) {
    logger.error(msg, { module: `build/${this.buildId}` })
  }

  async build() {
    let { buildId, sha } = this

    this.start = new Date()
    this.info(`building commit ${sha}`)

    try {
      await this._runStep('update repository', () => this._updateRepository())
      await this._runStep('create workspace', () => this._createWorkspace())
      await this._runStep('read .peon.yml', () => this._readPeonConfig())

      let { peonConfig } = this

      if (peonConfig.cache && peonConfig.cache.length) {
        await this._runStep('restore cache', () => this._restoreCache())
      }

      for (let command of peonConfig.commands) {
        await this._runStep(`run ${command}`, (updateOutput) =>
          this._runCommand(command, updateOutput)
        )
      }

      if (peonConfig.cache && peonConfig.cache.length) {
        await this._runStep('save cache', () => this._saveCache())
      }

      await this._runStep('deploy', () => this._deploy())

      let {
        destination: { absoluteUrl },
        pathInDestination
      } = this

      // We cannot use path.join here because of the protocol:// prefix
      if (!absoluteUrl.endsWith('/')) {
        absoluteUrl = `${absoluteUrl}/`
      }
      await status.finishBuild(buildId, 'success', {
        outputURL: `${absoluteUrl}${pathInDestination}`
      })
    } catch(e) {
      if (e instanceof CancelBuild) {
        this.info(`cancelled build, ${e.message}`)
        await status.finishBuild(buildId, 'cancelled')
      } else {
        this.error(e.stack)
        await status.finishBuild(buildId, 'failed')
      }
    } finally {
      if (this.workspace && (await stat(this.workspace)).isDirectory()) {
        await remove(this.workspace)
      }
    }
  }

  async _runStep(stepName, step) {
    let { buildId } = this

    function updateStep(stepStatus, output) {
      return status.updateBuildStep(buildId, stepName, stepStatus, output)
    }

    let updateQueue = new Queue()
    // Passed to steps, can be called to queue an update of the step output
    function updateOutput(output) {
      updateQueue.run(() => updateStep('running', output))
    }

    this.debug(`running step: ${stepName}`)
    await updateStep('running')

    let output
    try {
      output = await step(updateOutput)
      await updateQueue.join()
    } catch(e) {
      await updateQueue.join()
      if (e instanceof BuildWarning) {
        this.warn(`error during step '${stepName}'`)
        this.warn(e.originalError)
        await updateStep('failed', e.message)
        return
      } else {
        this.error(`error during step '${stepName}'`)
        await updateStep('failed', e.message)
        throw e
      }
    }

    await updateStep('success', output)
  }

  async _updateRepository() {
    let { repoPath, repoURL } = this

    let repo, cloned
    try {
      repo = await Git.Repository.open(repoPath)
      this.debug(`opened repo from ${repoPath}`)
    } catch(e) {
      // eslint-disable-next-line new-cap
      repo = await Git.Clone(repoURL, repoPath, { fetchOpts: gitFetchOpts })
      this.debug(`cloned repo into ${repoPath}`)
      cloned = true
    }

    if (!cloned) {
      await repo.fetch('origin', gitFetchOpts)
    }
  }

  async _createWorkspace() {
    let { repoName, repoPath, sha } = this

    let workspace = (this.workspace = await mkdtemp(
      resolve(tmpdir(), `peon-workspace-${repoName}-`)
    ))

    this.debug(`cloning into ${workspace}`)

    // eslint-disable-next-line new-cap
    let tmpRepo = await Git.Clone(repoPath, workspace)
    let ref = await tmpRepo.createBranch('peon-build', sha)

    this.debug(`checking out ${sha}`)
    await tmpRepo.checkoutRef(ref)
  }

  async _readPeonConfig() {
    let { workspace, branch, buildId, start, repoName, sha } = this

    // Load config file
    let peonConfig = (this.peonConfig = yaml.safeLoad(
      await readFile(resolve(workspace, '.peon.yml'))
    ))

    // Check mandatory parameters
    if (typeof peonConfig.output !== 'string') {
      throw new Error('missing output parameter in .peon.yml')
    }

    if (
      !Array.isArray(peonConfig.commands)
      || peonConfig.commands.length === 0
    ) {
      throw new Error('no build commands in .peon.yml')
    }

    // Check if branch can be built
    if (peonConfig.branches && peonConfig.branches.indexOf(branch) === -1) {
      throw new CancelBuild(`branch ${branch} is not present in .peon.yml`)
    }

    // Find a matching destination
    let matchingDestination, pathInDestination
    for (let destination of peonConfig.destinations || []) {
      if (!(destination.name in destinations)) {
        throw new Error(
          `unknown build destination: '${destination.name}' in .peon.yml`
        )
      }

      if (!destination.branch || new RegExp(destination.branch).test(branch)) {
        matchingDestination = destinations[destination.name]

        if (destination.path) {
          pathInDestination = destination.path.replace('$branch', branch)

          // Prevent trying to get out of destination
          if (
            pathInDestination.startsWith('../')
            || pathInDestination.endsWith('/..')
            || pathInDestination.indexOf('/../') !== -1
          ) {
            throw new Error(
              `invalid relative destination path '${
                destination.path
              }' (resolves to '${pathInDestination}') in .peon.yml`
            )
          }
        } else {
          pathInDestination = `${repoName}/${branch}`
        }

        break
      }
    }

    if (!matchingDestination) {
      throw new Error(
        `could not find a destination matching branch '${branch}' in .peon.yml`
      )
    }

    this.destination = matchingDestination
    this.pathInDestination = pathInDestination

    // Setup peon environment variables
    this.env = {
      PEON_BUILD_ID: buildId,
      PEON_BUILD_DATE: start.toISOString(),
      PEON_ROOT_URL: join(matchingDestination.rootUrl, pathInDestination),
      PEON_BRANCH: branch,
      PEON_COMMIT: sha
    }

    // Evaluate environment from config
    for (let key in peonConfig.environment || {}) {
      this.env[key] = peonConfig.environment[key].replace(
        /\$(\w+)/g,
        (match, variable) => {
          return this.env[variable] || ''
        }
      )
    }
  }

  async _restoreCache() {
    let {
      repoName,
      workspace,
      peonConfig: { cache }
    } = this

    try {
      let restoredPaths = await restoreCache(repoName, workspace, cache)

      return restoredPaths.length
        ? `restored paths ${restoredPaths.join(', ')}`
        : 'found nothing to restore'
    } catch(e) {
      throw new BuildWarning(e)
    }
  }

  async _saveCache() {
    let {
      repoName,
      workspace,
      peonConfig: { cache }
    } = this

    try {
      let savedPaths = await saveCache(repoName, workspace, cache)
      return savedPaths.length
        ? `saved paths ${savedPaths.join(', ')}`
        : 'found nothing to save'
    } catch(e) {
      throw new BuildWarning(e)
    }
  }

  async _runCommand(command, updateOutput) {
    let { workspace, env } = this

    let promise = exec(command, { cwd: workspace, env })
    let outputLines = []

    promise.childProcess.stdout.on('data', (data) => {
      outputLines.push(`[stdout] ${data.toString()}`)
      updateOutput(outputLines.join(''))
    })

    promise.childProcess.stderr.on('data', (data) => {
      outputLines.push(`[stderr] ${data.toString()}`)
      updateOutput(outputLines.join(''))
    })

    await promise
    return outputLines.join('')
  }

  async _deploy() {
    let {
      workspace,
      peonConfig,
      repoName,
      sha,
      destination,
      pathInDestination
    } = this

    let outputDir = resolve(workspace, peonConfig.output)

    if (!(await stat(outputDir)).isDirectory()) {
      throw new Error(`output directory ${peonConfig.output} not found`)
    }

    let isRemote = destination.destination.indexOf(':') !== -1
    let destDir, tmpDir

    if (isRemote) {
      // Create a temporary directory with the relative destination path inside
      // so that rsync will create missing intermediate directories
      // eg. if destination is host:/destination and destPath is repo/branch,
      // instead of doing rsync outputDir/ host:/destination/repo/branch/, which
      // would fail if repo/branch does not exist remotely, we first move
      // outputDir to TMPDIR/repo/branch then rsync TMPDIR/ host:/destination/
      tmpDir = await mkdtemp(resolve(tmpdir(), `peon-output-${repoName}-`))
      let movedOutput = resolve(tmpDir, pathInDestination)
      try {
        await mkdir(dirname(movedOutput), {
          recursive: true
        })
      } catch(e) {
        if (e.code !== 'EEXIST') {
          throw e
        }
      }
      this.debug(`moving ${outputDir} to ${movedOutput}`)
      await move(outputDir, movedOutput)
      destDir = destination.destination
      outputDir = tmpDir
    } else {
      // Create intermediate directories
      destDir = resolve(destination.destination, pathInDestination)
      try {
        await mkdir(destDir, { recursive: true })
      } catch(e) {
        if (e.code !== 'EEXIST') {
          throw e
        }
      }
    }

    this.info(`copying output to ${destDir}`)

    if (!outputDir.endsWith('/')) {
      outputDir = `${outputDir}/`
    }

    if (!destDir.endsWith('/')) {
      destDir = `${destDir}/`
    }

    let rsync = new Rsync()
      .set('partial')
      .set('recursive')
      .set('compress')
      .source(outputDir)
      .destination(destDir)

    if (isRemote && destination.shell) {
      rsync = rsync.shell(destination.shell)
    }

    this.debug(`running ${rsync.command()}`)
    await new Promise((resolve, reject) =>
      rsync.execute((err) => (err ? reject(err) : resolve()))
    )

    if (tmpDir) {
      await remove(tmpDir)
    }

    this.info(`built ${sha} successfully`)
  }
}

module.exports = Build
