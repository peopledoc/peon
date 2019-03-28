const { resolve } = require('path')
const { mkdir, readFile, writeFile } = require('fs-extra')
const Git = require('nodegit')

const { mockConfig, src, tempDir, wait } = require('../helpers')

const Peon = require(`${src}/peon`)

describe('system | peon', function() {
  it('builds from watcher', async function() {
    this.timeout(10000)
    this.slow(4000)

    // Mock configuration

    let repoPath = resolve(await tempDir(), 'repo')
    let workingDirectory = await tempDir()
    let statusDirectory = await tempDir()
    let destDirectory = await tempDir()

    mockConfig('watcher', {
      enabled: true,
      interval: 50,
      repositories: [{ url: repoPath, branches: ['master'] }]
    })
    mockConfig('webhooks', {
      enabled: false
    })
    mockConfig('workingDirectory', workingDirectory)
    mockConfig('statusDirectory', statusDirectory)
    mockConfig('destinations', {
      local: {
        destination: destDirectory,
        rootUrl: '/root/url/',
        absoluteUrl: 'https://example.com/root/url/'
      }
    })

    // Create repository content

    await mkdir(repoPath)
    await writeFile(
      resolve(repoPath, 'build.sh'),
      [
        '#!/bin/bash',
        'mkdir -p output',
        'echo -n "built once" > output/file'
      ].join('\n'),
      { mode: 0o755 }
    )
    await writeFile(
      resolve(repoPath, '.peon.yml'),
      [
        'output: output',
        'commands:',
        ' - ./build.sh',
        'destinations:',
        ' - name: local'
      ].join('\n')
    )

    // Create repository and make an initial commit

    let repo = await Git.Repository.init(repoPath, 0)
    await repo.createCommitOnHead(
      ['.peon.yml', 'build.sh'],
      Git.Signature.create('author', 'me@example.com', Date.now(), 0),
      Git.Signature.create('committer', 'me@example.com', Date.now(), 0),
      'first commit'
    )

    // Start Peon

    let peon = new Peon()
    await peon.start()

    // Check for deployment

    let file
    while (file !== 'built once') {
      try {
        file = (await readFile(
          resolve(destDirectory, 'repo', 'master', 'file')
        )).toString()
      } catch(e) {
        await wait(1000)
      }
    }

    // Make a new commit

    await writeFile(
      resolve(repoPath, 'build.sh'),
      [
        '#!/bin/bash',
        'mkdir -p output',
        'echo -n "built again" > output/file'
      ].join('\n'),
      { mode: 0o755 }
    )
    await repo.createCommitOnHead(
      ['build.sh'],
      Git.Signature.create('author', 'me@example.com', Date.now(), 0),
      Git.Signature.create('committer', 'me@example.com', Date.now(), 0),
      'second commit'
    )

    // Wait for deployment

    while (file !== 'built again') {
      try {
        file = (await readFile(
          resolve(destDirectory, 'repo', 'master', 'file')
        )).toString()
      } catch(e) {
        await wait(1000)
      }
    }

    // Leave a chance for status updates to finish

    await wait(500)

    // Stop peon

    await peon.stop()
  })
})
