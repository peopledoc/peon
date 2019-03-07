const { resolve } = require('path')
const { mkdir, readFile, writeFile } = require('fs-extra')

const renderStatus = require('./render')
const { statusDirectory, workingDirectory } = require('../config')

const statusRoot = resolve(workingDirectory, 'status')

async function updateRepoStatus(repoName, updater) {
  let ret, repoStatus
  let now = Date.now()

  let statusFile = resolve(statusRoot, `${repoName}.json`)

  try {
    await mkdir(statusRoot, { recursive: true })
  } catch(e) {
    if (e.code !== 'EEXIST') {
      throw e
    }
  }

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
  await renderStatus(now)

  return ret
}

module.exports = {
  async init() {
    try {
      await mkdir(statusRoot, { recursive: true })
    } catch(e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }

    try {
      await mkdir(statusDirectory, { recursive: true })
    } catch(e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }

    await renderStatus(Date.now())
  },

  // Returns buildId
  async startBuild(repoName, branch, sha) {
    return await updateRepoStatus(repoName, (repoStatus, now) => {
      let buildNum = repoStatus.nextBuildNum
      repoStatus.nextBuildNum++
      let buildId = `${repoName}#${buildNum}`

      repoStatus.builds[buildId] = {
        branch,
        sha,
        enqueued: now,
        updated: now,
        status: 'pending',
        steps: []
      }

      return buildId
    })
  },

  async updateBuildStep(buildId, description, status, output) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]
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
  },

  async finishBuild(buildId, buildStatus, extra) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]

      build.status = buildStatus
      build.end = now
      build.updated = now
      build.duration = build.end - build.start
      build.extra = extra
    })
  }
}
