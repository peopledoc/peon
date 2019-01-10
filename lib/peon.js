const { repositories } = require('./config')

const Watcher = require('./watcher')
const Dispatcher = require('./dispatcher')

module.exports = function() {
  let dispatcher = new Dispatcher()

  Object.keys(repositories).forEach((repoName) => {
    let repoUrl = repositories[repoName]

    let watcher = new Watcher(repoName, repoUrl)
    watcher.on('change', (commitSHA) => {
      // eslint-disable-next-line no-console
      console.log(`${repoName} changed, new SHA for master: ${commitSHA}`)

      dispatcher.dispatch('push', {
        ref: 'refs/heads/master',
        head: commitSHA,
        repository: {
          // eslint-disable-next-line camelcase
          ssh_url: repoUrl
        }
      })
    })
  })
}
