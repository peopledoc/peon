const { resolve } = require('path')
const { mkdir, readFile, writeFile } = require('fs-extra')

const { workingDirectory } = require('./config')
const statusRoot = resolve(workingDirectory, 'peon-status')

/* Locking mechanism */

const locks = {}

function acquireLock(lock) {
  function tryAcquire(lock, then) {
    if (locks[lock]) {
      setTimeout(() => tryAcquire(lock, then), 1000)
    } else {
      locks[lock] = true
      setTimeout(then, 0)
    }
  }
  return new Promise((resolve) => tryAcquire(lock, resolve))
}

function releaseLock(lock) {
  locks[lock] = false
}

/* Locked repo status updates */

async function updateRepoStatus(repoName, updater) {
  let ret

  await acquireLock(repoName)
  try {
    let statusFile = resolve(statusRoot, `${repoName}.json`)

    try {
      await mkdir(statusRoot, { recursive: true })
    } catch(e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }

    let repoStatus
    try {
      repoStatus = JSON.parse(await readFile(statusFile))
    } catch(e) {
      repoStatus = {
        nextBuildNum: 1,
        builds: {}
      }
    }

    ret = updater(repoStatus)

    await writeFile(statusFile, JSON.stringify(repoStatus))
  } finally {
    releaseLock(repoName)
  }

  return ret
}

/* Public interface */

module.exports = {
  // Returns buildId
  async startBuild(repoName, branch, sha) {
    return await updateRepoStatus(repoName, (repoStatus) => {
      let buildNum = repoStatus.nextBuildNum
      repoStatus.nextBuildNum++
      let buildId = `${repoName}#${buildNum}`

      repoStatus.builds[buildId] = {
        branch,
        sha,
        enqueued: Date.now(),
        status: 'pending',
        steps: []
      }

      return buildId
    })
  },

  async updateBuildStep(buildId, description, status, output) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus) => {
      let build = repoStatus.builds[buildId]
      build.status = 'running'
      if (!('start' in build)) {
        build.start = Date.now()
      }

      let { steps } = build
      let step = steps.find((s) => s.description === description)
      if (!step) {
        step = { description, start: Date.now() }
        steps.push(step)
      }
      step.status = status
      step.output = output

      if (status === 'success' || status === 'failed') {
        step.end = Date.now()
        step.duration = step.end - step.start
      }
    })
  },

  async finishBuild(buildId, buildStatus) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus) => {
      let build = repoStatus.builds[buildId]

      build.status = buildStatus
      build.end = Date.now()
      build.duration = build.end - build.start
    })
  }
}
