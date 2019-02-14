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
      repoConfig.name,
      repoConfig.branch,
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
      ref,
      repository: { ssh_url: url }
    } = payload

    if (!ref.startsWith('refs/heads/')) {
      logger.debug(`will not handle non-branch ref ${ref}`, {
        module: 'dispatcher'
      })
      return null
    }

    let branch = ref.replace(/^refs\/heads\//, '')
    let repoName = extractRepoName(url)
    let repoConfig

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

    if (!repoConfig.branches || repoConfig.branches.indexOf(branch) !== -1) {
      return Object.assign({ name: repoName, branch }, repoConfig)
    } else {
      logger.debug(`will not handle ref ${ref}`, {
        module: `dispatcher/${repoName}`
      })
      return null
    }
  }
}

module.exports = Dispatcher
