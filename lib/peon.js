/* eslint-disable camelcase */

const {
  watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
  webhooks: { enabled: webhooksEnabled }
} = require('./config')
const Dispatcher = require('./build/dispatcher')
const status = require('./status/status')
const { extractRepoName } = require('./utils/misc')
const Watcher = require('./watch/watcher')
const webhooks = require('./watch/webhooks')

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
