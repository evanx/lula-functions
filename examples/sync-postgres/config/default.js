module.exports = {
  redis: {
    hostKey: 'localhost',
    streamKey: 'test:x',
  },
  xreadgroup: {
    consumerGroup: 'lula-functions-sync-group',
    count: 1,
    block: 1000,
  },
  claim: {
    interval: 4000,
    minIdleTime: 8000,
  },
  postgresql: {
    connect: {
      connectionString: 'postgresql://app:password@localhost:5432/lula',
    },
  },
}
