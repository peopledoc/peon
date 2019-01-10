const { dirname, join } = require('path')
const configPath
  = process.env.PEON_CONFIG || join(dirname(__dirname), 'config.json')
module.exports = require(configPath)
