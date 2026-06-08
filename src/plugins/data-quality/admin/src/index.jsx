import { PluginIcon } from './components/PluginIcon';
import { PLUGIN_ID } from './pluginId';

export default {
  register(app) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: 'Data Quality',
      },
      Component: async () => {
        const { App } = await import('./pages/App');
        return App;
      },
      permissions: [],
      position: 7,
    });

    app.registerPlugin({
      id: PLUGIN_ID,
      name: 'Data Quality',
    });
  },
};
