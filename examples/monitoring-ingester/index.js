module.exports = {
  spec: {
    type: 'lula-function',
    name: 'monitoring-ingester',
    inputStream: {
      key: 'lula-sync:test:x',
    },
  },
  config: require('./config/default'),
  setup: require('./setup'),
}
