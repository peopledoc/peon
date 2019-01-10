const { repositories } = require('./config')

const Watcher = require('./watcher')
const Dispatcher = require('./dispatcher')
const logger = require('./logger')

module.exports = function() {
  let dispatcher = new Dispatcher()

  Object.keys(repositories).forEach((repoName) => {
    let { url, branch } = repositories[repoName]

    let watcher = new Watcher(repoName, url, branch)
    watcher.on('change', (commitSHA) => {
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
