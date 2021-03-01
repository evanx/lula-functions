module.exports = {
  lula: {
    activeIntervalMs: 1000,
    inputStream: {
      xreadgroupCount: 2,
    },
    loop: {
      delay: 2000,
    },
    redis: {
      default: {
        url: 'redis://localhost:6379',
        keyPrefix: 'lf:',
      },
    },
    monitor: {
      name: 'lula-functions',
      maxLength: 999,
      level: 'debug',
    },
  },
}
