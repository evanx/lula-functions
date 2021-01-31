module.exports = {
  lula: {
    loop: {
      delay: '2000',
    },
    redis: {
      connect: {
        url: 'redis://localhost:6379',
        keyPrefix: 'lf:',
      },
    },
    logger: {
      name: 'lula-functions',
      level: 'info',
    },
  },
}
