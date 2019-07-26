/* eslint-disable camelcase */

const requireDirectory = require('require-directory')
const { lookup, register } = require('./injections')

const moduleDirs = ['build', 'status', 'utils', 'watch']

class Peon {
  static loadModules() {
    // Register external modules so they can be mocked
    register('Git', require('nodegit'))
    register('Handlebars', require('handlebars'))
    register('Octokit', require('@octokit/rest'))
    register('Rsync', require('rsync'))
    register('Tar', require('tar'))

    // Load internal modules
    for (let dir of moduleDirs) {
      requireDirectory(module, dir)
    }
  }

  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('peon')
    }
    return this._logger
  }

  async start() {
    let {
      Watcher,
      WebhookServer,
      dispatcher,
      config: {
        watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
        webhooks: { enabled: webhooksEnabled }
      },
      misc: { extractRepoName },
      status
    } = lookup()

    this.logger.info('Starting peon...', { module: 'peon' })

    await status.abortStaleBuilds()

    this.watchers = []
    if (watcherEnabled) {
      for (let repoConfig of watcherRepositories) {
        let { url, branches } = repoConfig
        let repoName = extractRepoName(url)

        let watcher = new Watcher(repoName, url, branches)
        watcher.on('change', (ref, commitSHA) => {
          dispatcher.dispatch('push', {
            ref,
            head_commit: { id: commitSHA },
            repository: {
              ssh_url: url
            }
          })
        })
        watcher.start()

        this.watchers.push(watcher)
      }
    }

    if (webhooksEnabled) {
      this.webhookServer = new WebhookServer()

      this.webhookServer.on('push', (repo, data) =>
        dispatcher.dispatch('push', data)
      )

      await this.webhookServer.start()
    }

    this.logger.info('Peon is ready', { module: 'peon' })
  }

  async stop() {
    this.logger.info('Stopping peon...', { module: 'peon' })

    while (this.watchers.length) {
      let watcher = this.watchers.shift()
      watcher.stop()
    }

    if (this.webhookServer) {
      await this.webhookServer.stop()
      this.webhookServer = null
    }

    this.logger.info('Stopped peon', { module: 'peon' })
  }
}

module.exports = Peon
