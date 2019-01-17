const {
  watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
  webhooks: { enabled: webhooksEnabled }
} = require('./config')
const { extractRepoName } = require('./utils')
const Watcher = require('./watcher')
const Dispatcher = require('./dispatcher')
const webhooks = require('./webhooks')

module.exports = function() {
  let dispatcher = new Dispatcher()

  if (watcherEnabled) {
    for (let repoConfig of watcherRepositories) {
      let { url, branches } = repoConfig
      let repoName = extractRepoName(url)

      let watcher = new Watcher(repoName, url, branches)
      watcher.on('change', (branch, commitSHA) => {
        dispatcher.dispatch('push', {
          ref: `refs/heads/${branch}`,
          head: commitSHA,
          repository: {
            // eslint-disable-next-line camelcase
            ssh_url: url
          }
        })
      })
    }
  }

  if (webhooksEnabled) {
    let webhookServer = webhooks()
    webhookServer.on('push', (repo, data) => dispatcher.dispatch('push', data))
    webhookServer.start()
  }
}
