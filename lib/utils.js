const Git = require('nodegit')

module.exports = {
  gitFetchOpts: {
    callbacks: {
      certificateCheck() {
        return 1
      },
      credentials(url, userName) {
        return Git.Cred.sshKeyFromAgent(userName)
      }
    }
  },

  extractRepoName(url) {
    let pathItems = url.replace(/\/$/, '').split('/')
    return pathItems.pop().replace(/\.git$/, '')
  }
}
