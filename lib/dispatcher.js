const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { copy, mkdtemp, readFile, remove, stat } = require('fs-extra')

const yaml = require('js-yaml')
const Git = require('nodegit')
const { exec } = require('child-process-promise')

const { restoreCache, saveCache } = require('./cache')
const {
  outputDirectory,
  watcher: { enabled: watcherEnabled, repositories: watcherRepositories },
  webhooks: { enabled: webhooksEnabled },
  rootURLBase,
  workingDirectory
} = require('./config')
const logger = require('./logger')
const { gitFetchOpts, extractRepoName } = require('./utils')
const status = require('./status')
const reposDirectory = resolve(workingDirectory, 'repos')

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

    let buildId = await status.startBuild(
      repoConfig.name,
      repoConfig.branch,
      payload.head_commit.id
    )

    pending[repoConfig.name].push({ buildId, payload, repoConfig })

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
      let { buildId, payload, repoConfig } = pending[repoName].shift()
      await this.build(buildId, payload, repoConfig)
    }

    logger.debug('nothing left to build', { module: `dispatcher/${repoName}` })
    building[repoName] = false
  }

  async build(buildId, payload, repoConfig) {
    let repoName = repoConfig.name

    let repoPath = resolve(reposDirectory, repoName)
    let tmpPath = await mkdtemp(resolve(tmpdir(), `peon.${repoName}-`))

    logger.info(`building commit ${payload.head_commit.id}`, {
      module: `dispatcher/${repoName}`
    })

    await status.updateBuildStep(buildId, 'update repository', 'running')
    try {
      let repo, cloned
      try {
        repo = await Git.Repository.open(repoPath)
        logger.debug(`opened repo from ${repoPath}`, {
          module: `dispatcher/${repoName}`
        })
      } catch(e) {
        // eslint-disable-next-line new-cap
        repo = await Git.Clone(repoConfig.url, repoPath, {
          fetchOpts: gitFetchOpts
        })
        logger.debug(`cloned repo into ${repoPath}`, {
          module: `dispatcher/${repoName}`
        })
        cloned = true
      }

      if (!cloned) {
        await repo.fetch('origin', gitFetchOpts)
      }
    } catch(e) {
      logger.error(e, { module: `dispatcher/${repoName}` })
      await status.updateBuildStep(
        buildId,
        'update repository',
        'failed',
        e.message
      )
      return
    }
    await status.updateBuildStep(buildId, 'update repository', 'success')

    try {
      await status.updateBuildStep(buildId, 'create build workspace', 'running')
      try {
        logger.debug(`cloning into ${tmpPath}`, {
          module: `dispatcher/${repoName}`
        })

        // eslint-disable-next-line new-cap
        let tmpRepo = await Git.Clone(repoPath, tmpPath)
        let ref = await tmpRepo.createBranch(
          'peon-build',
          payload.head_commit.id
        )

        logger.debug(`checking out ${payload.head_commit.id}`, {
          module: `dispatcher/${repoName}`
        })
        await tmpRepo.checkoutRef(ref)
      } catch(e) {
        await status.updateBuildStep(
          buildId,
          'create build workspace',
          'failed',
          e.message
        )
        throw e
      }
      await status.updateBuildStep(buildId, 'create build workspace', 'success')

      logger.debug('loading .peon.yml', { module: `dispatcher/${repoName}` })
      let peonConfig

      await status.updateBuildStep(buildId, 'read peon config', 'running')
      try {
        peonConfig = yaml.safeLoad(
          await readFile(resolve(tmpPath, '.peon.yml'))
        )
      } catch(e) {
        logger.error('could not read .peon.yml', {
          module: `dispatcher/${repoName}`
        })
        await status.updateBuildStep(
          buildId,
          'read peon config',
          'failed',
          e.message
        )
        throw e
      }

      await status.updateBuildStep(buildId, 'read peon config', 'success')

      if (
        peonConfig.branches
        && peonConfig.branches.indexOf(repoConfig.branch) === -1
      ) {
        throw new CancelBuild(
          `branch ${repoConfig.branch} is not present in .peon.yml`
        )
      }

      if (peonConfig.cache && peonConfig.cache.length) {
        await status.updateBuildStep(buildId, 'restore cache', 'running')

        try {
          let restoredPaths = await restoreCache(
            repoName,
            tmpPath,
            peonConfig.cache
          )

          await status.updateBuildStep(
            buildId,
            'restore cache',
            'success',
            restoredPaths.length
              ? `restored ${restoredPaths.join(', ')}`
              : 'found nothing to restore'
          )
        } catch(e) {
          logger.warn('could not restore cache', {
            module: `dispatcher/${repoName}`
          })
          logger.warn(e, {
            module: `dispatcher/${repoName}`
          })
          await status.updateBuildStep(
            buildId,
            'restore cache',
            'failed',
            e.message
          )
        }
      }

      for (let key in peonConfig.environment || {}) {
        peonConfig.environment[key] = peonConfig.environment[key]
          .replace(
            '$PEON_ROOT_URL',
            join(rootURLBase, repoName, repoConfig.branch)
          )
          .replace('$PEON_BRANCH', repoConfig.branch)
      }

      for (let command of peonConfig.commands) {
        logger.info(`executing ${command}`, {
          module: `dispatcher/${repoName}`
        })

        await status.updateBuildStep(buildId, `run ${command}`, 'running')
        try {
          await exec(command, { cwd: tmpPath, env: peonConfig.environment })
        } catch(e) {
          // eslint-disable-next-line no-console
          logger.error(`command failed: ${command}`, {
            module: `dispatcher/${repoName}`
          })

          await status.updateBuildStep(
            buildId,
            `run ${command}`,
            'failed',
            e.message
          )
          throw e
        }
        await status.updateBuildStep(buildId, `run ${command}`, 'success')
      }

      if (peonConfig.cache && peonConfig.cache.length) {
        await status.updateBuildStep(buildId, 'save cache', 'running')

        try {
          let savedPaths = await saveCache(repoName, tmpPath, peonConfig.cache)

          await status.updateBuildStep(
            buildId,
            'save cache',
            'success',
            savedPaths.length
              ? `saved ${savedPaths.join(', ')}`
              : 'found nothing to save'
          )
        } catch(e) {
          logger.warn('could not save cache', {
            module: `dispatcher/${repoName}`
          })
          logger.warn(e, { module: `dispatcher/${repoName}` })

          await status.updateBuildStep(
            buildId,
            'save cache',
            'failed',
            e.message
          )
        }
      }

      await status.updateBuildStep(buildId, 'deploy', 'running')
      try {
        let outputDir = resolve(tmpPath, peonConfig.output)
        let destDir = resolve(outputDirectory, repoName, repoConfig.branch)
        logger.info(`copying output to ${destDir}`, {
          module: `dispatcher/${repoName}`
        })

        logger.debug(`removing ${destDir}`, {
          module: `dispatcher/${repoName}`
        })
        await remove(destDir)

        logger.debug(`copying ${outputDir} to ${destDir}`, {
          module: `dispatcher/${repoName}`
        })
        await copy(outputDir, destDir)

        logger.info(`built ${payload.head_commit.id} successfully`, {
          module: `dispatcher/${repoName}`
        })
      } catch(e) {
        await status.updateBuildStep(buildId, 'deploy', 'failed', e.message)
        throw e
      }
      await status.updateBuildStep(buildId, 'deploy', 'success')

      await status.finishBuild(buildId, 'success')
    } catch(e) {
      if (e instanceof CancelBuild) {
        logger.info(`cancelled build, ${e.message}`, {
          module: `dispatcher/${repoName}`
        })

        await status.finishBuild(buildId, 'cancelled')
      } else {
        logger.error(e, { module: `dispatcher/${repoName}` })

        await status.finishBuild(buildId, 'failed')
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
    let repoName = extractRepoName(url)
    let repoConfig

    if (watcherEnabled) {
      repoConfig = watcherRepositories.find((conf) => conf.url === url)
    }

    if (!repoConfig && webhooksEnabled) {
      repoConfig = { url }
    }

    if (!repoConfig) {
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
