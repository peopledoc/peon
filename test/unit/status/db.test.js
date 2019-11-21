/* eslint-disable camelcase */

const { assert } = require('chai')
const SQL = require('sql-template-strings')

const { lookup, tempDir, mockConfig } = require('../../helpers')

const { Database } = lookup()

const fixtures = {
  repos: SQL`
INSERT INTO Repo(id, name, url)
VALUES (1, 'myrepo1', 'myurl1'), (2, 'myrepo2', 'myurl2')`,

  builds: SQL`
INSERT INTO Build(id, repo_id, ref_type, ref, sha, enqueued, updated, start,
                  end, status, extra)
VALUES (1, 1, 'branch', 'mybranch', 'sha1', 0, 1, 2, 3, 'status', null),
       (2, 1, 'tag', 'mytag', 'sha2', 4, 5, 6, 7, 'status', '{"json":"value"}'),
       (3, 2, 'branch', 'mybranch', 'sha3', 8, 9, 10, 11, 'status', null),
       (4, 2, 'tag', 'mytag', 'sha4', 12, 13, 14, 15, 'status', null),
       (5, 2, 'tag', 'mytag', 'sha4', 12, 14, 14, 15, 'pending', null),
       (6, 2, 'tag', 'mytag', 'sha4', 12, 15, 14, 15, 'running', null)`,

  steps: SQL`
INSERT INTO Step(id, build_id, description, start, end, status, output)
VALUES (1, 1, 'build 1 step 1', 0, 1, 'success', '1.1 output'),
       (2, 1, 'build 1 step 2', 2, 3, 'success', '1.2 output'),
       (3, 1, 'build 1 step 3', 4, null, 'running', '1.3 output'),
       (4, 2, 'build 2 step 1', 6, 7, 'success', '2.1 output'),
       (5, 2, 'build 2 step 2', 8, 9, 'failed', '2.2 output')`
}

