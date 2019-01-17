const {
  watcher: { enabled: watcherEnabled, repositories },
  webhooks: { enabled: webhooksEnabled }
} = require('./config')

const Watcher = require('./watcher')
const Dispatcher = require('./dispatcher')
const webhooks = require('./webhooks')

module.exports = function() {
  let dispatcher = new Dispatcher()

  if (watcherEnabled) {
    Object.keys(repositories).forEach((repoName) => {
      let { url, branches } = repositories[repoName]

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
    })
  }

  if (webhooksEnabled) {
    let webhookServer = webhooks()
    webhookServer.on('push', (repo, data) => dispatcher.dispatch('push', data))
    webhookServer.start()
  }
}
