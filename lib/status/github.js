const { lookup, registerForTest, registerLazy } = require('../injections')

class GithubStatus {
  get api() {
    if (!this._api) {
      let {
        Octokit,
        config: { githubAPIToken }
      } = lookup()

      this._api = githubAPIToken
        ? new Octokit({ auth: `token ${githubAPIToken}` })
        : null
    }

    return this._api
  }

  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('status')
    }
    return this._logger
  }

  get queue() {
    if (!this._queue) {
      let { Queue } = lookup()
      this._queue = new Queue()
    }
    return this._queue
  }

  async update(buildId, state, description) {
    let { api, queue } = this
    let {
      misc: { extractGithubRepo },
      config: { statusUrl },
      db
    } = lookup()

    let { sha, url: repoUrl } = await db.getGitBuildInfo(buildId)
    let githubRepo = extractGithubRepo(repoUrl)

    if (!githubRepo || !api) {
      return
    }

    queue.run(() =>
      api.repos
        .createStatus({
          owner: githubRepo.org,
          repo: githubRepo.repo,
          sha,
          state,
          // eslint-disable-next-line camelcase
          target_url: `${statusUrl}${
            statusUrl.endsWith('/') ? '' : '/'
          }${buildId}.html`,
          context: 'peon',
          description
        })
        .catch((e) => {
          this.logger.warn('could not update GitHub status', {
            module: 'status/github'
          })
          this.logger.warn(e.stack, { module: 'status/github' })
        })
    )
  }
}

registerForTest(GithubStatus)
registerLazy('githubStatus', () => new GithubStatus())
