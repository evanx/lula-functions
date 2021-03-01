module.exports = {
  lula: {
    activeIntervalMs: 1000,
    inputStream: {
      xreadgroupCount: 10,
    },
    loop: {
      delay: 2000,
    },
    redis: {
      default: {
        url: 'redis://localhost:6379',
        keyPrefix: 'lf:',
      },
      monitor: {},
      lula: {},
    },
    monitor: {
      source: 'lf',
      maxLength: 999000,
      level: 'info',
    },
  },
}
