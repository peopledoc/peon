const { assert } = require('chai')
const { lookup, mock, mockConfig } = require('../../helpers')

let {
  gitFetchOpts,
  misc: { extractRepoName, extractGithubRepo }
} = lookup()

describe('unit | utils/misc', function() {
  describe('extractRepoName', function() {
    it('extracts from http(s) urls', function() {
      assert.equal(extractRepoName('http://github.com/org/repo'), 'repo')
      assert.equal(extractRepoName('http://github.com/org/repo.git'), 'repo')
      assert.equal(extractRepoName('https://github.com/org/repo'), 'repo')
      assert.equal(extractRepoName('https://github.com/org/repo.git'), 'repo')
    })

    it('extracts from ssh urls', function() {
      assert.equal(extractRepoName('git@github.com:org/repo'), 'repo')
      assert.equal(extractRepoName('git@github.com:org/repo.git'), 'repo')
    })

    it('extracts from git urls', function() {
      assert.equal(extractRepoName('git://github.com/org/repo'), 'repo')
      assert.equal(extractRepoName('git://github.com/org/repo.git'), 'repo')
      assert.equal(extractRepoName('git+ssh://github.com/org/repo'), 'repo')
      assert.equal(extractRepoName('git+ssh://github.com/org/repo.git'), 'repo')
    })
  })

  describe('extractGithubRepo', function() {
    it('extracts github repository info', function() {
      assert.deepEqual(extractGithubRepo('https://github.com/org/repo'), {
        org: 'org',
        repo: 'repo'
      })
      assert.deepEqual(extractGithubRepo('https://github.com/org/repo.git'), {
        org: 'org',
        repo: 'repo'
      })
      assert.deepEqual(extractGithubRepo('git://github.com/org/repo'), {
        org: 'org',
        repo: 'repo'
      })
      assert.deepEqual(extractGithubRepo('git://github.com/org/repo.git'), {
        org: 'org',
        repo: 'repo'
      })
      assert.deepEqual(extractGithubRepo('git@github.com:org/repo'), {
        org: 'org',
        repo: 'repo'
      })
      assert.deepEqual(extractGithubRepo('git@github.com:org/repo.git'), {
        org: 'org',
        repo: 'repo'
      })
    })

    it('does not extract from non-github urls', function() {
      assert.equal(extractGithubRepo('https://example.com/org/repo'), undefined)
      assert.equal(extractGithubRepo('git@example.com:org/repo'), undefined)
    })
  })

  describe('gitFetchOpts', function() {
    it('returns key based credentials', function() {
      let {
        callbacks: { credentials }
      } = gitFetchOpts

      mockConfig('git', {
        authMethod: 'key',
        privateKey: 'path/to/id_rsa',
        publicKey: 'path/to/id_rsa.pub',
        keyPassword: 'wowsupersecret'
      })

      let called = false

      mock('Git', {
        Cred: {
          sshKeyNew(username, pubkey, privkey, pass) {
            called = true
            assert.equal(username, 'johndoe')
            assert.equal(pubkey, 'path/to/id_rsa.pub')
            assert.equal(privkey, 'path/to/id_rsa')
            assert.equal(pass, 'wowsupersecret')
          }
        }
      })

      credentials('url', 'johndoe')

      assert.ok(called)
    })

    it('returns agent based credentials', function() {
      let {
        callbacks: { credentials }
      } = gitFetchOpts

      mockConfig('git', {
        authMethod: 'agent'
      })

      let called = false

      mock('Git', {
        Cred: {
          sshKeyFromAgent(username) {
            called = true
            assert.equal(username, 'johndoe')
          }
        }
      })

      credentials('url', 'johndoe')

      assert.ok(called)
    })
  })
})
