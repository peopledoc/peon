const Git = require('nodegit')

const {
  git: { authMethod, privateKey, publicKey, keyPassword }
} = require('../config')

module.exports = {
  gitFetchOpts: {
    callbacks: {
      certificateCheck() {
        return 1
      },
      credentials(url, userName) {
        if (authMethod === 'key') {
          return Git.Cred.sshKeyNew(
            userName,
            publicKey,
            privateKey,
            keyPassword
          )
        } else if (authMethod === 'agent') {
          return Git.Cred.sshKeyFromAgent(userName)
        }
      }
    }
  },

  extractRepoName(url) {
    let pathItems = url.replace(/\/$/, '').split('/')
    return pathItems.pop().replace(/\.git$/, '')
  }
}
