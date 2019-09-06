const { resolve } = require('path')
const { mkdir, readFile, writeFile } = require('fs-extra')

const { lookup, register, registerLazy } = require('../injections')

class Status {
  get statusRoot() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'status')
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
    let { statusRoot } = this
    let ret, repoStatus
    let now = Date.now()

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

    ret = updater(repoStatus, now)

    await writeFile(statusFile, JSON.stringify(repoStatus))

    let { renderer } = lookup()
    await renderer.render(Date.now())

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
}

register(Status)
registerLazy('status', () => new Status())
