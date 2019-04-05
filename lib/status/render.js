const { dirname, resolve } = require('path')
const { ensureDir, readdir, readFile, writeFile } = require('fs-extra')

const { lookup, register, registerLazy } = require('../injections')

const templateDir = resolve(dirname(dirname(__dirname)), 'templates')
const templates = ['index', 'build']

function sortBuilds(a, b) {
  let [, idA] = a.split('#')
  let [, idB] = b.split('#')

  return Number(idA) - Number(idB)
}

class Renderer {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('status')
    }
    return this._logger
  }

  get statusRoot() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'status')
  }

  get renderInfoFile() {
    let { statusRoot } = this
    return resolve(statusRoot, 'peon-status.json')
  }

  async init() {
    let { Handlebars } = lookup()

    if (!this._initDone) {
      Handlebars.registerHelper('date', function(timestamp) {
        return new Date(timestamp).toISOString()
      })

      let { logger } = this

      for (let t of templates) {
        let key = `${t}Template`

        if (!this[key]) {
          logger.debug(`compiling template ${t}`, { module: 'status/render' })
          this[key] = Handlebars.compile(
            (await readFile(resolve(templateDir, `${t}.hbs`))).toString()
          )
        }
      }
    }

    this._initDone = true
  }

  async _getLastRender() {
    let { renderInfoFile, lastRender, statusRoot } = this

    if (typeof lastRender === 'undefined') {
      await ensureDir(statusRoot)

      try {
        this.lastRender = JSON.parse(await readFile(renderInfoFile)).lastRender
      } catch(e) {
        this.lastRender = 0
      }
    }

    return this.lastRender
  }

  async _setLastRender(now) {
    let { renderInfoFile, statusRoot } = this

    this.lastRender = now

    await ensureDir(statusRoot)
    await writeFile(renderInfoFile, JSON.stringify({ lastRender: now }))
  }

  async _readReposStatus() {
    let { statusRoot } = this
    let status = {}

    await ensureDir(statusRoot)
    for (let file of await readdir(statusRoot)) {
      if (file === 'peon-status.json') {
        continue
      }

      status[file.replace(/\.json$/, '')] = JSON.parse(
        await readFile(resolve(statusRoot, file))
      )
    }

    return status
  }

  async _renderBuild(buildId, buildData) {
    let { logger, buildTemplate } = this

    let {
      config: { statusDirectory }
    } = lookup()

    let lastRender = await this._getLastRender()

    if (buildData.updated > lastRender) {
      logger.debug(`rendering build ${buildId}`, {
        module: 'status/render'
      })

      let [repoName, buildNum] = buildId.split('#')

      await ensureDir(resolve(statusDirectory, repoName))
      await writeFile(
        resolve(statusDirectory, repoName, `${buildNum}.html`),
        buildTemplate(
          Object.assign(
            {
              buildId,
              isRunning: ['pending', 'running'].indexOf(buildData.status) !== -1
            },
            buildData
          )
        )
      )
    }
  }

  async _renderRepo(repoStatus) {
    let { builds } = repoStatus
    for (let buildId in builds) {
      await this._renderBuild(buildId, builds[buildId])
    }
  }

  async _renderIndex(now, reposStatus) {
    let { logger, indexTemplate } = this

    let {
      config: { statusDirectory }
    } = lookup()

    for (let repo in reposStatus) {
      let repoStatus = reposStatus[repo]
      let { builds } = repoStatus

      // Extract last 5 builds
      repoStatus.lastBuilds = Object.keys(builds)
        .sort(sortBuilds)
        .reverse()
        .slice(0, 5)
        .map((buildId) =>
          Object.assign(builds[buildId], {
            buildId,
            link: `${buildId.replace(/#/, '/')}.html`
          })
        )

      // Get all successful build IDs in reverse order
      let successfulBuildIds = Object.keys(builds)
        .filter((buildId) => builds[buildId].status === 'success')
        .sort(sortBuilds)
        .reverse()

      // Get a sorted set of successfully built refs
      let builtRefs = [
        ...new Set(
          successfulBuildIds.map(
            (buildId) => builds[buildId].branch || builds[buildId].tag
          )
        )
      ].sort()

      // Push master to the beginning if present
      let masterIndex = builtRefs.indexOf('master')
      if (masterIndex) {
        builtRefs.splice(masterIndex, 1)
        builtRefs.unshift('master')
      }

      // Map successfully built refs to their last successful build
      repoStatus.lastSuccessfulBuildByRef = builtRefs.map(
        (ref) =>
          successfulBuildIds
            .filter((id) => builds[id].branch === ref || builds[id].tag === ref)
            .map((id) => builds[id])[0]
      )
    }

    // Render index
    logger.debug('rendering index', { module: 'status/render' })
    await writeFile(
      resolve(statusDirectory, 'index.html'),
      indexTemplate({
        repos: reposStatus,
        now,
        hasData: Object.keys(reposStatus).length > 0
      })
    )
  }

  async render(now) {
    let { logger } = this

    await this.init()
    let status = await this._readReposStatus()

    for (let repoName in status) {
      await this._renderRepo(status[repoName])
    }

    await this._renderIndex(now, status)
    await this._setLastRender(now)

    logger.debug('finished rendering status pages', { module: 'status/render' })
  }
}

register(Renderer)
registerLazy('renderer', () => new Renderer())
