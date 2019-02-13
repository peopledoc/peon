/* eslint-disable camelcase */

const {
  watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
  webhooks: { enabled: webhooksEnabled }
} = require('./config')
const { extractRepoName } = require('./utils')
const Watcher = require('./watcher')
const Dispatcher = require('./dispatcher')
const webhooks = require('./webhooks')
const status = require('./status')

module.exports = async function() {
  await status.init()

  let dispatcher = new Dispatcher()

  if (watcherEnabled) {
    for (let repoConfig of watcherRepositories) {
      let { url, branches } = repoConfig
      let repoName = extractRepoName(url)

      let watcher = new Watcher(repoName, url, branches)
      watcher.on('change', (branch, commitSHA) => {
        dispatcher.dispatch('push', {
          ref: `refs/heads/${branch}`,
          head_commit: { id: commitSHA },
          repository: {
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
