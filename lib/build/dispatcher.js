const { lookup, register, registerLazy } = require('../injections')

class Dispatcher {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('build')
    }
    return this._logger
  }

  get queue() {
    if (!this._queue) {
      let { Queue } = lookup()
      this._queue = new Queue()
    }
    return this._queue
  }

  async dispatch(eventType, payload) {
    let { logger } = this
    let repoConfig = this.findRepository(eventType, payload)

    if (!repoConfig) {
      return
    }

    let { status, Build } = lookup()
    let buildId = await status.startBuild(
      repoConfig.url,
      repoConfig.name,
      repoConfig.refMode,
      repoConfig.ref,
      payload.head_commit.id
    )

    let build = new Build(buildId, payload, repoConfig)

    logger.debug(`enqueuing build ${buildId}`, {
      module: `dispatcher/${repoConfig.name}`
    })

    this.queue.run(() => build.build())
  }

  findRepository(eventType, payload) {
    let { logger } = this

    if (eventType !== 'push') {
      logger.debug(`unhandled event ${eventType}`, { module: 'dispatcher' })
      return null
    }

    let {
      ref: fullRef,
      repository: { ssh_url: url }
    } = payload
    let refMode, ref, repoConfig

    if (fullRef.startsWith('refs/heads/')) {
      refMode = 'branch'
      ref = fullRef.replace(/^refs\/heads\//, '')
    } else if (fullRef.startsWith('refs/tags/')) {
      refMode = 'tag'
      ref = fullRef.replace(/^refs\/tags\//, '')
    } else {
      logger.debug(`will not handle unknown ref ${fullRef}`, {
        module: 'dispatcher'
      })
      return null
    }

    let {
      misc: { extractRepoName },
      config: {
        watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
        webhooks: { enabled: webhooksEnabled }
      }
    } = lookup()
    let repoName = extractRepoName(url)

    if (watcherEnabled) {
      repoConfig = watcherRepositories.find((conf) => conf.url === url)
    }

    if (!repoConfig && webhooksEnabled) {
      repoConfig = { url }
    }

    if (!repoConfig) {
      logger.debug(`cannot find configured repo with URL ${url}`, {
        module: 'dispatcher'
      })
      return null
    }

    if (
      refMode === 'branch'
      && repoConfig.branches
      && repoConfig.branches.indexOf(ref) === -1
    ) {
      logger.debug(`will not handle unlisted branch ${ref}`, {
        module: `dispatcher/${repoName}`
      })
      return null
    }

    return Object.assign({ name: repoName, refMode, ref }, repoConfig)
  }
}

register(Dispatcher)
registerLazy('dispatcher', () => new Dispatcher())
