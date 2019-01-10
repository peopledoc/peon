const { repositories } = require('./config')

const Watcher = require('./watcher')
const Dispatcher = require('./dispatcher')

module.exports = function() {
  let dispatcher = new Dispatcher()

  Object.keys(repositories).forEach((repoName) => {
    let { url, branch } = repositories[repoName]

    let watcher = new Watcher(repoName, url, branch)
    watcher.on('change', (commitSHA) => {
      // eslint-disable-next-line no-console
      console.log(`${repoName} changed, new SHA for ${branch}: ${commitSHA}`)

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
