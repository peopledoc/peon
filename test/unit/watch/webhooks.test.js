/* eslint-disable camelcase */

const { assert } = require('chai')
const crypto = require('crypto')
const request = require('request-promise-native')
const { lookup, mockConfig } = require('../../helpers')

const { WebhookServer } = lookup()

describe('unit | watch/webhooks', function() {
  let server

  afterEach(async function() {
    if (server) {
      await server.stop()
    }
  })

  it('starts listening', async function() {
    this.slow(300)

    mockConfig('webhooks', { port: 9999 })
    server = new WebhookServer()
    await server.start()

    try {
      await request.get('http://localhost:9999/webhooks')
      assert.ok(false)
    } catch(e) {
      assert.equal(e.statusCode, 404)
    }
  })

  it('stops listening', async function() {
    mockConfig('webhooks', { port: 9999 })
    server = new WebhookServer()
    await server.start()
    await server.stop()
    server = null

    try {
      await request.get('http://localhost:9999/webhooks')
      assert.ok(false)
    } catch(e) {
      assert.equal(e.error.code, 'ECONNREFUSED')
    }
  })

  it('fails on invalid secret signature', async function() {
    mockConfig('webhooks', { port: 9999, secret: 'super-secret' })
    server = new WebhookServer()
    await server.start()

    let payload = {
      ref: 'refs/heads/mybranch',
      head_commit: { id: 'shashasha' },
      repository: {
        name: 'myrepo',
        ssh_url: 'git@example.com:org/myrepo'
      }
    }
    let body = JSON.stringify(payload)

    try {
      await request.post({
        url: 'http://localhost:9999/webhooks',
        headers: {
          'Content-type': 'application/json',
          'X-GitHub-Delivery': crypto.createHmac('sha1', body).digest('hex'),
          'X-GitHub-Event': 'push',
          'X-Hub-Signature': `sha1=${crypto
            .createHmac('sha1', 'wrong-secret')
            .update(body)
            .digest('hex')}`
        },
        body
      })
      assert.ok(false)
    } catch(e) {
      assert.equal(e.statusCode, 400)
    }
  })

  it('emits push events', async function() {
    let events = []

    mockConfig('webhooks', { port: 9999, secret: 'super-secret' })
    server = new WebhookServer()
    server.on('push', (repo, data) => events.push({ repo, data }))

    await server.start()

    let payload = {
      ref: 'refs/heads/mybranch',
      head_commit: { id: 'shashasha' },
      repository: {
        name: 'myrepo',
        ssh_url: 'git@example.com:org/myrepo'
      }
    }
    let body = JSON.stringify(payload)

    let response = await request.post({
      url: 'http://localhost:9999/webhooks',
      headers: {
        'Content-type': 'application/json',
        'X-GitHub-Delivery': crypto.createHmac('sha1', body).digest('hex'),
        'X-GitHub-Event': 'push',
        'X-Hub-Signature': `sha1=${crypto
          .createHmac('sha1', 'super-secret')
          .update(body)
          .digest('hex')}`
      },
      body,
      resolveWithFullResponse: true
    })

    assert.equal(response.statusCode, 200)
    assert.deepEqual(events, [{ repo: 'myrepo', data: payload }])
  })
})
