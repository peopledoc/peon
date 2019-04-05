const { tmpdir } = require('os')
const { dirname, join, resolve } = require('path')
const { exec } = require('child-process-promise')
const { ensureDir, move, mkdtemp, readFile, remove, stat } = require('fs-extra')
const yaml = require('js-yaml')

const { lookup, register } = require('../injections')

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
    this.refMode = repoConfig.refMode
    this.ref = repoConfig.ref
  }

  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('build')
    }
    return this._logger
  }

  get reposDirectory() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'repos')
  }

  get repoPath() {
    let { reposDirectory, repoName } = this
    return resolve(reposDirectory, repoName)
  }

  debug(msg) {
    this.logger.debug(msg, { module: `build/${this.buildId}` })
  }

  info(msg) {
    this.logger.info(msg, { module: `build/${this.buildId}` })
  }

  warn(msg) {
    this.logger.warn(msg, { module: `build/${this.buildId}` })
  }

  error(msg) {
    this.logger.error(msg, { module: `build/${this.buildId}` })
  }

  async build() {
    let { buildId, sha } = this
    let { status } = lookup()

    this.start = new Date()
    this.info(`building commit ${sha}`)

    try {
      await this._runStep('update repository', () => this._updateRepository())
      await this._runStep('create workspace', () => this._createWorkspace())
      await this._runStep('read .peon.yml', () => this._readPeonConfig())

      let { env, peonConfig } = this

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
        outputURL: `${absoluteUrl}${env.evaluate(pathInDestination)}`
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
    let { status, Queue } = lookup()

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
    let { Git, gitFetchOpts } = lookup()
    let { repoPath, repoURL } = this
    let repo, cloned

    try {
      repo = await Git.Repository.open(repoPath)
      this.debug(`opened repo from ${repoPath}`)
    } catch(e) {
      // eslint-disable-next-line new-cap
      repo = await Git.Clone(repoURL, repoPath, {
        fetchOpts: gitFetchOpts
      })
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

    let { Git } = lookup()
    // eslint-disable-next-line new-cap
    let tmpRepo = await Git.Clone(repoPath, workspace)
    let ref = await tmpRepo.createBranch('peon-build', sha)

    this.debug(`checking out ${sha}`)
    await tmpRepo.checkoutRef(ref)
  }

  async _readPeonConfig() {
    let {
      config: { destinations },
      Environment
    } = lookup()
    let { workspace, ref, refMode, buildId, start, repoName, sha } = this

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

    // Check if ref can be built
    if (refMode === 'tag') {
      // Don't build tags unless a matching regexp is present
      if (
        !peonConfig.tags
        || !peonConfig.tags.some((t) => new RegExp(t).test(ref))
      ) {
        throw new CancelBuild(`tag ${ref} is not present in .peon.yml`)
      }
    } else {
      // Build branch when no regexp are present or a matching regexp is present
      if (
        peonConfig.branches
        && !peonConfig.branches.some((b) => new RegExp(b).test(ref))
      ) {
        throw new CancelBuild(`branch ${ref} is not present in .peon.yml`)
      }
    }

    // Find a matching destination
    let matchingDestination, pathInDestination
    for (let destination of peonConfig.destinations || []) {
      if (!(destination.name in destinations)) {
        throw new Error(
          `unknown build destination: '${destination.name}' in .peon.yml`
        )
      }

      let destinationMatches = false
      if (refMode === 'tag') {
        // When building a tag, only match a destination when there is a
        // matching tag regexp
        destinationMatches
          = destination.tag && new RegExp(destination.tag).test(ref)
      } else {
        // When building a branch, match a destination when there is a matching
        // branch regexp or when there is no branch nor tag regexp
        destinationMatches
          = (destination.branch && new RegExp(destination.branch).test(ref))
          || (!destination.branch && !destination.tag)
      }

      if (destinationMatches) {
        matchingDestination = destinations[destination.name]

        if (destination.path) {
          pathInDestination = destination.path

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
          pathInDestination = '$PEON_REPO_NAME/$PEON_REF'
        }

        break
      }
    }

    if (!matchingDestination) {
      throw new Error(
        `could not find a destination matching ${refMode} '${ref}' in .peon.yml`
      )
    }

    this.destination = matchingDestination
    this.pathInDestination = pathInDestination

    // Setup peon environment variables
    this.env = new Environment(
      Object.assign(
        {
          PEON_BUILD_ID: buildId,
          PEON_BUILD_DATE: start.toISOString(),
          PEON_ROOT_URL: join(matchingDestination.rootUrl, pathInDestination),
          PEON_REPO_NAME: repoName,
          PEON_BRANCH: refMode === 'branch' ? ref : '',
          PEON_TAG: refMode === 'tag' ? ref : '',
          PEON_REF: ref,
          PEON_COMMIT: sha
        },
        peonConfig.environment || {}
      )
    )
  }

  async _restoreCache() {
    let { repoName, workspace, peonConfig } = this
    let { cache } = lookup()

    try {
      let restoredPaths = await cache.restoreCache(
        repoName,
        workspace,
        peonConfig.cache
      )

      return restoredPaths.length
        ? `restored paths ${restoredPaths.join(', ')}`
        : 'found nothing to restore'
    } catch(e) {
      throw new BuildWarning(e)
    }
  }

  async _saveCache() {
    let { repoName, workspace, peonConfig } = this
    let { cache } = lookup()

    try {
      let savedPaths = await cache.saveCache(
        repoName,
        workspace,
        peonConfig.cache
      )
      return savedPaths.length
        ? `saved paths ${savedPaths.join(', ')}`
        : 'found nothing to save'
    } catch(e) {
      throw new BuildWarning(e)
    }
  }

  async _runCommand(command, updateOutput) {
    let { workspace, env } = this

    let promise = exec(command, { cwd: workspace, env: env.evaluateAll() })
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
      buildId,
      workspace,
      peonConfig,
      repoName,
      refMode,
      ref,
      sha,
      destination,
      pathInDestination,
      env
    } = this

    let evaluatedPathInDest = env.evaluate(pathInDestination)
    let outputDir = resolve(workspace, peonConfig.output)

    try {
      if (!(await stat(outputDir)).isDirectory()) {
        throw new Error(`output '${peonConfig.output}' is not a directory`)
      }
    } catch(e) {
      if (e.code === 'ENOENT') {
        throw new Error(`output directory '${peonConfig.output}' not found`)
      } else {
        throw e
      }
    }

    let isRemote = destination.destination.indexOf(':') !== -1
    let destDir, tmpDir

    if (isRemote) {
      // Create a temporary directory with the relative destination path inside
      // so that rsync will create missing intermediate directories
      // eg. if destination is host:/destination and destPath is repo/ref,
      // instead of doing rsync outputDir/ host:/destination/repo/ref/, which
      // would fail if repo/ref does not exist remotely, we first move
      // outputDir to TMPDIR/repo/ref then rsync TMPDIR/ host:/destination/
      tmpDir = await mkdtemp(resolve(tmpdir(), `peon-output-${repoName}-`))
      let movedOutput = resolve(tmpDir, evaluatedPathInDest)
      await ensureDir(dirname(movedOutput))
      this.debug(`moving ${outputDir} to ${movedOutput}`)
      await move(outputDir, movedOutput)
      destDir = destination.destination
      outputDir = tmpDir
    } else {
      // Create intermediate directories
      destDir = resolve(destination.destination, evaluatedPathInDest)
      await ensureDir(destDir)
    }

    this.info(`copying output to ${destDir}`)

    if (!outputDir.endsWith('/')) {
      outputDir = `${outputDir}/`
    }

    if (!destDir.endsWith('/')) {
      destDir = `${destDir}/`
    }

    let { Rsync } = lookup()
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

    if (!isRemote) {
      let { cleanup } = lookup()
      await cleanup.registerForCleanup(
        repoName,
        refMode,
        ref,
        buildId,
        destination.destination,
        evaluatedPathInDest
      )
    }

    this.info(`built ${sha} successfully`)
  }
}

register(CancelBuild)
register(BuildWarning)
register(Build)
