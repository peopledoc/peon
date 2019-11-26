const { assert } = require('chai')
const { stat, statSync } = require('fs-extra')
const { lookup, mock, mockConfig, tempDir } = require('../../helpers')
const { Status } = lookup()

describe('unit | status/status', function() {
  beforeEach(async function() {
    mockConfig('workingDirectory', await tempDir())
  })

  describe('Status.startBuild', function() {
    it('retrieves repo, creates a build, updates github status, triggers a render, and returns the build ID', async function() {
      let status = new Status()
      let log = []

      mock('db', {
        async getOrCreateRepo({ name, url }) {
          log.push(`get or create repo ${name} at ${url}`)
          return { id: 42, name, url }
        },

        async createBuild({ repoId, refMode, ref, sha }) {
          log.push(`create build for repo#${repoId} on ${refMode} ${ref} at ${sha}`)
          return 43
        }
      })

      mock('githubStatus', {
        update(build, status, text) {
          log.push(`gh status for build#${build}: ${status}, ${text}`)
        }
      })

      mock('renderer', {
        render() {
          log.push('render')
        }
      })

      let id = await status.startBuild('repourl', 'reponame', 'branch', 'mybranch', 'mysha')

      assert.equal(id, 43)
      assert.deepEqual(log, [
        'get or create repo reponame at repourl',
        'create build for repo#42 on branch mybranch at mysha',
        'gh status for build#43: pending, Peon build is queued',
        'render'
      ])
    })
  })

  describe('Status.updateBuildStep', async function() {
    it('updates step, updates github status and triggers a render', async function() {
      let status = new Status()
      let log = []

      mock('db', {
        async updateStep({ buildId, description, status, output }) {
          log.push(`update step ${description} of build#${buildId}: ${status}, ${output}`)
        }
      })

      mock('githubStatus', {
        update(build, status, text) {
          log.push(`gh status for build#${build}: ${status}, ${text}`)
        }
      })

      mock('renderer', {
        render() {
          log.push('render')
        }
      })

      await status.updateBuildStep(42, 'my step', 'step status', 'step output')

      assert.deepEqual(log, [
        'update step my step of build#42: step status, step output',
        'gh status for build#42: pending, Peon build is running \'my step\'',
        'render'
      ])
    })
  })

  describe('Status.finishBuild', function() {
    it('updates build, updates github status and triggers a render', async function() {
      let status = new Status()
      let log = []

      mock('db', {
        async updateBuild({ id, status, extra }) {
          log.push(`update build#${id}: ${status}, ${extra}`)
        }
      })

      mock('githubStatus', {
        update(build, status, text) {
          log.push(`gh status for build#${build}: ${status}, ${text}`)
        }
      })

      mock('renderer', {
        render() {
          log.push('render')
        }
      })

      await status.finishBuild(42, 'success', 'extra for 42')
      await status.finishBuild(43, 'cancelled', 'extra for 43')
      await status.finishBuild(44, 'failed', 'extra for 44')

      assert.deepEqual(log, [
        'update build#42: success, extra for 42',
        'gh status for build#42: success, Peon build is finished',
        'render',

        'update build#43: cancelled, extra for 43',
        'gh status for build#43: failure, Peon build was cancelled',
        'render',

        'update build#44: failed, extra for 44',
        'gh status for build#44: failure, Peon build has failed',
        'render'
      ])
    })
  })

  describe('Status.abortStaleBuilds', function() {
    it('gets stale builds, mark running steps as failed, build as cancelled, and updates github status', async function() {
      let status = new Status()
      let log = []

      mock('db', {
        async getStaleBuilds() {
          log.push('fetch stale builds')
          return [{ id: 42 }, { id: 43 }]
        },

        async getSteps(buildID) {
          log.push(`fetch steps for build#${buildID}`)
          return [
            { id: 10 * buildID + 1, description: `build#${buildID} step 1`, status: 'success', output: 'step 1 output' },
            { id: 10 * buildID + 2, description: `build#${buildID} step 2`, status: 'running', output: 'step 2 output' }
          ]
        },

        async updateBuild({ id, status }) {
          log.push(`update build#${id}: ${status}`)
        },

        async updateStep({ buildId, description, status, output }) {
          log.push(`update step ${description} of build#${buildId}: ${status}, ${output}`)
        }
      })

      mock('githubStatus', {
        update(build, status, text) {
          log.push(`gh status for build#${build}: ${status}, ${text}`)
        }
      })

      await status.abortStaleBuilds()

      assert.deepEqual(log, [
        'fetch stale builds',
        'fetch steps for build#42',
        'update step build#42 step 2 of build#42: failed, step 2 output\n(stale build was aborted)',
        'update build#42: cancelled',
        'gh status for build#42: error, Peon stale build was aborted',
        'fetch steps for build#43',
        'update step build#43 step 2 of build#43: failed, step 2 output\n(stale build was aborted)',
        'update build#43: cancelled',
        'gh status for build#43: error, Peon stale build was aborted'
      ])
    })
  })

  describe('Status.cleanupLocalBuilds', function() {
    it('removes matching local build directories and marks builds as cleaned', async function() {
      let status = new Status()
      let log = []

      let shouldStay = await tempDir()
      let shouldBeRemoved1 = await tempDir()
      let shouldBeRemoved2 = await tempDir()

      mock('db', {
        getBuildsFor({ repoName, refMode, ref }) {
          log.push(`get builds for ${repoName} on ${refMode} ${ref}`)

          return [
            { id: 1, status: 'pending', extra: { localDirectory: shouldStay } },
            { id: 2, status: 'running', extra: { localDirectory: shouldStay } },
            { id: 3, status: 'success', extra: {} },
            { id: 4, status: 'success' },
            { id: 5, status: 'cleaned', extra: { localDirectory: shouldStay } },
            { id: 6, status: 'success', extra: { localDirectory: shouldBeRemoved1 } },
            { id: 7, status: 'success', extra: { localDirectory: shouldBeRemoved2 } }
          ]
        },

        updateBuild({ id, status, extra }) {
          log.push(`update build#${id} with status ${status}${extra ? ` and extra ${JSON.stringify(extra)}` : ''}`)
        }
      })

      await status.cleanupLocalBuilds('myrepo', 'branch', 'mybranch')

      assert.deepEqual(log, [
        'get builds for myrepo on branch mybranch',
        'update build#6 with status cleaned',
        'update build#7 with status cleaned'
      ])

      assert.ok((await stat(shouldStay)).isDirectory())
      assert.throws(() => statSync(shouldBeRemoved1), 'ENOENT')
      assert.throws(() => statSync(shouldBeRemoved2), 'ENOENT')
    })
  })
})
