#!/usr/bin/env node
/* eslint-disable camelcase, no-console */

/*

  This script can be used to test webhooks.
  Make sure peon is started and has webhooks enabled before running.

  Call this script as:

    ./scripts/webhooks.js URL REF SHA

  Where:
    URL is the repository URL
    REF is a full git ref (refs/heads/mybranch or refs/tags/mytag)
    SHA is a commit SHA.

  Note: this does not generate full payloads, only the parts that peon cares
  about.  It must be updated when peon has new expectations.

  */

const request = require('request')
const crypto = require('crypto')
const { extractRepoName } = require('../lib/utils/misc')
const {
  webhooks: { port, secret }
} = require('../lib/config')

if (process.argv.length !== 5) {
  // eslint-disable-next-line no-console
  console.error(`Usage: ${process.argv[1]} URL REF SHA`)
  process.exit(1)
}

const payload = {
  ref: process.argv[3],
  head_commit: { id: process.argv[4] },
  repository: {
    name: extractRepoName(process.argv[2]),
    ssh_url: process.argv[2]
  }
}

const url = `http://localhost:${port}/webhooks`
const body = JSON.stringify(payload)
const headers = {
  'Content-type': 'application/json',
  'X-GitHub-Delivery': crypto.createHmac('sha1', body).digest('hex'),
  'X-GitHub-Event': 'push',
  'X-Hub-Signature': `sha1=${crypto
    .createHmac('sha1', secret)
    .update(body)
    .digest('hex')}`
}

console.log(
  `Sending POST request to ${url} with headers:\n${JSON.stringify(
    headers,
    null,
    2
  )}\nand payload:\n${JSON.stringify(payload, null, 2)}`
)

request.post({ url, headers, body }, (err, res, body) => {
  if (err) {
    console.error(err)
  } else {
    console.log(`Received HTTP ${res.statusCode} response`)
    console.log(body)
  }
})
