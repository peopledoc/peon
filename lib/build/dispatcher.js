const Build = require('./build')
const {
  watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
  webhooks: { enabled: webhooksEnabled }
} = require('../config')
const status = require('../status/status')
const logger = require('../utils/logger')('dispatcher')
const { extractRepoName } = require('../utils/misc')
const Queue = require('../utils/queue')

class Dispatcher {
  constructor() {
    this.queue = new Queue()
  }

  async dispatch(eventType, payload) {
    let repoConfig = this.findRepositoryToHandle(eventType, payload)

    if (!repoConfig) {
      return
    }

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

  findRepositoryToHandle(eventType, payload) {
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

module.exports = Dispatcher
