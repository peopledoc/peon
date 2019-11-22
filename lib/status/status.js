const { remove } = require('fs-extra')
const { lookup, registerForTest, registerLazy } = require('../injections')

class Status {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('status')
    }
    return this._logger
  }

  async abortStaleBuilds() {
    let { db, githubStatus } = lookup()

    let stepInfo = '(stale build was aborted)'

    for (let { id } of await db.getStaleBuilds()) {
      for (let { description, status: stepStatus, output } of await db.getSteps(
        id
      )) {
        if (stepStatus === 'running') {
          await db.updateStep({
            buildId: id,
            description,
            status: 'failed',
            output: output ? `${output}\n${stepInfo}` : stepInfo
          })
        }
      }

      await db.updateBuild({ id, status: 'cancelled' })
      githubStatus.update(id, 'error', 'Peon stale build was aborted')
    }
  }

  async cleanupLocalBuilds(repoName, refMode, ref) {
    let { logger } = this
    let { db } = lookup()

    for (let { id, status, extra } of await db.getBuildsFor({ repoName, refMode, ref })) {
      if (status !== 'success' || !extra) {
        continue
      }

      let { localDirectory } = extra

      if (!localDirectory) {
        continue
      }

      logger.debug(
        `removing local build #${id} at ${localDirectory}`,
        { module: 'status' }
      )

      await remove(localDirectory)
      await db.updateBuild({
        id,
        status: 'cleaned'
      })
    }
  }

  // Returns buildId
  async startBuild(repoUrl, repoName, refMode, ref, sha) {
    let { db, githubStatus, renderer } = lookup()

    let repo = await db.getOrCreateRepo({ name: repoName, url: repoUrl })
    let buildId = await db.createBuild({ repoId: repo.id, refMode, ref, sha })

    githubStatus.update(buildId, 'pending', 'Peon build is queued')

    renderer.render()

    return buildId
  }

  async updateBuildStep(buildId, description, status, output) {
    let { db, githubStatus, renderer } = lookup()

    await db.updateStep({ buildId, description, status, output })

    githubStatus.update(
      buildId,
      'pending',
      `Peon build is running '${description}'`
    )

    renderer.render()
  }

  async finishBuild(buildId, buildStatus, extra) {
    let { db, githubStatus, renderer } = lookup()

    await db.updateBuild({ id: buildId, status: buildStatus, extra })

    githubStatus.update(
      buildId,
      buildStatus === 'success' ? 'success' : 'failure',
      buildStatus === 'success'
        ? 'Peon build is finished'
        : buildStatus === 'cancelled'
          ? 'Peon build was cancelled'
          : 'Peon build has failed'
    )

    renderer.render()
  }
}

registerForTest(Status)
registerLazy('status', () => new Status())
