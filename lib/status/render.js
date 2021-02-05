/* eslint-disable camelcase */

const { createHmac } = require('crypto')
const { dirname, resolve } = require('path')
const { ensureDir, readFile, writeFile } = require('fs-extra')

const { lookup, registerForTest, registerLazy } = require('../injections')

const templateDir = resolve(dirname(dirname(__dirname)), 'templates')

const templates = ['index', 'repo', 'build', 'buildredir']

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

function augmentBuild(build, additionalInfo = {}) {
  return Object.assign(
    build.repo_name ? { repo_link: `${build.repo_name}.html` } : {},
    {
      build_link: `${build.id}.html`,
      queue_time: build.start ? build.start - build.enqueued : null,
      run_time: build.end ? build.end - build.start : null,
      is_cleaned: build.status === 'cleaned'
    },
    additionalInfo,
    build
  )
}

function augmentStep(step, additionalInfo = {}) {
  return Object.assign(
    {
      duration: step.end ? step.end - step.start : null
    },
    additionalInfo,
    step
  )
}

class Renderer {
  constructor() {
    this.lastRender = 0
  }

  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('status')
    }
    return this._logger
  }

  async _init() {
    let {
      Handlebars,
      config: { statusDirectory }
    } = lookup()

    if (!this._initDone) {
      await ensureDir(statusDirectory)

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

  async _renderBuild(repo, build) {
    let { logger, buildTemplate, buildredirTemplate } = this

    let {
      config: {
        statusDirectory,
        webhooks: { url: webhooksUrl, secret: webhooksSecret }
      },
      db
    } = lookup()

    logger.debug(`rendering build ${build.id}`, {
      module: 'status/render'
    })

    let steps = await db.getSteps(build.id)
    let outputFile = resolve(statusDirectory, `${build.id}.html`)

    let retriggerData = null
    let isRunning = ['pending', 'running'].indexOf(build.status) !== -1

    if (webhooksUrl && !isRunning) {
      let payload = JSON.stringify({
        head_commit: {
          id: build.sha
        },
        ref: `refs/${build.ref_type === 'branch' ? 'heads' : 'tags'}/${build.ref}`,
        repository: {
          name: repo.name,
          ssh_url: repo.url
        }
      })

      let signature = `sha1=${createHmac('sha1', webhooksSecret).update(payload).digest('hex')}`

      retriggerData = {
        url: webhooksUrl,
        headers: JSON.stringify({
          'Content-Type': 'application/json',
          'x-github-delivery': 'manual-peon-retrigger',
          'x-github-event': 'push',
          'x-hub-signature': signature
        }),
        payload: `'${payload.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
      }
    }

    let buildData = augmentBuild(build, {
      repo_link: `${repo.name}.html`,
      repo_name: repo.name,
      steps: steps.map((s) => augmentStep(s)),
      is_running: isRunning,
      retrigger: retriggerData
    })

    try {
      await writeFile(outputFile, buildTemplate(buildData))
    } catch(e) {
      logger.error(`error rendering ${build.id}.html`, {
        module: 'status/render'
      })
      logger.error(e.stack, { module: 'status/render' })

      throw e
    }

    if (build.extra && build.extra.oldBuildID) {
      let { id, extra: { oldBuildID } } = build

      let redirectFile = resolve(statusDirectory, `${oldBuildID.replace(/#/g, '/')}.html`)

      try {
        await ensureDir(dirname(redirectFile))
        await writeFile(redirectFile, buildredirTemplate({ id }))
      } catch(e) {
        logger.error('error rendering old build redirection file', {
          module: 'status/render'
        })
        logger.error(e.stack, { module: 'status/render' })

        throw e
      }
    }
  }

  async _renderRepo(now, repo) {
    let { lastRender, logger, repoTemplate } = this
    let {
      config: { statusDirectory },
      db
    } = lookup()

    let builds = await db.getBuilds(repo.id)

    let updatedBuilds = builds.filter((b) => b.updated > lastRender)
    if (updatedBuilds.length) {
      logger.debug(`rendering repo page for ${repo.name}`, {
        module: 'status/render'
      })

      let outputFile = resolve(statusDirectory, `${repo.name}.html`)

      try {
        await writeFile(
          outputFile,
          repoTemplate({
            now,
            repo_name: repo.name,
            builds: builds.map((b) => augmentBuild(b))
          })
        )
      } catch(e) {
        logger.error(`error rendering ${repo.name}.html`, {
          module: 'status/render'
        })
        logger.error(e.stack, { module: 'status/render' })

        throw e
      }

      for (let build of updatedBuilds) {
        await this._renderBuild(repo, build)
      }
    }
  }

  async _renderIndex(now) {
    let { lastRender, logger, indexTemplate } = this

    let {
      config: { statusDirectory, indexBuildCount },
      db
    } = lookup()

    let lastBuilds = await db.getLastUpdatedBuilds(indexBuildCount || 100)
    if (!lastBuilds.length || lastBuilds.some((b) => b.updated > lastRender)) {
      logger.debug('rendering index', { module: 'status/render' })
      try {
        await writeFile(
          resolve(statusDirectory, 'index.html'),
          indexTemplate({
            now,
            buildCount: indexBuildCount || '',
            hasData: lastBuilds.length > 0,
            builds: lastBuilds.map((b) => augmentBuild(b))
          })
        )
      } catch(e) {
        logger.error('error rendering index', { module: 'status/render' })
        logger.error(e.stack, { module: 'status/render' })
        throw e
      }
    }
  }

  async _render() {
    let { logger } = this
    let { db } = lookup()
    let now = Date.now()

    await this._init()

    logger.debug('rendering status pages', {
      module: 'status/render'
    })

    try {
      for (let repo of await db.getRepos()) {
        await this._renderRepo(now, repo)
      }

      await this._renderIndex(now)

      this.lastRender = now

      logger.debug('finished rendering status pages', {
        module: 'status/render'
      })
    } catch(e) {
      logger.error('error rendering status pages', {
        module: 'status/render'
      })
      logger.error(e.stack, { module: 'status/render' })
    }

    if (this.shouldRefresh) {
      this.shouldRefresh = false
      // Start a new async render
      await this._render()
    } else {
      this.rendering = false
    }
  }

  render() {
    if (!this.rendering) {
      // Start an async render
      this.rendering = true
      this._render()
    } else {
      // Already rendering, add refresh marker to render again after current
      // render is finished
      this.shouldRefresh = true
    }
  }
}

registerForTest(Renderer)
registerLazy('renderer', () => new Renderer())
