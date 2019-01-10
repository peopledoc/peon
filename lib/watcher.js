/* eslint-env node */

const Git = require('nodegit')
const EventEmitter = require('events')
const { mkdir: mkdirAsync } = require('fs')
const { resolve } = require('path')
const [mkdir] = [mkdirAsync].map(require('util').promisify)

const config = require('./config')

const WATCHER_INTERVAL = 5 * 1000

class Watcher extends EventEmitter {
  constructor(repoName, repoUrl) {
    super()

    this.repoName = repoName
    this.repoUrl = repoUrl

    this.checkUpdates()
  }

  async checkUpdates() {
    try {
      // eslint-disable-next-line no-console
      console.log(`checking ${this.repoName} for updates`)

      let repo, currentSHA
      let cloned = false
      let repoPath = resolve(config.workingDirectory, this.repoName)

      try {
        await mkdir(config.workingDirectory)
      } catch(e) {
        if (e.code !== 'EEXIST') {
          throw e
        }
      }

      try {
        repo = await Git.Repository.open(repoPath)
      } catch(e) {
        // eslint-disable-next-line new-cap
        repo = await Git.Clone(this.repoUrl, repoPath)
        cloned = true
      }

      if (!cloned) {
        currentSHA = (await repo.getBranchCommit('origin/master')).sha()
        await repo.fetch('origin')
      }
      let newSHA = (await repo.getBranchCommit('origin/master')).sha()

      if (newSHA !== currentSHA) {
        this.emit('change', newSHA)
      }
    } finally {
      setTimeout(() => this.checkUpdates(), WATCHER_INTERVAL)
    }
  }
}

module.exports = Watcher
