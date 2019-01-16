/* eslint-env node */

const Git = require('nodegit')
const EventEmitter = require('events')
const { mkdir } = require('fs-extra')
const { resolve } = require('path')

const { workingDirectory } = require('./config')
const logger = require('./logger')
const { gitFetchOpts } = require('./utils')

const WATCHER_INTERVAL = 5 * 1000

class Watcher extends EventEmitter {
  constructor(repoName, repoUrl, branch) {
    super()

    logger.info(`creating watcher for ${repoUrl}#${branch}`, {
      module: `watcher/${repoName}`
    })

    this.repoName = repoName
    this.repoUrl = repoUrl
    this.branch = branch

    this.checkUpdates()
  }

  async checkUpdates() {
    try {
      let repo, currentSHA
      let { repoName, repoUrl, branch } = this
      let cloned = false
      let repoPath = resolve(workingDirectory, this.repoName)

      try {
        await mkdir(workingDirectory)
      } catch(e) {
        if (e.code !== 'EEXIST') {
          throw e
        }
      }

      try {
        repo = await Git.Repository.open(repoPath)
        logger.debug(`opened repo from ${repoPath}`, {
          module: `watcher/${repoName}`
        })
      } catch(e) {
        // eslint-disable-next-line new-cap
        repo = await Git.Clone(repoUrl, repoPath, { gitFetchOpts })
        logger.debug(`cloned repo into ${repoPath}`, {
          module: `watcher/${repoName}`
        })
        cloned = true
      }

      if (!cloned) {
        currentSHA = (await repo.getBranchCommit(`origin/${branch}`)).sha()
        logger.debug(`current SHA is ${currentSHA}`, {
          module: `watcher/${repoName}`
        })
        await repo.fetch('origin', gitFetchOpts)
      }

      let newSHA = (await repo.getBranchCommit(`origin/${branch}`)).sha()
      logger.debug(`updated SHA is ${newSHA}`, {
        module: `watcher/${repoName}`
      })

      if (newSHA !== currentSHA) {
        logger.info(`repo changed, new SHA is ${newSHA}`, {
          module: `watcher/${repoName}`
        })
        this.emit('change', newSHA)
      }
    } finally {
      setTimeout(() => this.checkUpdates(), WATCHER_INTERVAL)
    }
  }
}

module.exports = Watcher
