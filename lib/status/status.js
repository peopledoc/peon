const { resolve } = require('path')
const { mkdir, readFile, remove, writeFile } = require('fs-extra')

const { lookup, register, registerLazy } = require('../injections')

class Status {
  get statusRoot() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'status')
  }

  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('status')
    }
    return this._logger
  }

  async _ensureDirsExist() {
    let { statusRoot } = this

    try {
      await mkdir(statusRoot, { recursive: true })
    } catch(e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }
  }

  async _updateRepoStatus(repoName, updater) {
    let { logger, statusRoot } = this
    let ret, repoStatus
    let now = Date.now()

    try {
      await this._ensureDirsExist()

      let statusFile = resolve(statusRoot, `${repoName}.json`)

      try {
        repoStatus = JSON.parse(await readFile(statusFile))
      } catch(e) {
        repoStatus = {
          nextBuildNum: 1,
          builds: {}
        }
      }

      ret = await updater(repoStatus, now)

      await writeFile(statusFile, JSON.stringify(repoStatus))
    } catch(e) {
      logger.error(`could not update status for ${repoName}`, {
        module: 'status'
      })
      logger.error(e.stack, { module: 'status' })
      return
    }

    let { renderer } = lookup()

    try {
      await renderer.render(Date.now())
    } catch(e) {
      logger.error('could not render status pages', { module: 'status' })
      logger.error(e.stack, { module: 'status' })
      return
    }

    return ret
  }

  // Returns buildId
  async startBuild(repoUrl, repoName, refMode, ref, sha) {
    return await this._updateRepoStatus(repoName, (repoStatus, now) => {
      let buildNum = repoStatus.nextBuildNum
      repoStatus.nextBuildNum++
      let buildId = `${repoName}#${buildNum}`

      let { githubStatus } = lookup()
      githubStatus.update(
        repoUrl,
        buildId,
        sha,
        'pending',
        'Peon build is queued'
      )

      repoStatus.builds[buildId] = {
        branch: refMode === 'branch' ? ref : null,
        tag: refMode === 'tag' ? ref : null,
        sha,
        url: repoUrl,
        enqueued: now,
        updated: now,
        status: 'pending',
        steps: []
      }

      return buildId
    })
  }

  async updateBuildStep(buildId, description, status, output) {
    let [repoName] = buildId.split('#')

    await this._updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]

      let { githubStatus } = lookup()
      githubStatus.update(
        build.url,
        buildId,
        build.sha,
        'pending',
        `Peon build is running '${description}'`
      )

      build.status = 'running'
      build.updated = now
      if (!('start' in build)) {
        build.start = now
      }

      let { steps } = build
      let step = steps.find((s) => s.description === description)
      if (!step) {
        step = { description, start: now }
        steps.push(step)
      }
      step.status = status
      step.output = output

      if (status === 'success' || status === 'failed') {
        step.end = now
        step.duration = step.end - step.start
      }
    })
  }

  async finishBuild(buildId, buildStatus, extra) {
    let [repoName] = buildId.split('#')

    await this._updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]

      let { githubStatus } = lookup()
      githubStatus.update(
        build.url,
        buildId,
        build.sha,
        buildStatus === 'success' ? 'success' : 'failure',
        buildStatus === 'success'
          ? 'Peon build is finished'
          : buildStatus === 'cancelled'
            ? 'Peon build was cancelled'
            : 'Peon build has failed'
      )

      build.status = buildStatus
      build.end = now
      build.updated = now
      build.duration = build.end - build.start
      build.extra = extra
    })
  }

  async cleanupLocalBuilds(repoName, refMode, ref) {
    let { logger } = this

    logger.info(
      `cleaning up local builds for ${refMode} ${ref} on ${repoName}`,
      { module: 'status' }
    )

    await this._updateRepoStatus(repoName, async(repoStatus) => {
      for (let buildId in repoStatus.builds) {
        let build = repoStatus.builds[buildId]
        let { branch, tag, status, extra } = build

        if (
          ((refMode === 'branch' && branch === ref)
            || (refMode === 'tag' && tag === ref))
          && status == 'success'
          && extra
          && extra.localDirectory
          && !extra.localCleaned
        ) {
          logger.debug(
            `removing local build ${buildId} at ${extra.localDirectory}`,
            { module: 'status' }
          )

          await remove(extra.localDirectory)
          extra.localCleaned = true
        }
      }
    })
  }
}

register(Status)
registerLazy('status', () => new Status())
