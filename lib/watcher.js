/* eslint-env node */

const Git = require('nodegit')
const EventEmitter = require('events')
const { mkdir } = require('fs-extra')
const { resolve } = require('path')

const { workingDirectory } = require('./config')

const WATCHER_INTERVAL = 5 * 1000

class Watcher extends EventEmitter {
  constructor(repoName, repoUrl, branch) {
    super()

    this.repoName = repoName
    this.repoUrl = repoUrl
    this.branch = branch

    this.checkUpdates()
  }

  async checkUpdates() {
    try {
      // eslint-disable-next-line no-console
      console.log(`checking ${this.repoName} for updates`)

      let repo, currentSHA
      let cloned = false
      let repoPath = resolve(workingDirectory, this.repoName)

      try {
        await mkdir(workingDirectory)
      } catch(e) {
        if (e.code !== 'EEXIST') {
          throw e
        }
      }

      let fetchOpts = {
        callbacks: {
          certificateCheck() {
            return 1
          },
          credentials(url, userName) {
            return Git.Cred.sshKeyFromAgent(userName)
          }
        }
      }

      try {
        repo = await Git.Repository.open(repoPath)
      } catch(e) {
        // eslint-disable-next-line new-cap
        repo = await Git.Clone(this.repoUrl, repoPath, { fetchOpts })
        cloned = true
      }

      if (!cloned) {
        currentSHA = (await repo.getBranchCommit(`origin/${this.branch}`)).sha()
        await repo.fetch('origin', fetchOpts)
      }
      let newSHA = (await repo.getBranchCommit(`origin/${this.branch}`)).sha()

      if (newSHA !== currentSHA) {
        this.emit('change', newSHA)
      }
    } finally {
      setTimeout(() => this.checkUpdates(), WATCHER_INTERVAL)
    }
  }
}

module.exports = Watcher
