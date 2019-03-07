const { resolve } = require('path')
const { mkdir, readFile, writeFile } = require('fs-extra')
const Octokit = require('@octokit/rest')

const renderStatus = require('./render')
const {
  statusDirectory,
  statusUrl,
  workingDirectory,
  githubAPIToken
} = require('../config')
const { extractGithubRepo } = require('../utils/misc')
const logger = require('../utils/logger')('status')
const Queue = require('../utils/queue')

const statusRoot = resolve(workingDirectory, 'status')
const GH = githubAPIToken
  ? new Octokit({ auth: `token ${githubAPIToken}` })
  : null
const ghQueue = new Queue()

function updateGithubStatus(repoUrl, buildId, sha, state, description) {
  let githubRepo = extractGithubRepo(repoUrl)
  if (!githubRepo || !GH) {
    return
  }

  ghQueue.run(() =>
    GH.repos
      .createStatus({
        owner: githubRepo.org,
        repo: githubRepo.repo,
        sha,
        state,
        // eslint-disable-next-line camelcase
        target_url: `${statusUrl}${
          statusUrl.endsWith('/') ? '' : '/'
        }${buildId.replace(/#/, '/')}.html`,
        context: 'peon',
        description
      })
      .catch((e) => {
        logger.warn('could not update GitHub status', {
          module: 'status/github'
        })
        logger.warn(e.stack)
      })
  )
}

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
  async startBuild(repoUrl, repoName, refMode, ref, sha) {
    let buildId = await updateRepoStatus(repoName, (repoStatus, now) => {
      let buildNum = repoStatus.nextBuildNum
      repoStatus.nextBuildNum++
      let buildId = `${repoName}#${buildNum}`

      updateGithubStatus(
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

    return buildId
  },

  async updateBuildStep(buildId, description, status, output) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]

      updateGithubStatus(
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
  },

  async finishBuild(buildId, buildStatus, extra) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]

      updateGithubStatus(
        build.url,
        buildId,
        build.sha,
        buildStatus === 'success' ? 'success' : 'failed',
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
