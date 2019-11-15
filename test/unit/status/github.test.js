const { assert } = require('chai')
const { lookup, mock, mockConfig } = require('../../helpers')

const { GithubStatus } = lookup()

describe('unit | status/github', function() {
  beforeEach(function() {
    mock('db', {
      async getGitBuildInfo(id) {
        if (id === 'non-github') {
          return { url: 'git@example.com:org/repo', sha: 'COMMITSHA' }
        } else if (id === 'github') {
          return { url: 'git@github.com:org/repo', sha: 'COMMITSHA' }
        }
      }
    })
  })

  describe('GithubStatus.update', function() {
    it('does nothing when no github token is configured', async function() {
      let runCalled = false

      mockConfig('githubAPIToken', null)
      mock(
        'Queue',
        class {
          run() {
            runCalled = true
          }
        }
      )

      await new GithubStatus().update(
        'github',
        'state',
        'description'
      )

      assert.notOk(runCalled)
    })

    it('does nothing for non-github repositories', async function() {
      let runCalled = false

      mockConfig('githubAPIToken', 'abcdef')
      mock(
        'Queue',
        class {
          run() {
            runCalled = true
          }
        }
      )

      await new GithubStatus().update(
        'non-github',
        'state',
        'description'
      )

      assert.notOk(runCalled)
    })

    it('enqueues and sends updates', async function() {
      let octokitParams, octokitStatus, queuedFunction

      mockConfig('githubAPIToken', 'abcdef')
      mockConfig('statusUrl', 'status://url')
      mock(
        'Octokit',
        class {
          constructor(params) {
            octokitParams = params

            this.repos = {
              createStatus(status) {
                octokitStatus = status
                return Promise.resolve()
              }
            }
          }
        }
      )
      mock(
        'Queue',
        class {
          run(fun) {
            queuedFunction = fun
          }
        }
      )

      await new GithubStatus().update(
        'github',
        'STATUSSTATE',
        'STATUSDESCR'
      )

      assert.deepEqual(octokitParams, { auth: 'token abcdef' })
      assert.equal(typeof queuedFunction, 'function')
      assert.notOk(octokitStatus)

      queuedFunction()

      assert.deepEqual(octokitStatus, {
        owner: 'org',
        repo: 'repo',
        sha: 'COMMITSHA',
        state: 'STATUSSTATE',
        // eslint-disable-next-line camelcase
        target_url: 'status://url/github.html',
        context: 'peon',
        description: 'STATUSDESCR'
      })
    })
  })
})