describe('Unit | status/db', function() {
  let _dbs = []

  async function getDatabase(queries = [], config = {}) {
    mockConfig('workingDirectory', await tempDir())

    for (let key in config) {
      mockConfig(key, config[key])
    }

    let db = new Database()

    await db.db
    for (let query of queries) {
      await db._run(query)
    }

    _dbs.push(db)
    return db
  }

  afterEach(async function() {
    for (let db of _dbs) {
      await db.close()
    }

    _dbs.splice(0, _dbs.length)
  })

  describe('db.getRepos', function() {
    it('returns repositories', async function() {
      let db = await getDatabase([fixtures.repos])

      let repos = await db.getRepos()

      assert.deepEqual(repos, [
        { id: 1, name: 'myrepo1', url: 'myurl1' },
        { id: 2, name: 'myrepo2', url: 'myurl2' }
      ])
    })
  })

  describe('db.getOrCreateRepo', function() {
    it('returns existing repo', async function() {
      let db = await getDatabase([fixtures.repos])

      let repo = await db.getOrCreateRepo({
        name: 'myrepo1',
        url: 'myurl1'
      })

      assert.deepEqual(repo, { id: 1, name: 'myrepo1', url: 'myurl1' })
    })

    it('returns existing repo without changing url', async function() {
      let db = await getDatabase([fixtures.repos])

      let repo = await db.getOrCreateRepo({
        name: 'myrepo1',
        url: 'myotherurl1'
      })

      assert.deepEqual(repo, { id: 1, name: 'myrepo1', url: 'myurl1' })
    })

    it('creates missing repo', async function() {
      let db = await getDatabase([fixtures.repos])

      let repo = await db.getOrCreateRepo({
        name: 'myrepo3',
        url: 'myurl3'
      })

      assert.deepEqual(repo, { id: 3, name: 'myrepo3', url: 'myurl3' })
    })
  })

  describe('db.getBuilds', function() {
    it('returns builds last updated first', async function() {
      let db = await getDatabase([fixtures.repos, fixtures.builds])

      let builds = await db.getBuilds(1)

      assert.deepEqual(builds, [
        {
          id: 2, ref_type: 'tag', ref: 'mytag', sha: 'sha2', enqueued: 4,
          updated: 5, start: 6, end: 7, status: 'status',
          extra: { json: 'value' }
        },
        {
          id: 1, ref_type: 'branch', ref: 'mybranch', sha: 'sha1', enqueued: 0,
          updated: 1, start: 2, end: 3, status: 'status', extra: null
        }
      ])
    })
  })

  describe('db.getStaleBuilds', function() {
    it('returns running or pending build IDs', async function() {
      let db = await getDatabase([fixtures.repos, fixtures.builds])

      let ids = await db.getStaleBuilds()

      assert.deepEqual(ids, [{ id: 5 }, { id: 6 }])
    })
  })

  describe('db.getLastUpdatedBuilds', function() {
    it('returns all builds last updated first', async function() {
      let db = await getDatabase([fixtures.repos, fixtures.builds])

      let builds = await db.getLastUpdatedBuilds()

      assert.deepEqual(
        builds.map((b) => b.id),
        [6, 5, 4, 3, 2, 1]
      )

      assert.deepEqual(builds[4], {
        id: 2, ref_type: 'tag', ref: 'mytag', sha: 'sha2', enqueued: 4,
        updated: 5, start: 6, end: 7, status: 'status',
        extra: { json: 'value' },
        repo_id: 1, repo_name: 'myrepo1', repo_url: 'myurl1'
      })
    })

    it('limits output count', async function() {
      let db = await getDatabase([fixtures.repos, fixtures.builds])

      let builds = await db.getLastUpdatedBuilds(2)

      assert.deepEqual(
        builds.map((b) => b.id),
        [6, 5]
      )
    })
  })

  describe('db.createBuild', function() {
    it('creates a new build', async function() {
      let db = await getDatabase([fixtures.repos])

      let id = await db.createBuild({
        repoId: 1,
        refMode: 'branch',
        ref: 'mybranch',
        sha: 'mysha'
      })
      let [build] = await db.getBuilds(1)

      assert.ok(build)
      assert.closeTo(build.enqueued, Date.now(), 500)
      assert.equal(build.enqueued, build.updated)
      assert.include(build, {
        id, ref_type: 'branch', ref: 'mybranch', sha: 'mysha', start: null,
        end: null, status: 'pending', extra: null
      })
    })
  })

  describe('db.updateBuild', function() {
    it('sets status and updated fields', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds
      ])

      await db.updateBuild({ id: 1, status: 'newstatus' })
      let [build] = await db.getBuilds(1)

      assert.include(build, { status: 'newstatus', start: 2, end: 3, extra: null })
      assert.closeTo(build.updated, Date.now(), 500)
    })

    it('sets start time when start is not set and status is not cancelled or failed', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        SQL`UPDATE Build SET start = null`
      ])

      await db.updateBuild({ id: 1, status: 'cancelled' })
      await db.updateBuild({ id: 2, status: 'failed' })
      let [build1, build2] = await db.getBuilds(1)

      assert.equal(build1.start, null)
      assert.equal(build2.start, null)

      await db.updateBuild({ id: 1, status: 'running' })
      let [build] = await db.getBuilds(1)

      assert.closeTo(build.start, Date.now(), 500)
    })

    it('sets end time when status is failed or success', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        SQL`UPDATE Build SET end = null`
      ])

      await db.updateBuild({ id: 1, status: 'notfailed' })
      await db.updateBuild({ id: 2, status: 'notsuccess' })
      let [build1, build2] = await db.getBuilds(1)

      assert.equal(build1.end, null)
      assert.equal(build2.end, null)

      await db.updateBuild({ id: 1, status: 'failed' })
      await db.updateBuild({ id: 2, status: 'success' })
      ;([build1, build2] = await db.getBuilds(1))

      assert.closeTo(build1.end, Date.now(), 500)
      assert.closeTo(build2.end, Date.now(), 500)
    })

    it('sets extra as JSON when specified', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds
      ])

      await db.updateBuild({ id: 1, status: 'newstatus', extra: { json: 'value' } })
      let [build] = await db.getBuilds(1)

      assert.deepEqual(build.extra, { json: 'value' })
    })
  })

  describe('db.getSteps', function() {
    it('returns steps in starting order', async function() {
      let db = await getDatabase([fixtures.repos, fixtures.builds, fixtures.steps])

      let steps = await db.getSteps(1)

      assert.deepEqual(steps, [
        { id: 1, description: 'build 1 step 1', start: 0, end: 1,
          status: 'success', output: '1.1 output' },
        { id: 2, description: 'build 1 step 2', start: 2, end: 3,
          status: 'success', output: '1.2 output' },
        { id: 3, description: 'build 1 step 3', start: 4, end: null,
          status: 'running', output: '1.3 output' }
      ])
    })
  })

  describe('db.updateStep', function() {
    it('sets build status to running', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        fixtures.steps
      ])

      await db.updateStep({
        buildId: 1, description: 'build 1 step 3', status: 'running'
      })
      let [build] = await db.getBuilds(1)

      assert.equal(build.status, 'running')
    })

    it('creates step if missing', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        fixtures.steps
      ])

      await db.updateStep({
        buildId: 1,
        description: 'build 1 step 4',
        status: 'running'
      })

      let [,,, step] = await db.getSteps(1)

      assert.include(step, {
        id: 6,
        description: 'build 1 step 4',
        status: 'running'
      })
    })

    it('updates step status', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        fixtures.steps
      ])

      await db.updateStep({
        buildId: 1,
        description: 'build 1 step 1',
        status: 'moo'
      })

      let [step] = await db.getSteps(1)

      assert.equal(step.status, 'moo')
    })

    it('sets step end when status is success or failed', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        fixtures.steps
      ])

      await db.updateStep({
        buildId: 1,
        description: 'build 1 step 1',
        status: 'success'
      })
      await db.updateStep({
        buildId: 1,
        description: 'build 1 step 2',
        status: 'failed'
      })

      let [step1, step2] = await db.getSteps(1)

      assert.closeTo(step1.end, Date.now(), 500)
      assert.closeTo(step2.end, Date.now(), 500)
    })

    it('sets step output if specified', async function() {
      let db = await getDatabase([
        fixtures.repos,
        fixtures.builds,
        fixtures.steps
      ])

      await db.updateStep({
        buildId: 1,
        description: 'build 1 step 1',
        status: 'success'
      })
      let [step] = await db.getSteps(1)

      assert.equal(step.output, '1.1 output')

      await db.updateStep({
        buildId: 1,
        description: 'build 1 step 1',
        status: 'success',
        output: 'moo'
      })
      ;([step] = await db.getSteps(1))

      assert.equal(step.output, 'moo')
    })
  })

  describe('db.getGitBuildInfo', function() {
    it('retrieves build SHA and repository URL', async function() {
      let db = await getDatabase([fixtures.repos, fixtures.builds])

      let info = await db.getGitBuildInfo(1)
      assert.deepEqual(info, { sha: 'sha1', url: 'myurl1' })
    })
  })
})
