/* eslint-env node */

const Git = require('nodegit')
const EventEmitter = require('events')
const { mkdir } = require('fs-extra')
const { resolve } = require('path')

const {
  workingDirectory,
  watcher: { interval }
} = require('../config')
const logger = require('../utils/logger')('watcher')
const { gitFetchOpts } = require('../utils/misc')

const reposDirectory = resolve(workingDirectory, 'repos')

class Watcher extends EventEmitter {
  constructor(repoName, repoUrl, branches) {
    super()

    this.info(
      `creating watcher for ${repoUrl} on branches ${branches.join(', ')}`
    )

    this.repoName = repoName
    this.repoUrl = repoUrl
    this.branches = branches

    this.checkUpdates()
  }

  debug(msg) {
    logger.debug(msg, { module: `watcher/${this.repoName}` })
  }

  info(msg) {
    logger.info(msg, { module: `watcher/${this.repoName}` })
  }

  async checkUpdates() {
    try {
      let repo
      let { repoUrl, branches } = this
      let cloned = false
      let repoPath = resolve(reposDirectory, this.repoName)

      try {
        await mkdir(reposDirectory, { recursive: true })
      } catch(e) {
        if (e.code !== 'EEXIST') {
          throw e
        }
      }

      try {
        repo = await Git.Repository.open(repoPath)
        this.debug(`opened repo from ${repoPath}`)
      } catch(e) {
        // eslint-disable-next-line new-cap
        repo = await Git.Clone(repoUrl, repoPath, { fetchOpts: gitFetchOpts })
        this.debug(`cloned repo into ${repoPath}`)
        cloned = true
      }

      let currentSHAs = {}
      if (!cloned) {
        for (let branch of branches) {
          currentSHAs[branch] = (await repo.getBranchCommit(
            `origin/${branch}`
          )).sha()
          this.debug(
            `current SHA for branch ${branch} is ${currentSHAs[branch]}`
          )
        }

        await repo.fetch('origin', gitFetchOpts)
      }

      for (let branch of branches) {
        let newSHA = (await repo.getBranchCommit(`origin/${branch}`)).sha()
        this.debug(`updated SHA for branch ${branch} is ${newSHA}`)

        if (newSHA !== currentSHAs[branch]) {
          this.info(`branch ${branch} changed, new SHA is ${newSHA}`)
          this.emit('change', branch, newSHA)
        }
      }
    } finally {
      setTimeout(() => this.checkUpdates(), interval)
    }
  }
}

module.exports = Watcher
