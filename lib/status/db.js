const { copy, ensureDir, move, readdir, readFile, unlink } = require('fs-extra')
const { dirname, resolve } = require('path')
const sqlite = require('sqlite')
const SQL = require('sql-template-strings')
const { lookup, registerForTest, registerLazy } = require('../injections')

const migrationsDir = resolve(__dirname, 'migrations')

function parseExtra(build) {
  if (build.extra) {
    build.extra = JSON.parse(build.extra)
  }

  return build
}

class Database {
  get logger() {
    if (!this._logger) {
      let { getLogger } = lookup()
      this._logger = getLogger('db')
    }
    return this._logger
  }

  get dbFile() {
    let {
      config: { workingDirectory }
    } = lookup()

    if (!workingDirectory) {
      throw new Error('Cannot open database, no workingDirectory set')
    }

    return resolve(workingDirectory, 'peon.sqlite')
  }

  get db() {
    if (!this.dbPromise) {
      let {
        config: { dbBackupInterval }
      } = lookup()

      this.dbPromise = (async() => {
        let { dbFile } = this

        await ensureDir(dirname(dbFile))

        this.logger.debug('Opening database', { module: 'db' })
        let db = await sqlite.open(dbFile, {
          Promise,
          cached: true
        })

        this.logger.debug('Running migrations', { module: 'db' })
        await db.migrate({ migrationsPath: migrationsDir })

        this.logger.info('Database is open', { module: 'db' })
        return db
      })()

      if (dbBackupInterval && !this.backupInterval) {
        this.backupInterval = setInterval(
          () => this._backup(),
          dbBackupInterval
        )
      }
    }

    return this.dbPromise
  }

  async close() {
    if (this.dbPromise) {
      let db = await this.db
      this.dbPromise = null

      await db.close()
      clearInterval(this.backupInterval)

      this.logger.debug('Database is closed', { module: 'db' })
    }
  }

  async _backup() {
    let {
      config: { dbBackupKeep, workingDirectory }
    } = lookup()

    let { dbFile } = this
    let backupFile = `${dbFile}.${new Date().toISOString().replace(/:/g, '-')}`

    this.logger.debug(`Creating backup ${backupFile}`, { module: 'db' })
    await copy(dbFile, backupFile)

    if (dbBackupKeep) {
      let staleBackups = (await readdir(dirname(dbFile)))
        .filter((f) => f.match(/^peon\.sqlite\./))
        .sort()
        .reverse()
        .slice(dbBackupKeep)

      for (let stale of staleBackups) {
        this.logger.debug(`Removing stale backup ${stale}`, { module: 'db' })
        await unlink(resolve(workingDirectory, stale))
      }
    }
  }

  async _runQuery(method, query) {
    let db = await this.db

    try {
      return await db[method](query)
    } catch(e) {
      let descr

      if (typeof query !== 'string') {
        descr = `"${query.text}"`

        if (query.values.length) {
          descr = `${descr} with values ${query.values
            .map((v) => `"${v}"`)
            .join(', ')}`
        }
      } else {
        descr = `"${query}"`
      }

      this.logger.error(`error running query ${descr}`)
      this.logger.error(e.stack)

      throw e
    }
  }

  _all(query) {
    return this._runQuery('all', query)
  }

  _get(query) {
    return this._runQuery('get', query)
  }

  _run(query) {
    return this._runQuery('run', query)
  }

  async importJSONFiles() {
    let {
      config: { workingDirectory }
    } = lookup()

    let statusRoot = resolve(workingDirectory, 'status')

    await ensureDir(statusRoot)

    for (let file of await readdir(statusRoot)) {
      if (!file.endsWith('.json')) {
        continue
      }

      if (file !== 'peon-status.json') {
        this.logger.debug(`Importing data from ${file}`, { module: 'db' })

        let repoName = file.replace('.json', '')
        let projectStatus = JSON.parse(
          await readFile(resolve(statusRoot, file))
        )

        let repo = await this._get(
          SQL`SELECT id, name, url FROM Repo WHERE name = ${repoName}`
        )

        for (let oldBuildID in projectStatus.builds) {
          let build = projectStatus.builds[oldBuildID]

          if (!repo) {
            let { lastID: repoId } = await this._run(
              SQL`INSERT INTO Repo(name, url) VALUES(${repoName}, ${build.url})`
            )

            repo = await this._get(
              SQL`SELECT id, name, url FROM Repo WHERE id = ${repoId}`
            )
          }

          let {
            branch,
            tag,
            sha,
            enqueued,
            updated,
            start,
            end,
            status,
            steps,
            extra
          } = build

          let refMode = branch ? 'branch' : 'tag'
          let ref = branch || tag

          let extraJson = JSON.stringify(
            Object.assign({ oldBuildID }, extra || {})
          )

          let { lastID: buildId } = await this._run(
            SQL`INSERT INTO Build(repo_id, ref_type, ref, sha, enqueued,
                                  updated, start, end, status, extra)
                VALUES(${repo.id}, ${refMode}, ${ref}, ${sha}, ${enqueued},
                       ${updated}, ${start}, ${end}, ${status}, ${extraJson})`
          )

          for (let step of steps) {
            let { description, start, status, output, end } = step
            await this._run(
              SQL`INSERT INTO Step(build_id, description, start, end, status,
                                   output)
                  VALUES(${buildId}, ${description}, ${start}, ${end},
                         ${status}, ${output})`
            )
          }
        }

        this.logger.debug(
          `Imported ${Object.keys(projectStatus.builds).length} builds`,
          { module: 'db' }
        )

        await move(
          resolve(statusRoot, file),
          resolve(statusRoot, `${file}.imported`)
        )
      }
    }
  }

