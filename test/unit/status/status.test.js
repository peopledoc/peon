const { assert } = require('chai')
const { ensureDir, readFile, writeFile } = require('fs-extra')
const { resolve } = require('path')
const { lookup, mock, mockConfig, tempDir } = require('../../helpers')
const { Status } = lookup()

describe('unit | status/status', function() {
  let statusRoot

  beforeEach(async function() {
    let wd = await tempDir()
    statusRoot = resolve(wd, 'status')
    mockConfig('workingDirectory', wd)
    mockConfig('statusDirectory', await tempDir())
  })

  describe('Status._updateRepoStatus', function() {
    it('initializes repo status file', async function() {
      mock('renderer', { render() {} })

      await new Status()._updateRepoStatus('reponame', (s) => s)

      let status = JSON.parse(
        await readFile(resolve(statusRoot, 'reponame.json'))
      )
      assert.deepEqual(status, {
        nextBuildNum: 1,
        builds: {}
      })
    })

    it('passes current status file content and current date to updater', async function() {
      mock('renderer', { render() {} })

      let status = new Status()

      await ensureDir(statusRoot)
      await writeFile(
        resolve(statusRoot, 'reponame.json'),
        JSON.stringify({ some: { status: 'content' } })
      )

      let updaterArgs
      await status._updateRepoStatus('reponame', function() {
        updaterArgs = [...arguments]
      })

      assert.deepEqual(updaterArgs[0], { some: { status: 'content' } })
      assert.closeTo(updaterArgs[1], Date.now(), 1000)
    })

    it('writes updated status to status file', async function() {
      mock('renderer', { render() {} })

      await new Status()._updateRepoStatus(
        'reponame',
        (s) => (s.some = { status: 'content' })
      )

      let status = JSON.parse(
        await readFile(resolve(statusRoot, 'reponame.json'))
      )
      assert.deepEqual(status.some, { status: 'content' })
    })

    it('returns what updater returns', async function() {
      mock('renderer', { render() {} })

      assert.equal(
        await new Status()._updateRepoStatus('reponame', () => 'foo'),
        'foo'
      )
    })

    it('calls renderer.render with current date', async function() {
      let called
      mock('renderer', {
        render(now) {
          called = now
        }
      })

      await new Status()._updateRepoStatus('reponame', () => {})

      assert.closeTo(called, Date.now(), 1000)
    })
  })

  describe('Status.startBuild', function() {
    it('generates a new build ID', async function() {
      let status = new Status()
      let updateArgs
      status._updateRepoStatus = function() {
        updateArgs = [...arguments]
        return 'ret'
      }

      let ret = await status.startBuild('repo/url', 'reponame')
      assert.equal(ret, 'ret')
      assert.equal(updateArgs[0], 'reponame')

      let repoStatus = { nextBuildNum: 100, builds: {} }
      assert.equal(updateArgs[1](repoStatus), 'reponame#100')
      assert.equal(repoStatus.nextBuildNum, 101)
    })

    it('sends a "pending" github status update', async function() {
      let updater, ghArgs

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      mock('githubStatus', {
        update() {
          ghArgs = [...arguments]
        }
      })

      await status.startBuild('repo/url', 'reponame', '', '', 'sha')

      updater({ nextBuildNum: 100, builds: {} })

      assert.deepEqual(ghArgs, [
        'repo/url',
        'reponame#100',
        'sha',
        'pending',
        'Peon build is queued'
      ])
    })

    it('adds info for the new build to the repo status', async function() {
      let updater

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.startBuild(
        'repo/url',
        'reponame',
        'branch',
        'mybranch',
        'sha'
      )

      let repoStatus = { nextBuildNum: 100, builds: {} }
      let now = Date.now()
      updater(repoStatus, now)
      assert.deepEqual(repoStatus.builds['reponame#100'], {
        branch: 'mybranch',
        tag: null,
        sha: 'sha',
        url: 'repo/url',
        enqueued: now,
        updated: now,
        status: 'pending',
        steps: []
      })

      await status.startBuild('repo/url', 'reponame', 'tag', 'mytag', 'sha')

      repoStatus = { nextBuildNum: 100, builds: {} }
      updater(repoStatus, now)
      assert.deepEqual(repoStatus.builds['reponame#100'], {
        branch: null,
        tag: 'mytag',
        sha: 'sha',
        url: 'repo/url',
        enqueued: now,
        updated: now,
        status: 'pending',
        steps: []
      })
    })
  })

  describe('Status.updateBuildStep', async function() {
    it('sends a "pending" github status update with current step', async function() {
      let updater, ghArgs

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      mock('githubStatus', {
        update() {
          ghArgs = [...arguments]
        }
      })

      await status.updateBuildStep('reponame#100', 'my step')

      updater({
        nextBuildNum: 100,
        builds: { 'reponame#100': { url: 'repo/url', sha: 'sha', steps: [] } }
      })

      assert.deepEqual(ghArgs, [
        'repo/url',
        'reponame#100',
        'sha',
        'pending',
        "Peon build is running 'my step'"
      ])
    })

    it('updates build status, update date and start date', async function() {
      let updater
      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.updateBuildStep('reponame#100', 'my step')

      let now = Date.now()
      let before = now - 1000
      let build = {
        url: 'repo/url',
        steps: [],
        updated: before,
        status: 'pending'
      }
      let repoStatus = {
        nextBuildNum: 100,
        builds: { 'reponame#100': build }
      }
      updater(repoStatus, now)

      assert.equal(build.status, 'running')
      assert.equal(build.updated, now)
      assert.equal(build.start, now)
    })

    it('does not update start date when it is already present', async function() {
      let updater
      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.updateBuildStep('reponame#100', 'my step')

      let now = Date.now()
      let before = now - 1000
      let build = {
        url: 'repo/url',
        steps: [],
        start: before
      }
      let repoStatus = {
        nextBuildNum: 100,
        builds: { 'reponame#100': build }
      }

      updater(repoStatus, now)

      assert.equal(build.start, before)
    })

    it('adds a new step when the step is not present', async function() {
      let updater
      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.updateBuildStep(
        'reponame#100',
        'my step',
        'some status',
        'some output'
      )

      let now = Date.now()
      let before = now - 1000
      let build = {
        url: 'repo/url',
        steps: [],
        start: before
      }
      let repoStatus = {
        nextBuildNum: 100,
        builds: { 'reponame#100': build }
      }
      updater(repoStatus, now)

      assert.deepEqual(build.steps, [
        {
          description: 'my step',
          start: now,
          status: 'some status',
          output: 'some output'
        }
      ])
    })

    it('updates an existing step', async function() {
      let updater
      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.updateBuildStep(
        'reponame#100',
        'my step',
        'some new status',
        'some new output'
      )

      let now = Date.now()
      let before = now - 1000
      let build = {
        url: 'repo/url',
        steps: [
          {
            description: 'my step',
            start: before,
            status: 'some status',
            output: 'some output'
          }
        ],
        start: before
      }
      let repoStatus = {
        nextBuildNum: 100,
        builds: { 'reponame#100': build }
      }
      updater(repoStatus, now)

      assert.deepEqual(build.steps, [
        {
          description: 'my step',
          start: before,
          status: 'some new status',
          output: 'some new output'
        }
      ])
    })

    it('sets step end and duration when step status is "success"', async function() {
      let updater
      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.updateBuildStep(
        'reponame#100',
        'my step',
        'success',
        'some new output'
      )

      let now = Date.now()
      let before = now - 1000
      let build = {
        url: 'repo/url',
        steps: [
          {
            description: 'my step',
            start: before,
            status: 'some status',
            output: 'some output'
          }
        ],
        start: before
      }
      let repoStatus = {
        nextBuildNum: 100,
        builds: { 'reponame#100': build }
      }
      updater(repoStatus, now)

      assert.deepEqual(build.steps, [
        {
          description: 'my step',
          start: before,
          end: now,
          duration: 1000,
          status: 'success',
          output: 'some new output'
        }
      ])
    })

    it('sets step end and duration when step status is "failed"', async function() {
      let updater
      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.updateBuildStep(
        'reponame#100',
        'my step',
        'failed',
        'some new output'
      )

      let now = Date.now()
      let before = now - 1000
      let build = {
        url: 'repo/url',
        steps: [
          {
            description: 'my step',
            start: before,
            status: 'some status',
            output: 'some output'
          }
        ],
        start: before
      }
      let repoStatus = {
        nextBuildNum: 100,
        builds: { 'reponame#100': build }
      }
      updater(repoStatus, now)

      assert.deepEqual(build.steps, [
        {
          description: 'my step',
          start: before,
          end: now,
          duration: 1000,
          status: 'failed',
          output: 'some new output'
        }
      ])
    })
  })

  describe('Status.finishBuild', function() {
    it('sends a "success" github status update when build status is successful', async function() {
      let updater, ghArgs

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      mock('githubStatus', {
        update() {
          ghArgs = [...arguments]
        }
      })

      await status.finishBuild('reponame#100', 'success')

      updater({
        nextBuildNum: 100,
        builds: { 'reponame#100': { url: 'repo/url', sha: 'sha', steps: [] } }
      })

      assert.deepEqual(ghArgs, [
        'repo/url',
        'reponame#100',
        'sha',
        'success',
        'Peon build is finished'
      ])
    })

    it('sends a "failed" github status update when build status is failed', async function() {
      let updater, ghArgs

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      mock('githubStatus', {
        update() {
          ghArgs = [...arguments]
        }
      })

      await status.finishBuild('reponame#100', 'failed')

      updater({
        nextBuildNum: 100,
        builds: { 'reponame#100': { url: 'repo/url', sha: 'sha', steps: [] } }
      })

      assert.deepEqual(ghArgs, [
        'repo/url',
        'reponame#100',
        'sha',
        'failed',
        'Peon build has failed'
      ])
    })

    it('sends a "failed" github status update when build status is cancelled', async function() {
      let updater, ghArgs

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      mock('githubStatus', {
        update() {
          ghArgs = [...arguments]
        }
      })

      await status.finishBuild('reponame#100', 'cancelled')

      updater({
        nextBuildNum: 100,
        builds: { 'reponame#100': { url: 'repo/url', sha: 'sha', steps: [] } }
      })

      assert.deepEqual(ghArgs, [
        'repo/url',
        'reponame#100',
        'sha',
        'failed',
        'Peon build was cancelled'
      ])
    })

    it('updates build status', async function() {
      let updater

      let status = new Status()
      status._updateRepoStatus = (_, u) => (updater = u)

      await status.finishBuild('reponame#100', 'some status', 'some extra info')

      let now = Date.now()
      let before = now - 1000
      let build = { url: 'repo/url', sha: 'sha', steps: [], start: before }

      updater(
        {
          nextBuildNum: 100,
          builds: { 'reponame#100': build }
        },
        now
      )

      assert.equal(build.status, 'some status')
      assert.equal(build.end, now)
      assert.equal(build.updated, now)
      assert.equal(build.duration, 1000)
      assert.equal(build.extra, 'some extra info')
    })
  })
})
