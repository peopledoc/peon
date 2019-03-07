const { dirname, resolve } = require('path')
const { mkdir, readdir, readFile, writeFile } = require('fs-extra')
const Handlebars = require('handlebars')

const { statusDirectory, workingDirectory } = require('../config')
const logger = require('../utils/logger')('status')

const statusJSONDirectory = resolve(workingDirectory, 'status')

Handlebars.registerHelper('date', function(timestamp) {
  return new Date(timestamp).toISOString()
})

const templateDir = resolve(dirname(dirname(__dirname)), 'templates')
const templates = ['index', 'build']
const compiled = {}

module.exports = async function renderStatus(now) {
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
  let renderInfoFile = resolve(statusJSONDirectory, 'peon-status.json')
  let renderInfo
  try {
    renderInfo = JSON.parse(await readFile(renderInfoFile))
  } catch(e) {
    renderInfo = { lastRender: 0 }
  }

  let { lastRender } = renderInfo

  // Load status for all repos
  let status = {}
  for (let file of await readdir(statusJSONDirectory)) {
    if (file === 'peon-status.json') {
      continue
    }

    logger.debug(`reading status file ${file}`, { module: 'status/render' })
    status[file.replace(/\.json$/, '')] = JSON.parse(
      await readFile(resolve(statusJSONDirectory, file))
    )
  }

  for (let repo in status) {
    let repoStatus = status[repo]
    let { builds } = repoStatus

    // Render builds that were updated since last render
    for (let buildId in builds) {
      let build = builds[buildId]

      if (build.updated > lastRender) {
        logger.debug(`rendering build ${buildId}`, { module: 'status/render' })

        let [repoName, buildNum] = buildId.split('#')

        try {
          await mkdir(resolve(statusDirectory, repoName), { recursive: true })
        } catch(e) {
          if (e.code !== 'EEXIST') {
            throw e
          }
        }

        await writeFile(
          resolve(statusDirectory, repoName, `${buildNum}.html`),
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
      .slice(0, 5)
      .map((buildId) =>
        Object.assign(builds[buildId], {
          buildId,
          link: `${buildId.replace(/#/, '/')}.html`
        })
      )

    let builtRefs = [
      ...new Set(
        Object.keys(builds)
          .filter((buildId) => builds[buildId].status === 'success')
          .map((buildId) => builds[buildId].branch || builds[buildId].tag)
      )
    ].sort((a, b) => {
      // Sort branches with master first
      if ((a === 'master' && b !== 'master') || a < b) {
        return -1
      }
      if ((b === 'master' && a !== 'master') || a > b) {
        return 1
      }
      return 0
    })

    repoStatus.lastSuccessfulBuildByRef = builtRefs.map(
      (ref) =>
        Object.values(builds)
          .filter(
            (b) => b.status === 'success' && (b.branch === ref || b.tag === ref)
          )
          .sort((a, b) => b.end - a.end)[0]
    )
  }

  // Render index
  logger.debug('rendering index', { module: 'status/render' })
  await writeFile(
    resolve(statusDirectory, 'index.html'),
    compiled.index({
      repos: status,
      now,
      hasData: Object.keys(status).length > 0
    })
  )

  logger.debug('writing render info', { module: 'status/render' })
  renderInfo.lastRender = now
  await writeFile(renderInfoFile, JSON.stringify(renderInfo))

  logger.debug('finished updating status pages', { module: 'status/render' })
}
