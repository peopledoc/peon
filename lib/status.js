const { dirname, resolve } = require('path')
const { mkdir, readdir, readFile, writeFile } = require('fs-extra')
const Handlebars = require('handlebars')

const { publicDirectory, workingDirectory } = require('./config')
const logger = require('./logger')

const statusRoot = resolve(workingDirectory, 'peon-status')

Handlebars.registerHelper('date', function(timestamp) {
  return new Date(timestamp).toISOString()
})

const templateDir = resolve(dirname(__dirname), 'templates')
const templates = ['index', 'build']
const compiled = {}

async function renderStatus(now) {
  // Compile templates if not already done
  for (let t of templates) {
    if (!compiled[t]) {
      logger.debug(`compiling template ${t}`, { module: 'status/render' })
      compiled[t] = Handlebars.compile(
        (await readFile(resolve(templateDir, `${t}.hbs`))).toString()
      )
    }
  }

  // Load last render info
  logger.debug('loading render info', { module: 'status/render' })
  let renderInfoFile = resolve(statusRoot, 'peon-status.json')
  let renderInfo
  try {
    renderInfo = JSON.parse(await readFile(renderInfoFile))
  } catch(e) {
    renderInfo = { lastRender: 0 }
  }

  let { lastRender } = renderInfo

  // Load status for all repos
  let status = {}
  for (let file of await readdir(statusRoot)) {
    if (file === 'peon-status.json') {
      continue
    }

    logger.debug(`reading status file ${file}`, { module: 'status/render' })
    status[file.replace(/\.json$/, '')] = JSON.parse(
      await readFile(resolve(statusRoot, file))
    )
  }

  try {
    await mkdir(resolve(publicDirectory, 'peon-status'), { recursive: true })
  } catch(e) {
    if (e.code !== 'EEXIST') {
      throw e
    }
  }

  for (let repo in status) {
    let repoStatus = status[repo]
    let { builds } = repoStatus

    // Render builds that were updated since last render
    for (let buildId in builds) {
      let build = builds[buildId]

      if (build.updated > lastRender) {
        logger.debug(`rendering build ${buildId}`, { module: 'status/render' })
        await writeFile(
          resolve(
            publicDirectory,
            'peon-status',
            `${buildId.replace(/#/, '-')}.html`
          ),
          compiled.build(
            Object.assign(build, {
              buildId,
              isRunning: ['pending', 'running'].indexOf(build.status) !== -1
            })
          )
        )
      }
    }

    // Crunch data for index
    repoStatus.lastBuilds = Object.keys(builds)
      .sort()
      .reverse()
      .slice(0, 10)
      .map((buildId) =>
        Object.assign(builds[buildId], {
          buildId,
          link: `peon-status/${buildId.replace(/#/, '-')}.html`
        })
      )

    let builtBranches = [
      ...new Set(
        Object.keys(builds)
          .filter((buildId) => builds[buildId].status === 'success')
          .map((buildId) => builds[buildId].branch)
      )
    ].sort()

    let masterIndex = builtBranches.indexOf('master')
    if (masterIndex !== -1 && masterIndex !== 0) {
      builtBranches.splice(masterIndex, 0)
      builtBranches.unshift('master')
    }

    repoStatus.builtBranches = builtBranches
  }

  // Render index
  logger.debug('rendering index', { module: 'status/render' })
  await writeFile(
    resolve(publicDirectory, 'index.html'),
    compiled.index({
      repos: status,
      now,
      hasData: Object.keys(status).length > 0
    })
  )

  logger.debug('writing render info', { module: 'status/render' })
  renderInfo.lastRender = now
  await writeFile(renderInfoFile, JSON.stringify(renderInfo))

  logger.info('updated status pages', { module: 'status/render' })
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

  async finishBuild(buildId, buildStatus) {
    let [repoName] = buildId.split('#')

    await updateRepoStatus(repoName, (repoStatus, now) => {
      let build = repoStatus.builds[buildId]

      build.status = buildStatus
      build.end = now
      build.updated = now
      build.duration = build.end - build.start
    })
  }
}
