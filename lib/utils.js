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
  }
}
