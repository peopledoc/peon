/* eslint-env node */

const EventEmitter = require('events')
const { mkdir } = require('fs-extra')
const { resolve } = require('path')

const { lookup, register } = require('../injections')

class Watcher extends EventEmitter {
  constructor(repoName, repoUrl, branches) {
    super()

    this.repoName = repoName
    this.repoUrl = repoUrl
    this.branches = branches
  }

  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('watcher')
    }
    return this._logger
  }

  get reposDirectory() {
    let {
      config: { workingDirectory }
    } = lookup()
    return resolve(workingDirectory, 'repos')
  }

  debug(msg) {
    this.logger.debug(msg, { module: `watcher/${this.repoName}` })
  }

  info(msg) {
    this.logger.info(msg, { module: `watcher/${this.repoName}` })
  }

  start() {
    let { repoUrl, branches } = this
    this.info(
      `starting watcher for ${repoUrl} on branches ${branches.join(', ')}`
    )

    this._running = true
    this._schedule()
  }

  stop() {
    this._running = false
    clearTimeout(this._timeout)
  }

  _schedule() {
    let {
      config: {
        watcher: { interval }
      }
    } = lookup()
    this._timeout = setTimeout(() => this._run(), interval)
  }

  async _run() {
    try {
      await this._check()
    } finally {
      if (this._running) {
        this._schedule()
      }
    }
  }

  async _check() {
    let { repo, cloned } = await this._openRepository()
    let currentSHAs = await this._getCurrentSHAs(repo, cloned)
    await this._checkUpdates(repo, cloned, currentSHAs)
  }

  async _openRepository() {
    let repo
    let { repoUrl, reposDirectory } = this
    let cloned = false
    let repoPath = resolve(reposDirectory, this.repoName)

    try {
      await mkdir(reposDirectory, { recursive: true })
    } catch(e) {
      if (e.code !== 'EEXIST') {
        throw e
      }
    }

    let { Git, gitFetchOpts } = lookup()

    try {
      repo = await Git.Repository.open(repoPath)
      this.debug(`opened repo from ${repoPath}`)
    } catch(e) {
      // eslint-disable-next-line new-cap
      repo = await Git.Clone(repoUrl, repoPath, {
        fetchOpts: gitFetchOpts
      })
      this.debug(`cloned repo into ${repoPath}`)
      cloned = true
    }

    return { repo, cloned }
  }

  async _getCurrentSHAs(repo, cloned) {
    let { branches } = this

    let currentSHAs = {}
    if (!cloned) {
      for (let branch of branches) {
        currentSHAs[branch] = (
          await repo.getBranchCommit(`origin/${branch}`)
        ).sha()
        this.debug(`current SHA for branch ${branch} is ${currentSHAs[branch]}`)
      }
    }

    return currentSHAs
  }

  async _checkUpdates(repo, cloned, currentSHAs) {
    let { branches } = this
    let { gitFetchOpts } = lookup()

    if (!cloned) {
      await repo.fetch('origin', gitFetchOpts)
    }

    for (let branch of branches) {
      let newSHA = (await repo.getBranchCommit(`origin/${branch}`)).sha()
      this.debug(`updated SHA for branch ${branch} is ${newSHA}`)

      if (newSHA !== currentSHAs[branch]) {
        this.info(`branch ${branch} changed, new SHA is ${newSHA}`)
        this.emit('change', `refs/heads/${branch}`, newSHA)
      }
    }
  }
}

register(Watcher)
