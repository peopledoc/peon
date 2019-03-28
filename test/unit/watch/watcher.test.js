const { assert } = require('chai')
const { lookup, mock, mockConfig, tempDir, wait } = require('../../helpers')

const { Watcher } = lookup()

describe('unit | watch/watcher', function() {
  let workingDirectory

  beforeEach(async function() {
    workingDirectory = await tempDir()
    mockConfig('workingDirectory', workingDirectory)
  })

  describe('Watcher._openRepository', function() {
    it('opens repository when it already exists', async function() {
      let openPath
      let repo = {}
      mock('Git', {
        Repository: {
          open(path) {
            openPath = path
            return repo
          }
        }
      })

      let ret = await new Watcher('reponame', 'repourl', [])._openRepository()

      assert.equal(openPath, `${workingDirectory}/repos/reponame`)
      assert.equal(ret.repo, repo)
      assert.notOk(ret.cloned)
    })

    it('clones repository when it does not exist', async function() {
      let clonePath, cloneUrl
      let repo = {}
      mock('Git', {
        Repository: {
          open() {
            throw new Error()
          }
        },
        Clone(url, path) {
          cloneUrl = url
          clonePath = path
          return repo
        }
      })

      let ret = await new Watcher('reponame', 'repourl', [])._openRepository()

      assert.equal(clonePath, `${workingDirectory}/repos/reponame`)
      assert.equal(cloneUrl, 'repourl')
      assert.equal(ret.repo, repo)
      assert.ok(ret.cloned)
    })
  })

  describe('Watcher._getCurrentSHAs', function() {
    it('returns no current SHAs when repository was just cloned', async function() {
      let repo = {}

      assert.deepEqual(
        await new Watcher('reponame', 'repourl', [
          'branch1',
          'branch2'
        ])._getCurrentSHAs(repo, true),
        {}
      )
    })

    it('returns current SHAs for each branch when repository was not just cloned', async function() {
      let repo = {
        getBranchCommit(branch) {
          return {
            sha() {
              return `${branch}-SHA`
            }
          }
        }
      }

      assert.deepEqual(
        await new Watcher('reponame', 'repourl', [
          'branch1',
          'branch2'
        ])._getCurrentSHAs(repo, false),
        { branch1: 'origin/branch1-SHA', branch2: 'origin/branch2-SHA' }
      )
    })
  })

  describe('Watcher._checkUpdates', function() {
    it('fetches origin when repository was not just cloned', async function() {
      let fetchOrigin
      let repo = {
        async fetch(origin) {
          fetchOrigin = origin
        }
      }

      await new Watcher('reponame', 'repourl', [])._checkUpdates(
        repo,
        false,
        {}
      )
      assert.equal(fetchOrigin, 'origin')
    })

    it('does not fetch when repository was just cloned', async function() {
      let fetchCalled = false
      let repo = {
        async fetch() {
          fetchCalled = true
        }
      }

      await new Watcher('reponame', 'repourl', [])._checkUpdates(repo, true, {})
      assert.notOk(fetchCalled)
    })

    it('compares SHAs and emits change events', async function() {
      let events = []
      let repo = {
        getBranchCommit(branch) {
          return {
            sha() {
              return `${branch}-SHA`
            }
          }
        }
      }

      let watcher = new Watcher('reponame', 'repourl', [
        'branch1',
        'branch2',
        'branch3'
      ])

      watcher.on('change', (ref, sha) => events.push({ ref, sha }))

      await watcher._checkUpdates(repo, true, {
        branch1: 'origin/branch1-SHA',
        branch2: 'origin/branch2-differentSHA'
      })

      // branch1 has not changed
      // branch2 has changed
      // branch3 is new
      assert.deepEqual(events, [
        { ref: 'refs/heads/branch2', sha: 'origin/branch2-SHA' },
        { ref: 'refs/heads/branch3', sha: 'origin/branch3-SHA' }
      ])
    })
  })

  describe('Watcher.start/stop', function() {
    it('runs _check at regular intervals between start/stop calls', async function() {
      this.slow(300)

      let checkCalls = 0

      mockConfig('watcher', { interval: 10 })
      let watcher = new Watcher('reponame', 'repourl', [])
      watcher._check = async() => checkCalls++

      watcher.start()
      await wait(100)
      watcher.stop()
      assert.ok(checkCalls > 0)
      let stoppedAt = checkCalls

      await wait(100)
      assert.equal(checkCalls, stoppedAt)
    })
  })
})
