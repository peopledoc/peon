const { dirname, resolve } = require('path')
const { ensureDir, readdir, readFile, writeFile } = require('fs-extra')

const { lookup, register, registerLazy } = require('../injections')

const templateDir = resolve(dirname(dirname(__dirname)), 'templates')
const templates = ['index', 'repo', 'build']
const templateHelpers = {
  date(timestamp) {
    return new Date(timestamp).toISOString()
  },
  shortsha(sha) {
    return sha.substr(0, 8)
  },
  time(milliseconds) {
    if (typeof milliseconds !== 'number') {
      return ''
    }

    if (milliseconds < 1000) {
      return `${milliseconds}ms`
    } else if (milliseconds < 60000) {
      return `${(milliseconds / 1000).toFixed(1)}s`
    } else {
      let seconds = Math.floor(milliseconds / 1000)
      let min = Math.floor(seconds / 60)
      let sec = `0${seconds % 60}`.substr(-2)
      return `${min}m${sec}s`
    }
  }
}

function sortBuildIDs(a, b) {
  let [, idA] = a.split('#')
  let [, idB] = b.split('#')

  return Number(idA) - Number(idB)
}

function sortBuilds(a, b) {
  return a.updated - b.updated
}

function augmentBuild(build, id, additionalInfo = {}) {
  let [repoName, buildNum] = id.split('#')
  return Object.assign(
    {
      buildId: id,
      repoName,
      buildNum,
      link: `${id.replace(/#/, '/')}.html`,
      refMode: build.branch ? 'branch' : 'tag',
      ref: build.branch || build.tag,
      queueTime: build.start ? build.start - build.enqueued : null,
      runTime: build.end ? build.end - build.start : null
    },
    additionalInfo,
    build
  )
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
      for (let helper in templateHelpers) {
        Handlebars.registerHelper(helper, templateHelpers[helper])
      }

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

  async _ensureDirsExist() {
    let { statusRoot } = this
    await ensureDir(statusRoot)
  }

  async _getLastRender() {
    let { renderInfoFile, lastRender } = this

    if (typeof lastRender === 'undefined') {
      await this._ensureDirsExist()

      try {
        this.lastRender = JSON.parse(await readFile(renderInfoFile)).lastRender
      } catch(e) {
        this.lastRender = 0
      }
    }

    return this.lastRender
  }

  async _setLastRender(now) {
    let { renderInfoFile } = this

    this.lastRender = now

    await this._ensureDirsExist()
    await writeFile(renderInfoFile, JSON.stringify({ lastRender: now }))
  }

  async _readReposStatus() {
    let { statusRoot } = this
    let status = {}

    await this._ensureDirsExist()
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
      let outputFile = resolve(statusDirectory, repoName, `${buildNum}.html`)

      await ensureDir(dirname(outputFile))

      try {
        await writeFile(
          outputFile,
          buildTemplate(
            augmentBuild(buildData, buildId, {
              isRunning: ['pending', 'running'].indexOf(buildData.status) !== -1
            })
          )
        )
      } catch(e) {
        logger.error(`error rendering ${repoName}/${buildNum}.html`, {
          module: 'status/render'
        })
        logger.error(e.stack, { module: 'status/render' })

        throw e
      }
    }
  }

  async _renderRepo(now, repoName, repoStatus) {
    let { logger, repoTemplate } = this
    let { builds } = repoStatus
    let {
      config: { statusDirectory }
    } = lookup()

    let lastRender = await this._getLastRender()

    if (Object.values(builds).some((b) => b.updated > lastRender)) {
      logger.debug(`rendering repo page for ${repoName}`, {
        module: 'status/render'
      })

      let outputFile = resolve(statusDirectory, `${repoName}.html`)

      try {
        await ensureDir(dirname(outputFile))
        await writeFile(
          outputFile,
          repoTemplate({
            now,
            repoName,
            builds: Object.keys(builds)
              .sort(sortBuildIDs)
              .reverse()
              .map((buildId) => augmentBuild(builds[buildId], buildId))
          })
        )
      } catch(e) {
        logger.error(`error rendering ${repoName}.html`, {
          module: 'status/render'
        })
        logger.error(e.stack, { module: 'status/render' })

        throw e
      }

      for (let buildId in builds) {
        await this._renderBuild(buildId, builds[buildId])
      }
    }
  }

  async _renderIndex(now, reposStatus) {
    let { logger, indexTemplate, indexBuildCount } = this

    let {
      config: { statusDirectory }
    } = lookup()

    let allBuilds = []

    for (let repo in reposStatus) {
      let repoStatus = reposStatus[repo]
      let { builds } = repoStatus

      allBuilds.push(
        ...Object.keys(builds).map((buildId) =>
          augmentBuild(builds[buildId], buildId, {
            repoLink: `${repo}.html`
          })
        )
      )
    }

    // Render index
    logger.debug('rendering index', { module: 'status/render' })
    try {
      await writeFile(
        resolve(statusDirectory, 'index.html'),
        indexTemplate({
          now,
          hasData: allBuilds.length > 0,
          builds: allBuilds
            .sort(sortBuilds)
            .reverse()
            .slice(0, indexBuildCount || 100)
        })
      )
    } catch(e) {
      logger.error('error rendering index', { module: 'status/render' })
      logger.error(e.stack, { module: 'status/render' })
      throw e
    }
  }

  async render(now) {
    let { logger } = this

    await this.init()
    let status = await this._readReposStatus()

    for (let repoName in status) {
      await this._renderRepo(now, repoName, status[repoName])
    }

    await this._renderIndex(now, status)
    await this._setLastRender(now)

    logger.debug('finished rendering status pages', { module: 'status/render' })
  }
}

register(Renderer)
registerLazy('renderer', () => new Renderer())
