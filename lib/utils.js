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

  decodeGithubURL(url) {
    if (url.startsWith('ssh://')) {
      let [, , , org, repo] = url.split('/')
      return { org, repo: repo.replace(/\.git$/, '') }
    } else if (url.startsWith('git@')) {
      let [, orgRepo] = url.split(':')
      let [org, repo] = orgRepo.split('/')
      return { org, repo: repo.replace(/\.git$/, '') }
    } else {
      throw new Error(`Cannot decode github URL ${url}`)
    }
  }
}
