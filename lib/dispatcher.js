const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { copy, mkdtemp, readFile, remove, stat } = require('fs-extra')

const yaml = require('js-yaml')
const Git = require('nodegit')
const { exec } = require('child-process-promise')

const {
  publicDirectory,
  watcher: { enabled: watcherEnabled, repositories },
  webhooks: { enabled: webhooksEnabled },
  rootURLBase,
  workingDirectory
} = require('./config')
const logger = require('./logger')
const { gitFetchOpts, decodeGithubURL } = require('./utils')

const pending = {}
const building = {}

class CancelBuild extends Error {}

class Dispatcher {
  async dispatch(eventType, payload) {
    let repoConfig = this.findRepositoryToHandle(eventType, payload)
    if (!repoConfig) {
      return
    }

    if (!(repoConfig.name in pending)) {
      pending[repoConfig.name] = []
    }

    pending[repoConfig.name].push({ payload, repoConfig })

    if (!building[repoConfig.name]) {
      logger.debug('triggering build', {
        module: `dispatcher/${repoConfig.name}`
      })
      building[repoConfig.name] = true
      this.triggerBuild(repoConfig.name)
    }
  }

  async triggerBuild(repoName) {
    while (pending[repoName].length) {
      let { payload, repoConfig } = pending[repoName].shift()
      await this.build(payload, repoConfig)
    }

    logger.debug('nothing left to build', { module: `dispatcher/${repoName}` })
    building[repoName] = false
  }

  async build(payload, repoConfig) {
    let repoName = repoConfig.name
    let repoPath = resolve(workingDirectory, repoName)
    let tmpPath = await mkdtemp(resolve(tmpdir(), `peon.${repoName}-`))

    logger.info(`building commit ${payload.head}`, {
      module: `dispatcher/${repoName}`
    })

    let repo, cloned
    try {
      repo = await Git.Repository.open(repoPath)
      logger.debug(`opened repo from ${repoPath}`, {
        module: `dispatcher/${repoName}`
      })
    } catch(e) {
      // eslint-disable-next-line new-cap
      repo = await Git.Clone(repoConfig.url, repoPath, { gitFetchOpts })
      logger.debug(`cloned repo into ${repoPath}`, {
        module: `dispatcher/${repoName}`
      })
      cloned = true
    }

    if (!cloned) {
      await repo.fetch('origin', gitFetchOpts)
    }

    try {
      logger.debug(`cloning into ${tmpPath}`, {
        module: `dispatcher/${repoName}`
      })

      // eslint-disable-next-line new-cap
      let tmpRepo = await Git.Clone(repoPath, tmpPath)
      let ref = await tmpRepo.createBranch('peon-build', payload.head)

      logger.debug(`checking out ${payload.head}`, {
        module: `dispatcher/${repoName}`
      })
      await tmpRepo.checkoutRef(ref)

      logger.debug('loading .peon.yml', { module: `dispatcher/${repoName}` })
      let peonConfig
      try {
        peonConfig = yaml.safeLoad(
          await readFile(resolve(tmpPath, '.peon.yml'))
        )
      } catch(e) {
        // eslint-disable-next-line no-console
        logger.error('could not read .peon.yml', {
          module: `dispatcher/${repoName}`
        })
        throw e
      }

      if (
        peonConfig.branches
        && peonConfig.branches.indexOf(repoConfig.branch) === -1
      ) {
        throw new CancelBuild(
          `branch ${repoConfig.branch} is not present in .peon.yml`
        )
      }

      for (let key in peonConfig.environment || {}) {
        peonConfig.environment[key] = peonConfig.environment[key]
          .replace('$PEON_ROOT_URL', join(rootURLBase, repoName))
          .replace('$PEON_BRANCH', repoConfig.branch)
      }

      for (let command of peonConfig.commands) {
        logger.info(`executing ${command}`, {
          module: `dispatcher/${repoName}`
        })
        try {
          await exec(command, { cwd: tmpPath, env: peonConfig.environment })
        } catch(e) {
          // eslint-disable-next-line no-console
          logger.error(`command failed: ${command}`, {
            module: `dispatcher/${repoName}`
          })
          throw e
        }
      }

      let outputDir = resolve(tmpPath, peonConfig.output)
      let destDir = resolve(publicDirectory, repoName, repoConfig.branch)
      logger.info(`copying output to ${destDir}`, {
        module: `dispatcher/${repoName}`
      })

      logger.debug(`removing ${destDir}`, { module: `dispatcher/${repoName}` })
      await remove(destDir)

      logger.debug(`copying ${outputDir} to ${destDir}`, {
        module: `dispatcher/${repoName}`
      })
      await copy(outputDir, destDir)

      logger.info(`built ${payload.head} successfully`, {
        module: `dispatcher/${repoName}`
      })
    } catch(e) {
      if (e instanceof CancelBuild) {
        logger.info(`cancelled build, ${e.message}`, {
          module: `dispatcher/${repoName}`
        })
      } else {
        logger.error(e, { module: `dispatcher/${repoName}` })
      }
    } finally {
      if ((await stat(tmpPath)).isDirectory()) {
        await remove(tmpPath)
      }
    }
  }

  findRepositoryToHandle(eventType, payload) {
    if (eventType !== 'push') {
      logger.debug(`unhandled event ${eventType}`, { module: 'dispatcher' })
      return null
    }

    let {
      ref,
      repository: { ssh_url: url }
    } = payload

    if (!ref.startsWith('refs/heads/')) {
      logger.debug(`will not handle non-branch ref ${ref}`, {
        module: 'dispatcher'
      })
      return null
    }

    let branch = ref.replace(/^refs\/heads\//, '')
    let repoName, repoConfig

    if (watcherEnabled) {
      repoName = Object.keys(repositories).find(
        (name) => repositories[name].url == url
      )

      if (repoName) {
        repoConfig = repositories[repoName]
      }
    }

    if (!repoName && webhooksEnabled) {
      let { repo } = decodeGithubURL(url)

      repoName = repo
      repoConfig = {
        url
      }
    }

    if (!repoName) {
      logger.debug(`cannot find configured repo with URL ${url}`, {
        module: 'dispatcher'
      })
      return null
    }

    if (!repoConfig.branches || repoConfig.branches.indexOf(branch) !== -1) {
      return Object.assign({ name: repoName, branch }, repoConfig)
    } else {
      logger.debug(`will not handle ref ${ref}`, {
        module: `dispatcher/${repoName}`
      })
      return null
    }
  }
}

module.exports = Dispatcher
