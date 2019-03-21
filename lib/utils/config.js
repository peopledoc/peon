const { dirname, join } = require('path')
const { register } = require('../injections')

const configPath
  = process.env.PEON_CONFIG || join(dirname(dirname(__dirname)), 'config.json')

register('config', require(configPath))
