'use strict';

module.exports = {
  admin: {
    type: 'admin',
    routes: [
      {
        method: 'GET',
        path: '/queues',
        handler: 'queue.index',
        config: {
          policies: ['admin::isAuthenticatedAdmin'],
        },
      },
    ],
  },
};
