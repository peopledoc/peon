const { lookup, register } = require('../injections')

register('gitFetchOpts', {
  callbacks: {
    certificateCheck() {
      return 1
    },
    credentials(url, userName) {
      let {
        Git,
        config: {
          git: { authMethod, privateKey, publicKey, keyPassword }
        }
      } = lookup()

      if (authMethod === 'key') {
        return Git.Cred.sshKeyNew(userName, publicKey, privateKey, keyPassword)
      } else if (authMethod === 'agent') {
        return Git.Cred.sshKeyFromAgent(userName)
      }
    }
  }
})

register('misc', {
  extractRepoName(url) {
    let pathItems = url.replace(/\/$/, '').split('/')
    return pathItems.pop().replace(/\.git$/, '')
  },

  extractGithubRepo(url) {
    if (
      url.startsWith('https://github.com/')
      || url.startsWith('git://github.com/')
      || url.startsWith('git@github.com:')
    ) {
      let [org, repo] = url.replace(/^.*github\.com[:/]/, '').split('/')
      repo = repo.replace(/\.git$/, '')
      return { org, repo }
    }
  }
})