  async getRepos() {
    return await this._all(SQL`SELECT id, name, url FROM Repo`)
  }

  async getOrCreateRepo({ name, url }) {
    let repo = await this._get(
      SQL`SELECT id, name, url FROM Repo WHERE name = ${name}`
    )

    if (!repo) {
      let { lastID } = await this._run(
        SQL`INSERT INTO Repo(name, url) VALUES(${name}, ${url})`
      )

      repo = await this._get(
        SQL`SELECT id, name, url FROM Repo WHERE id = ${lastID}`
      )
    }

    return repo
  }

  async getBuilds(repoId) {
    return (await this._all(
      SQL`SELECT b.id, b.ref_type, b.ref, b.sha, b.enqueued, b.updated, b.start,
                 b.end, b.status, b.extra
          FROM Build b
          WHERE b.repo_id = ${repoId}
          ORDER BY b.updated DESC`
    )).map(parseExtra)
  }

  async getBuildsFor({ repoName, refMode, ref }) {
    return (await this._all(
      SQL`SELECT b.id, b.ref_type, b.ref, b.sha, b.enqueued, b.updated, b.start,
                 b.end, b.status, b.extra
          FROM Build b JOIN Repo r ON b.repo_id = r.id
          WHERE r.name = ${repoName} AND b.ref_type = ${refMode} AND b.ref = ${ref}`
    )).map(parseExtra)
  }

  async getStaleBuilds() {
    return await this._all(
      SQL`SELECT id FROM Build
          WHERE status IN ('pending', 'running')`
    )
  }

  async getLastUpdatedBuilds(count) {
    let query = SQL`SELECT r.name as repo_name, r.url as repo_url, b.id,
                           b.repo_id, b.ref_type, b.ref, b.sha, b.enqueued,
                           b.updated, b.start, b.end, b.status, b.extra
                    FROM Build b JOIN Repo r ON r.id = b.repo_id
                    ORDER BY b.updated DESC`

    return (await this._all(count ? query.append(SQL` LIMIT ${count}`) : query)).map(parseExtra)
  }

  async createBuild({ repoId, refMode, ref, sha }) {
    let now = Date.now()

    let { lastID } = await this._run(
      SQL`INSERT INTO Build(repo_id, ref_type, ref, sha, enqueued, updated,
                            status)
          VALUES(${repoId}, ${refMode}, ${ref}, ${sha}, ${now}, ${now},
                 'pending')`
    )

    return lastID
  }

  async updateBuild({ id, status, extra }) {
    let now = Date.now()

    let build = await this._get(
      SQL`SELECT status, start FROM Build WHERE id = ${id}`
    )

    let query = SQL`UPDATE Build SET status = ${status}`

    if (status !== 'cleaned') {
      query.append(SQL`, updated = ${now}`)
    }

    if (!build.start && status !== 'cancelled' && status !== 'failed') {
      query.append(SQL`, start = ${now}`)
    }

    if (status === 'failed' || status === 'success') {
      query.append(SQL`, end = ${now}`)
    }

    if (extra) {
      query.append(SQL`, extra = ${JSON.stringify(extra)}`)
    }

    await this._run(query.append(SQL` WHERE id = ${id}`))
  }

  async getSteps(buildId) {
    return this._all(
      SQL`SELECT id, description, start, end, status, output
          FROM Step WHERE build_id = ${buildId}
          ORDER BY start`
    )
  }

  async updateStep({ buildId, description, status, output }) {
    let now = Date.now()

    await this.updateBuild({ id: buildId, status: 'running' })

    let step = await this._get(
      SQL`SELECT id FROM Step
          WHERE build_id = ${buildId} AND description = ${description}`
    )

    if (!step) {
      let { lastID } = await this._run(
        SQL`INSERT INTO Step(build_id, description, start, status)
            VALUES(${buildId}, ${description}, ${now}, ${status})`
      )

      step = { id: lastID }
    }

    let query = SQL`UPDATE Step SET status = ${status}`

    if (status === 'success' || status === 'failed') {
      query.append(SQL`, end = ${now}`)
    }

    if (output) {
      query.append(SQL`, output = ${output}`)
    }

    await this._run(query.append(SQL` WHERE id = ${step.id}`))
  }

  async getGitBuildInfo(buildId) {
    return await this._get(
      SQL`SELECT b.sha, r.url
          FROM Build b JOIN Repo r ON r.id = b.repo_id
          WHERE b.id = ${buildId}`
    )
  }
}

registerForTest(Database)
registerLazy('db', () => new Database())
