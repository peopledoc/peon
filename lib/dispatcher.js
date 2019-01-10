const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { copy, mkdtemp, readFile, remove } = require('fs-extra')

const yaml = require('js-yaml')
const Git = require('nodegit')
const { exec } = require('child-process-promise')

const {
  publicDirectory,
  repositories,
  rootURLBase,
  workingDirectory
} = require('./config')

class Dispatcher {
  async dispatch(eventType, payload) {
    let repoConfig = this.findRepositoryToHandle(eventType, payload)
    if (!repoConfig) {
      return
    }

    let repoPath = resolve(workingDirectory, repoConfig.name)
    let tmpPath = await mkdtemp(resolve(tmpdir(), `peon.${repoConfig.name}-`))

    // eslint-disable-next-line no-console
    console.log(`cloning into ${tmpPath}`)

    // eslint-disable-next-line new-cap
    let tmpRepo = await Git.Clone(repoPath, tmpPath)
    let ref = await tmpRepo.createBranch('peon-build', payload.head)

    // eslint-disable-next-line no-console
    console.log(`checking out ${payload.head}`)
    await tmpRepo.checkoutRef(ref)

    // eslint-disable-next-line no-console
    console.log('loading .peon.yml')
    let peonConfig = yaml.safeLoad(
      await readFile(resolve(tmpPath, '.peon.yml'))
    )

    for (let key in peonConfig.environment || {}) {
      peonConfig.environment[key] = peonConfig.environment[key].replace(
        '$PEON_ROOT_URL',
        join(rootURLBase, repoConfig.name)
      )
    }

    for (let command of peonConfig.commands) {
      // eslint-disable-next-line no-console
      console.log(`executing ${command}`)
      await exec(command, { cwd: tmpPath, env: peonConfig.environment })
    }

    // eslint-disable-next-line no-console
    console.log(`removing ${resolve(publicDirectory, repoConfig.name)}`)
    await remove(resolve(publicDirectory, repoConfig.name))

    // eslint-disable-next-line no-console
    console.log(
      `copying ${resolve(tmpPath, peonConfig.output)} to  ${resolve(
        publicDirectory,
        repoConfig.name
      )}`
    )
    await copy(
      resolve(tmpPath, peonConfig.output),
      resolve(publicDirectory, repoConfig.name)
    )

    // await remove(tmpPath)
  }

  findRepositoryToHandle(eventType, payload) {
    if (eventType !== 'push') {
      // eslint-disable-next-line no-console
      console.log(`unhandled event ${eventType}`)
      return null
    }

    let {
      ref,
      repository: { ssh_url: url }
    } = payload

    let repoName = Object.keys(repositories).find(
      (name) => repositories[name].url == url
    )

    if (!repoName) {
      // eslint-disable-next-line no-console
      console.log(`cannot find repo with URL ${url}`)
      return null
    }

    if (ref === `refs/heads/${repositories[repoName].branch}`) {
      return Object.assign({ name: repoName }, repositories[repoName])
    } else {
      // eslint-disable-next-line no-console
      console.log(`will not handle ref ${ref}`)
      return null
    }
  }
}

module.exports = Dispatcher
