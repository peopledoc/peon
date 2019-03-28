const { src, cleanup } = require('./helpers')
const Peon = require(`${src}/peon`)

Peon.loadModules()

afterEach(cleanup)
