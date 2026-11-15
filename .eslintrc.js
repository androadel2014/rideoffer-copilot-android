// Network discipline: the only file allowed to touch the network is src/net/transport.ts.
module.exports = {
  root: true,
  extends: ['expo'],
  rules: {
    'no-restricted-globals': [
      'error',
      { name: 'fetch', message: 'Network access is only allowed in src/net/transport.ts (sync, opt-in).' },
      { name: 'XMLHttpRequest', message: 'Network access is only allowed in src/net/transport.ts.' },
      { name: 'WebSocket', message: 'Network access is only allowed in src/net/transport.ts.' }
    ]
  },
  overrides: [
    { files: ['src/net/transport.ts', 'src/net/networkGate.ts'], rules: { 'no-restricted-globals': 'off' } }
  ]
};
