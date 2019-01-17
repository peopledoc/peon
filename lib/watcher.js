/* eslint-env node */

const Git = require('nodegit')
const EventEmitter = require('events')
const { mkdir } = require('fs-extra')
const { resolve } = require('path')

const {
  workingDirectory,
  watcher: { interval }
} = require('./config')
const logger = require('./logger')
const { gitFetchOpts } = require('./utils')

class Watcher extends EventEmitter {
  constructor(repoName, repoUrl, branches) {
    super()

    logger.info(`creating watcher for ${repoUrl} on ${branches.join(', ')}`, {
      module: `watcher/${repoName}`
    })

    this.repoName = repoName
    this.repoUrl = repoUrl
    this.branches = branches

    this.checkUpdates()
  }

  async checkUpdates() {
    try {
      let repo
      let { repoName, repoUrl, branches } = this
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
        repo = await Git.Clone(repoUrl, repoPath, { fetchOpts: gitFetchOpts })
        logger.debug(`cloned repo into ${repoPath}`, {
          module: `watcher/${repoName}`
        })
        cloned = true
      }

      let currentSHAs = {}
      if (!cloned) {
        for (let branch of branches) {
          currentSHAs[branch] = (await repo.getBranchCommit(
            `origin/${branch}`
          )).sha()
          logger.debug(`current SHA for ${branch} is ${currentSHAs[branch]}`, {
            module: `watcher/${repoName}`
          })
        }

        await repo.fetch('origin', gitFetchOpts)
      }

      for (let branch of branches) {
        let newSHA = (await repo.getBranchCommit(`origin/${branch}`)).sha()
        logger.debug(`updated SHA for ${branch} is ${newSHA}`, {
          module: `watcher/${repoName}`
        })

        if (newSHA !== currentSHAs[branch]) {
          logger.info(`${branch} changed, new SHA is ${newSHA}`, {
            module: `watcher/${repoName}`
          })
          this.emit('change', branch, newSHA)
        }
      }
    } finally {
      setTimeout(() => this.checkUpdates(), interval)
    }
  }
}

module.exports = Watcher
