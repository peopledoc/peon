const { assert } = require('chai')
const { lookup, mock, mockConfig } = require('../../helpers')

const { GithubStatus } = lookup()

describe('unit | status/github', function() {
  describe('GithubStatus.update', function() {
    it('does nothing when no github token is configured', function() {
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

      new GithubStatus().update(
        'git@github.com:org/repo',
        'id',
        'sha',
        'state',
        'description'
      )

      assert.notOk(runCalled)
    })

    it('does nothing for non-github repositories', function() {
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

      new GithubStatus().update(
        'git@example.com:org/repo',
        'id',
        'sha',
        'state',
        'description'
      )

      assert.notOk(runCalled)
    })

    it('enqueues and sends updates', function() {
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

      new GithubStatus().update(
        'git@github.com:org/repo',
        'REPOBUILDS#BUILDID',
        'COMMITSHA',
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
        target_url: 'status://url/REPOBUILDS/BUILDID.html',
        context: 'peon',
        description: 'STATUSDESCR'
      })
    })
  })
})
